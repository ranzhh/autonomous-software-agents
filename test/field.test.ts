import { describe, expect, test } from "vitest";
import { type Field, fielding } from "../src/field.js";
import type { IOConfig, Position } from "../src/sdk.js";
import { setup, config as world } from "./world.js";

// A tenth of a point per step, so a far cluster is still worth walking to.
const config = {
  ...world,
  GAME: {
    ...world.GAME,
    parcels: { ...world.GAME.parcels, max: 10 },
    player: { movement_duration: 100, observation_distance: 5 },
  },
} as unknown as IOConfig;

const row = (x: number): Position => ({ x, y: 0 });
const span = (from: number, to: number): Position[] =>
  Array.from({ length: to - from + 1 }, (_, i) => row(from + i));

function fielded(
  rows: string[],
  at: Position,
  parcels: Partial<{ x: number; y: number; reward: number }>[] = [],
  rivals: Partial<{ x: number; y: number; id: string }>[] = [],
  cfg = config,
) {
  const { beliefs, board } = setup(rows, at, parcels, rivals);
  const field: Field = fielding(beliefs, cfg, "me");
  return { beliefs, board, field };
}

describe("the chance of an unseen parcel", () => {
  test("grows with the time since anybody looked, and never past a lifetime", () => {
    const { beliefs, board, field } = fielded(["23333311"], { x: 0, y: 0 });
    beliefs.seen(
      { positions: [row(6)], agents: [], parcels: [], crates: [] },
      1_000,
    );
    const { yields } = field.assess(board, [], undefined, 2_000);
    const [near, far] = yields;
    // Two spawners, one tick a second: a spawn per tile every two seconds.
    expect(near?.chance).toBeCloseTo(1 - Math.exp(-1_000 / 2_000), 6);
    expect(far?.age).toBe(30 * 1_000);
    expect(far?.chance).toBeCloseTo(1, 5);
  });

  test("the global cap leaves nothing unseen when every parcel is accounted for", () => {
    const capped = {
      ...config,
      GAME: { ...config.GAME, parcels: { ...config.GAME.parcels, max: 1 } },
    } as IOConfig;
    const { board, field } = fielded(
      ["23333311"],
      { x: 0, y: 0 },
      [{ x: 3 }],
      [],
      capped,
    );
    const { scale, yields, chosen } = field.assess(board, [], undefined, 5_000);
    expect(scale).toBe(0);
    expect(yields.every((y) => y.worth === 0)).toBe(true);
    // Nothing to reveal anywhere: the nearest spawner is where the next one will be.
    expect(chosen).toMatchObject({ x: 6, reveals: 0 });
  });
});

describe("what the eyes teach the model", () => {
  test("a parcel appearing on a watched tile is a spawn; one found on arrival is not", () => {
    const { board, field } = fielded(["23333311"], { x: 0, y: 0 });
    field.saw(board, "me", span(2, 6), [], [], 0);
    field.saw(
      board,
      "me",
      span(2, 7),
      [
        { id: "a", x: 6, y: 0, reward: 40 },
        { id: "b", x: 7, y: 0, reward: 20 },
      ],
      [],
      1_000,
    );
    const { yields } = field.assess(board, [], undefined, 1_000);
    const six = yields.find((y) => y.x === 6);
    const seven = yields.find((y) => y.x === 7);
    expect(six).toMatchObject({ spawns: 1, exposure: 1_000 });
    // Not watched before this frame: a discovery, and no time credited yet.
    expect(seven).toMatchObject({ spawns: 0, exposure: 0 });
    // The config prior weighs one spawn over one expected interval: (1 + 1) / (2 s + 1 s).
    expect(six?.rate).toBeCloseTo(2 / 3_000, 9);
    // The reward is the config average with the weight of one sighting: (30 + 40) / 2.
    expect(six?.reward).toBe(35);
  });

  test("two pairs of eyes on one tile count its time once", () => {
    const { board, field } = fielded(["23333311"], { x: 0, y: 0 });
    field.saw(board, "me", span(4, 7), [], [], 0);
    field.saw(board, "mate", span(5, 7), [], [], 500);
    field.saw(board, "me", span(4, 7), [], [], 1_000);
    const { yields } = field.assess(board, [], undefined, 1_000);
    expect(yields.find((y) => y.x === 6)?.exposure).toBe(1_000);
  });

  test("the ledger credits the origin with what was banked against what was seen", () => {
    const { beliefs, board, field } = fielded(["23333311"], { x: 0, y: 0 });
    const born = { id: "p0", x: 6, y: 0, reward: 40 };
    beliefs.seen(
      { positions: span(2, 7), agents: [], parcels: [born], crates: [] },
      0,
    );
    field.saw(board, "me", span(2, 7), [born], [], 0);
    field.banked([{ id: "p0", reward: 30 }]);
    let ledger = field
      .assess(board, [], undefined, 0)
      .yields.find((y) => y.x === 6)?.ledger;
    // Prior 1 with the weight of one average parcel: (30 + 30) / (30 + 40).
    expect(ledger).toBeCloseTo(60 / 70, 6);

    const lost = { id: "p1", x: 6, y: 0, reward: 20 };
    beliefs.seen(
      { positions: span(2, 7), agents: [], parcels: [lost], crates: [] },
      1_000,
    );
    field.saw(board, "me", span(2, 7), [lost], [], 1_000);
    beliefs.seen(
      { positions: span(2, 7), agents: [], parcels: [], crates: [] },
      2_000,
    );
    field.saw(board, "me", span(2, 7), [], [], 2_000);
    ledger = field
      .assess(board, [], undefined, 2_000)
      .yields.find((y) => y.x === 6)?.ledger;
    expect(ledger).toBeCloseTo(60 / 90, 6);
  });

  test("a stranger standing within reach leaves a trace that lowers the share", () => {
    const { board, field } = fielded(["23333311"], { x: 0, y: 0 });
    field.saw(board, "me", span(2, 7), [], [], 0);
    field.saw(board, "me", span(2, 7), [], [{ id: "r", x: 5, y: 0 }], 1_000);
    const { yields } = field.assess(board, [], undefined, 1_000);
    const six = yields.find((y) => y.x === 6);
    // One second of presence over one spawn interval plus one second watched.
    expect(six?.presence).toBeCloseTo(1_000 / 3_000, 6);
    expect(six?.share).toBeCloseTo(1 - 1_000 / 3_000, 6);
  });
});

describe("a stranger carrying a parcel away", () => {
  test("charges the pickup to the spawners within reach, the nearest most", () => {
    const { board, field } = fielded(["23333311"], { x: 0, y: 0 });
    const carried = { id: "c", x: 5, y: 0, reward: 30, carriedBy: "r" };
    field.saw(
      board,
      "me",
      span(2, 5),
      [carried],
      [{ id: "r", x: 5, y: 0 }],
      1_000,
    );
    field.saw(
      board,
      "me",
      span(2, 5),
      [carried],
      [{ id: "r", x: 5, y: 0 }],
      2_000,
    );
    const { yields } = field.assess(board, [], undefined, 2_000);
    const six = yields.find((y) => y.x === 6);
    const seven = yields.find((y) => y.x === 7);
    // One step behind the carrier against two, softmaxed: e^-1 against e^-2.
    const blame = Math.exp(-1) / (Math.exp(-1) + Math.exp(-2));
    expect(six?.drain).toBeCloseTo(blame, 6);
    expect(seven?.drain).toBeCloseTo(1 - blame, 6);
    // The walk back dates each pickup: one step at a hundred milliseconds, then two.
    expect(six?.since).toBe(1_100);
    expect(seven?.since).toBe(1_200);
    // Never looked at, so a full lifetime of waiting is mixed with the refill since.
    const unseen = (ms: number): number => 1 - Math.exp(-ms / 2_000);
    expect(six?.chance).toBeCloseTo(
      (1 - blame) * unseen(30 * 1_000) + blame * unseen(1_100),
      6,
    );
  });

  test("charges it to the tile it was seen on, midway since it was last seen there", () => {
    const { beliefs, board, field } = fielded(["23333311"], { x: 0, y: 0 });
    const born = { id: "p", x: 6, y: 0, reward: 30 };
    beliefs.seen(
      { positions: span(2, 7), agents: [], parcels: [born], crates: [] },
      0,
    );
    field.saw(board, "me", span(2, 7), [born], [], 0);
    const taken = { ...born, x: 5, carriedBy: "r" };
    beliefs.seen(
      { positions: span(2, 5), agents: [], parcels: [taken], crates: [] },
      2_000,
    );
    field.saw(
      board,
      "me",
      span(2, 5),
      [taken],
      [{ id: "r", x: 5, y: 0 }],
      2_000,
    );
    let { yields } = field.assess(board, [], undefined, 2_000);
    let six = yields.find((y) => y.x === 6);
    expect(six).toMatchObject({ drain: 1, since: 1_000 });
    expect(yields.find((y) => y.x === 7)?.drain).toBe(0);
    // Watched for two seconds by then: a spawn per (2 s + 2 s).
    expect(six?.chance).toBeCloseTo(1 - Math.exp(-1_000 / 4_000), 6);

    // A look at the tile itself outranks the inference.
    beliefs.seen(
      { positions: [row(6)], agents: [], parcels: [], crates: [] },
      3_000,
    );
    ({ yields } = field.assess(board, [], undefined, 3_000));
    six = yields.find((y) => y.x === 6);
    expect(six).toMatchObject({ drain: 0, chance: 0 });
  });
});

describe("whose parcel it would be", () => {
  test("a rival nearer to a spawner takes it, a farther one does not", () => {
    const { beliefs, board, field } = fielded(
      ["13333331"],
      { x: 1, y: 0 },
      [],
      [{ x: 6, y: 0 }],
    );
    const { yields } = field.assess(board, beliefs.agents(), undefined, 0);
    expect(yields.find((y) => y.x === 0)?.share).toBe(1);
    expect(yields.find((y) => y.x === 7)?.share).toBe(0);
  });

  test("a rival out of sight for a second no longer holds anything", () => {
    const { beliefs, board, field } = fielded(
      ["13333331"],
      { x: 1, y: 0 },
      [],
      [{ x: 6, y: 0 }],
    );
    const { yields } = field.assess(board, beliefs.agents(), undefined, 1_000);
    expect(yields.find((y) => y.x === 7)?.share).toBe(1);
  });

  test("what the teammate says it is heading for is left to it", () => {
    const { beliefs, board, field } = fielded(
      ["13333331"],
      { x: 1, y: 0 },
      [],
      [{ id: "mate", x: 3, y: 0 }],
    );
    const mate = { id: "mate", intent: { stops: [], going: row(7) } };
    const { yields } = field.assess(board, beliefs.agents(), mate, 0);
    expect(yields.find((y) => y.x === 7)?.share).toBe(0);
    // Three steps from x=0 against my one: still mine.
    expect(yields.find((y) => y.x === 0)?.share).toBe(1);
  });
});

describe("where to scout", () => {
  test("a stale spawner next door beats a richer cluster far away, by the rate", () => {
    const { beliefs, board, field } = fielded(["213333333333333311"], {
      x: 5,
      y: 0,
    });
    const first = field.assess(board, [], undefined, 0);
    expect(first.chosen).toMatchObject({ x: 1, steps: 4 });
    const near = first.candidates.find((c) => c.x === 1);
    const far = first.candidates.find((c) => c.x === 16);
    expect(near?.reveals).toBeCloseTo(14.9, 2);
    expect(far?.reveals).toBeCloseTo(13.4 + 13.2, 2);
    expect(near?.rate).toBeGreaterThan(far?.rate ?? Infinity);

    // Once it has been looked at, the cluster is the only place left with anything unseen.
    beliefs.seen(
      { positions: [row(1)], agents: [], parcels: [], crates: [] },
      0,
    );
    expect(field.assess(board, [], undefined, 0).chosen).toMatchObject({
      x: 16,
    });
  });

  test("a head-on meeting with the teammate in a corridor is charged to that path", () => {
    const { beliefs, board, field } = fielded(
      ["1333333331"],
      { x: 4, y: 0 },
      [],
      [{ id: "mate", x: 7, y: 0 }],
    );
    const mate = { id: "mate", intent: { stops: [row(0)], going: undefined } };
    const { candidates } = field.assess(board, beliefs.agents(), mate, 0);
    expect(candidates.find((c) => c.x === 0)?.conflict).toBe(0);
    expect(candidates.find((c) => c.x === 9)?.conflict).toBeGreaterThan(0);
  });

  test("refusals met on a tile price every path through it", () => {
    const { board, field } = fielded(["213333333333333311"], { x: 5, y: 0 });
    field.stepped(row(3), false, 0);
    field.stepped(row(3), false, 100);
    field.stepped(row(3), true, 300);
    const { candidates } = field.assess(board, [], undefined, 0);
    // One episode of 300 ms and one passage, with a clean pass as the prior: 150 ms.
    expect(candidates.find((c) => c.x === 1)?.stall).toBeCloseTo(150, 6);
    expect(candidates.find((c) => c.x === 16)?.stall).toBe(0);
  });

  test("a kept destination survives a marginally better one", () => {
    const { board, field } = fielded(["13333333331"], { x: 5, y: 0 });
    const first = field.assess(board, [], undefined, 0, true);
    expect(first.held).toEqual(first.chosen && { x: first.chosen.x, y: 0 });
    const again = field.assess(board, [], undefined, 0, true);
    expect(again.chosen?.x).toBe(first.chosen?.x);
  });
});
