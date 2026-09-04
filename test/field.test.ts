import { describe, expect, test } from "vitest";
import { believe } from "../src/beliefs.js";
import { odds, prospects } from "../src/field.js";
import { grid } from "../src/grid.js";
import type { IOAgent, IOConfig, IOParcel, IOSensing } from "../src/sdk.js";
import { tilesOf } from "./tiles.js";

const config = {
  CLOCK: 50,
  GAME: {
    parcels: {
      generation_event: "1s",
      decaying_event: "1s",
      reward_avg: 30,
      reward_variance: 0,
      max: 4,
    },
    player: { movement_duration: 100, observation_distance: 1 },
  },
} as unknown as IOConfig;

const me: IOAgent = {
  id: "me",
  name: "tester",
  teamId: "t",
  teamName: "team",
  score: 0,
  penalty: 0,
  x: 0,
  y: 0,
};

// Two spawners at x3 and x7, a delivery at x0.
const rows = ["23313331"];
const board = grid(tilesOf(rows));
const world = () => ({ me, tiles: tilesOf(rows), config });

const sensing = (partial: Partial<IOSensing>): IOSensing => ({
  positions: [],
  agents: [],
  parcels: [],
  crates: [],
  ...partial,
});

const parcel = (id: string, x: number): IOParcel =>
  ({ id, x, y: 0, reward: 30, carriedBy: null }) as unknown as IOParcel;

const chances = (list: { x: number; chance: number }[]) =>
  Object.fromEntries(list.map((p) => [p.x, Number(p.chance.toFixed(3))]));

describe("the chance of an unseen parcel", () => {
  test("is certain where nobody ever looked, and nil where somebody just did", () => {
    const beliefs = believe(world());
    beliefs.seen(sensing({ positions: [{ x: 3, y: 0 }] }), 1_000);
    expect(chances(prospects(beliefs, board, config, 1_000))).toEqual({
      3: 0,
      7: 1,
    });
  });

  test("grows with the time since the look, one spawner's share per tick", () => {
    const beliefs = believe(world());
    beliefs.seen(
      sensing({
        positions: [
          { x: 3, y: 0 },
          { x: 7, y: 0 },
        ],
      }),
      0,
    );
    // Two spawners: after one tick each has had half a spawn's worth of time.
    const after = prospects(beliefs, board, config, 2_000);
    expect(chances(after)).toEqual({ 3: 0.632, 7: 0.632 });
  });

  test("is worth less the longer the parcel may have sat there", () => {
    const beliefs = believe(world());
    beliefs.seen(sensing({ positions: [{ x: 3, y: 0 }] }), 0);
    const worth = prospects(beliefs, board, config, 10_000)
      .sort((a, b) => a.x - b.x)
      .map((s) => s.worth);
    expect(worth).toEqual([25, 15]);
  });
});

describe("what bounds the chances together", () => {
  test("the room left under the board's cap", () => {
    const beliefs = believe(world());
    beliefs.seen(
      sensing({
        parcels: [parcel("p0", 1), parcel("p2", 4), parcel("p4", 5)],
      }),
      1_000,
    );
    expect(chances(prospects(beliefs, board, config, 1_000))).toEqual({
      3: 0.5,
      7: 0.5,
    });
    beliefs.seen(sensing({ parcels: [parcel("p6", 6)] }), 1_000);
    expect(chances(prospects(beliefs, board, config, 1_000))).toEqual({
      3: 0,
      7: 0,
    });
  });
});

describe("who else looks", () => {
  test("an agent seen beside a spawner counts as a look at that time", () => {
    const beliefs = believe(world());
    beliefs.seen(
      sensing({ agents: [{ ...me, id: "rival", name: "r", x: 6, y: 0 }] }),
      1_000,
    );
    expect(chances(prospects(beliefs, board, config, 1_000))).toEqual({
      3: 1,
      7: 0,
    });
  });

  test("the spawners left to the teammate are not listed", () => {
    const beliefs = believe(world());
    const mine = prospects(beliefs, board, config, 0, (s) => s.x < 5);
    expect(mine.map((s) => s.x)).toEqual([3]);
  });
});

describe("the chance of beating a rival to a parcel", () => {
  const rival = (id: string, x: number): IOAgent =>
    ({ id, name: id, x, y: 0 }) as unknown as IOAgent;

  const saw = (id: string, x: number) => {
    const beliefs = believe(world());
    beliefs.seen(sensing({ agents: [rival(id, x)] }), 0);
    return beliefs;
  };

  test("is certain where nobody else was seen", () => {
    expect(odds(believe(world()), board, config, { x: 5, y: 0 }, 5, 100)).toBe(
      1,
    );
  });

  test("falls to the share of the race the rival leaves", () => {
    expect(odds(saw("them", 6), board, config, { x: 5, y: 0 }, 5, 100)).toBe(
      1 / 5,
    );
  });

  test("ignores a rival that never saw the parcel", () => {
    expect(odds(saw("them", 3), board, config, { x: 5, y: 0 }, 5, 100)).toBe(1);
  });

  test("ignores a sighting old enough for the rival to have left", () => {
    expect(odds(saw("them", 6), board, config, { x: 5, y: 0 }, 5, 200)).toBe(1);
  });

  test("does not count the teammate as a rival", () => {
    expect(
      odds(saw("mate", 6), board, config, { x: 5, y: 0 }, 5, 100, "mate"),
    ).toBe(1);
  });
});
