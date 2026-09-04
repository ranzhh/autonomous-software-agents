import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { believe } from "../src/beliefs.js";
import { executive } from "../src/executive.js";
import type { Planned } from "../src/pddl.js";
import type { Intention } from "../src/plans.js";
import { NONE, orders, type Policy } from "../src/policy.js";
import { MOVES } from "../src/position.js";
import type {
  Connection,
  IOAgent,
  IOConfig,
  IOParcel,
  IOSensing,
  Position,
  World,
} from "../src/sdk.js";
import type { Team } from "../src/team.js";
import { tilesOf } from "./tiles.js";

const STEP_MS = 100;

const config = {
  CLOCK: 50,
  GAME: {
    parcels: {
      decaying_event: "1s",
      generation_event: "1s",
      reward_avg: 30,
      max: 25,
    },
    player: { movement_duration: STEP_MS },
  },
} as unknown as IOConfig;

const me: IOAgent = {
  id: "a",
  name: "tester",
  teamId: "t",
  teamName: "team",
  score: 0,
  penalty: 0,
  x: 0,
  y: 0,
};

interface Fake {
  game: Connection;
  visited: Position[];
  dropped: { at: Position; ids: string[] }[];
  sense: (sensing: IOSensing) => void;
}

/** A server that lands every move a step later, bar those onto `refused` tiles. */
function fakeGame(refused: Position[] = []): Fake {
  let at = { x: 0, y: 0 };
  const visited: Position[] = [];
  const dropped: Fake["dropped"] = [];
  let sense: Fake["sense"] = () => {};
  const later = <T>(value: () => T): Promise<T> =>
    new Promise((resolve) => setTimeout(() => resolve(value()), STEP_MS));
  const game = {
    me: () => ({ ...me, ...at }),
    onSensing: (listener) => {
      sense = listener;
    },
    onTile: () => {},
    move: (direction) =>
      later(() => {
        const to = {
          x: at.x + MOVES[direction].dx,
          y: at.y + MOVES[direction].dy,
        };
        if (refused.some((r) => r.x === to.x && r.y === to.y)) {
          refused.length = 0;
          return false;
        }
        at = to;
        visited.push(at);
        return at;
      }),
    pickup: () => later(() => [{ xy: at, reward: 30 }]),
    putdown: (ids) =>
      later(() => {
        dropped.push({ at, ids: ids ?? [] });
        return (ids ?? []).map(() => ({ xy: at, reward: 30 }));
      }),
  } as Partial<Connection> as Connection;
  return { game, visited, dropped, sense: (sensing) => sense(sensing) };
}

function start(
  rows: string[],
  policy: Policy,
  parcels: Partial<IOParcel>[],
  team?: Team,
  refused: Position[] = [],
  agents: IOAgent[] = [],
  crates: IOSensing["crates"] = [],
  planner?: (intention: Intention) => Promise<Planned>,
): Fake {
  const world: World = { me, tiles: tilesOf(rows), config };
  const beliefs = believe(world);
  beliefs.seen({
    positions: [],
    agents,
    crates,
    parcels: parcels.map((p, i) => ({
      id: `p${i}`,
      x: 0,
      y: 0,
      reward: 30,
      ...p,
    })),
  });
  const fake = fakeGame(refused);
  void executive(fake.game, world, beliefs, orders(policy), team, planner);
  return fake;
}

/** A teammate of the given id whose word arrives through `told`. */
function mates(id: string): Team & { told: (payload: unknown) => void } {
  const listeners = new Set<(payload: unknown) => void>();
  return {
    mate: () => ({ id, name: id }),
    tell: () => {},
    onTell: (listener) => {
      listeners.add(listener);
    },
    told: (payload) => {
      for (const listener of listeners) listener(payload);
    },
  };
}

const standing = (id: string, x: number, y: number): IOAgent => ({
  ...me,
  id,
  name: id,
  x,
  y,
});

describe("the executive under orders", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("delivers what it carries on the nearest delivery tile", async () => {
    const { dropped } = start(["1332"], NONE, [{}]);
    await vi.advanceTimersByTimeAsync(20 * STEP_MS);
    expect(dropped).toEqual([{ at: { x: 3, y: 0 }, ids: ["p0"] }]);
  });

  test("holds a lot until it is as large as ordered", async () => {
    const { dropped } = start(["1332"], { ...NONE, batch: 2 }, [{}]);
    await vi.advanceTimersByTimeAsync(20 * STEP_MS);
    expect(dropped).toEqual([]);
  });

  test("walks around forbidden tiles and past forbidden deliveries", async () => {
    const policy = {
      ...NONE,
      avoid: [{ x: 1, y: 0 }],
      noDelivery: [{ x: 3, y: 0 }],
    };
    const { visited, dropped } = start(["3332", "1332"], policy, [{}]);
    await vi.advanceTimersByTimeAsync(30 * STEP_MS);
    expect(visited).not.toContainEqual({ x: 1, y: 0 });
    expect(dropped).toEqual([{ at: { x: 3, y: 1 }, ids: ["p0"] }]);
  });

  test("routes around a tile that refuses it, as around a standing agent", async () => {
    const { visited, dropped } = start(
      ["3332", "1332"],
      NONE,
      [{}],
      undefined,
      [{ x: 1, y: 0 }],
    );
    await vi.advanceTimersByTimeAsync(40 * STEP_MS);
    expect(dropped).toEqual([{ at: { x: 3, y: 1 }, ids: ["p0"] }]);
    expect(visited).toContainEqual({ x: 0, y: 1 });
  });

  test("goes where it is sent before it collects", async () => {
    const goal = {
      kind: "visit" as const,
      tiles: [{ x: 2, y: 0 }],
      radius: 0,
      bonus: 1000,
      together: false,
    };
    const { visited, dropped } = start(["1332"], { ...NONE, goals: [goal] }, [
      {},
    ]);
    await vi.advanceTimersByTimeAsync(30 * STEP_MS);
    expect(visited[0]).toEqual({ x: 1, y: 0 });
    expect(visited[1]).toEqual({ x: 2, y: 0 });
    expect(dropped).toEqual([{ at: { x: 3, y: 0 }, ids: ["p0"] }]);
  });

  test("stands still while told to hold", async () => {
    const { visited } = start(["1332"], { ...NONE, hold: true }, [{}]);
    await vi.advanceTimersByTimeAsync(20 * STEP_MS);
    expect(visited).toEqual([]);
  });

  test("the collector of a hand-off leaves parcels beside the post", async () => {
    const policy = { ...NONE, handoff: true };
    const { visited, dropped } = start(["1332"], policy, [{}], mates("z"));
    await vi.advanceTimersByTimeAsync(20 * STEP_MS);
    expect(dropped).toEqual([{ at: { x: 2, y: 0 }, ids: ["p0"] }]);
    expect(visited).not.toContainEqual({ x: 3, y: 0 });
  });

  test("the deliverer fetches what was left once the tile that refused it clears", async () => {
    const policy = { ...NONE, handoff: true };
    const fake = start(["1332"], policy, [], mates("0"), [{ x: 2, y: 0 }]);
    await vi.advanceTimersByTimeAsync(5 * STEP_MS);
    fake.sense({
      positions: [],
      agents: [{ ...me, id: "0", name: "0", x: 2, y: 0 }],
      crates: [],
      parcels: [{ id: "left", x: 2, y: 0, reward: 30 }],
    });
    await vi.advanceTimersByTimeAsync(5 * STEP_MS);
    fake.sense({
      positions: [{ x: 2, y: 0 }],
      agents: [],
      crates: [],
      parcels: [{ id: "left", x: 2, y: 0, reward: 30 }],
    });
    await vi.advanceTimersByTimeAsync(40 * STEP_MS);
    expect(fake.dropped).toEqual([{ at: { x: 3, y: 0 }, ids: ["left"] }]);
  });

  test("the deliverer of a hand-off waits on the post for what is left there", async () => {
    const policy = { ...NONE, handoff: true };
    const { visited, dropped } = start(
      ["1332"],
      policy,
      [{ x: 1 }, { x: 2 }],
      mates("0"),
    );
    await vi.advanceTimersByTimeAsync(20 * STEP_MS);
    expect(dropped).toEqual([{ at: { x: 3, y: 0 }, ids: ["p1"] }]);
    expect(visited.at(-1)).toEqual({ x: 3, y: 0 });
  });

  test("leaves the parcel the teammate says it is going for and takes its own", async () => {
    const team = mates("0");
    const { visited } = start(
      ["33333", "33332"],
      NONE,
      [
        { x: 2, y: 0 },
        { x: 1, y: 1 },
      ],
      team,
      [],
      [standing("0", 3, 0)],
    );
    team.told({
      at: Date.now() + 1,
      x: 3,
      y: 0,
      parcels: [
        { id: "p0", x: 2, y: 0, reward: 30 },
        { id: "p1", x: 1, y: 1, reward: 30 },
      ],
      agents: [],
      intention: { kind: "fetch", id: "p0" },
    });
    await vi.advanceTimersByTimeAsync(3 * STEP_MS);
    expect(visited).toEqual([
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]);
  });

  test("gives a teammate of lower id in its way a pace, then goes round", async () => {
    const { visited, dropped } = start(
      ["3333", "1332"],
      NONE,
      [{ carriedBy: "a" }],
      mates("0"),
      [],
      [standing("0", 1, 0)],
    );
    await vi.advanceTimersByTimeAsync(1.5 * STEP_MS);
    expect(visited).toEqual([]);
    await vi.advanceTimersByTimeAsync(30 * STEP_MS);
    expect(visited).not.toContainEqual({ x: 1, y: 0 });
    expect(dropped).toEqual([{ at: { x: 3, y: 0 }, ids: ["p0"] }]);
  });

  test("a crate on the way is pushed as the planner says", async () => {
    const asked: Intention[] = [];
    const { visited, dropped } = start(
      ["13552"],
      NONE,
      [{ carriedBy: "a" }],
      undefined,
      [],
      [],
      [{ id: "c", x: 2, y: 0 }],
      async (intention) => {
        asked.push(intention);
        return [
          { do: "right", push: true },
          { do: "right", push: false },
          { do: "right", push: false },
          { do: "putdown", push: false },
        ];
      },
    );
    await vi.advanceTimersByTimeAsync(20 * STEP_MS);
    expect(asked).toEqual([{ kind: "home" }]);
    expect(visited.slice(0, 4)).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ]);
    expect(dropped).toEqual([{ at: { x: 4, y: 0 }, ids: ["p0"] }]);
  });

  test("a plan is dropped rather than walked into a crate it did not expect", async () => {
    let asked = 0;
    const { visited } = start(
      ["13532"],
      NONE,
      [{ x: 3, y: 0 }],
      undefined,
      [],
      [],
      [{ id: "c", x: 2, y: 0 }],
      async () => {
        asked++;
        return [{ do: "right", push: false }];
      },
    );
    await vi.advanceTimersByTimeAsync(10 * STEP_MS);
    expect(visited).toEqual([{ x: 1, y: 0 }]);
    expect(asked).toBeGreaterThan(1);
  });

  test("what the planner cannot serve is left alone until a crate moves", async () => {
    let asked = 0;
    const { visited } = start(
      ["13532"],
      NONE,
      [{ x: 3, y: 0 }],
      undefined,
      [],
      [],
      [{ id: "c", x: 2, y: 0 }],
      async () => {
        asked++;
        return "no plan";
      },
    );
    await vi.advanceTimersByTimeAsync(20 * STEP_MS);
    expect(asked).toBe(1);
    expect(visited).not.toContainEqual({ x: 2, y: 0 });
  });

  test("steps aside for a teammate of higher id at once, then goes round", async () => {
    const { visited, dropped } = start(
      ["3333", "1332"],
      NONE,
      [{ carriedBy: "a" }],
      mates("z"),
      [],
      [standing("z", 1, 0)],
    );
    await vi.advanceTimersByTimeAsync(1.5 * STEP_MS);
    expect(visited).toEqual([{ x: 0, y: 1 }]);
    await vi.advanceTimersByTimeAsync(30 * STEP_MS);
    expect(visited).not.toContainEqual({ x: 1, y: 0 });
    expect(dropped).toEqual([{ at: { x: 3, y: 0 }, ids: ["p0"] }]);
  });
});
