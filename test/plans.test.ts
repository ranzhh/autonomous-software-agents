import { describe, expect, test } from "vitest";
import { type Beliefs, believe } from "../src/beliefs.js";
import { type Grid, grid } from "../src/grid.js";
import { naive } from "../src/plans.js";
import type { IOAgent, IOConfig, IOParcel } from "../src/sdk.js";
import { tilesOf } from "./tiles.js";

const config = {
  CLOCK: 50,
  GAME: { parcels: { decaying_event: "1s" } },
} as unknown as IOConfig;

const me = (x: number, y: number): IOAgent => ({
  id: "me",
  name: "tester",
  teamId: "t",
  teamName: "team",
  score: 0,
  penalty: 0,
  x,
  y,
});

function setup(
  rows: string[],
  at: { x: number; y: number },
  parcels: Partial<IOParcel>[] = [],
): { beliefs: Beliefs; board: Grid } {
  const tiles = tilesOf(rows);
  const beliefs = believe({ me: me(at.x, at.y), tiles, config });
  beliefs.seen(
    {
      positions: [],
      agents: [],
      crates: [],
      parcels: parcels.map((p, i) => ({
        id: `p${i}`,
        x: 0,
        y: 0,
        reward: 30,
        ...p,
      })),
    },
    0,
  );
  return { beliefs, board: grid(tiles) };
}

describe("the naive plan", () => {
  test("grabs the parcel underfoot", () => {
    const { beliefs, board } = setup(["333"], { x: 1, y: 0 }, [{ x: 1 }]);
    expect(naive(beliefs, board, 0)).toBe("pickup");
  });

  test("carries its load toward a delivery", () => {
    const { beliefs, board } = setup(["233"], { x: 2, y: 0 }, [
      { x: 2, carriedBy: "me" },
    ]);
    expect(naive(beliefs, board, 0)).toBe("left");
  });

  test("drops its load on the delivery", () => {
    const { beliefs, board } = setup(["233"], { x: 0, y: 0 }, [
      { carriedBy: "me" },
    ]);
    expect(naive(beliefs, board, 0)).toBe("putdown");
  });

  test("chases the nearest known parcel", () => {
    const { beliefs, board } = setup(["3333"], { x: 0, y: 0 }, [{ x: 2 }]);
    expect(naive(beliefs, board, 0)).toBe("right");
  });

  test("heads for a spawner when it knows of nothing", () => {
    const { beliefs, board } = setup(["3331"], { x: 0, y: 0 });
    expect(naive(beliefs, board, 0)).toBe("right");
  });

  test("drifts off an empty spawner", () => {
    const { beliefs, board } = setup(["31"], { x: 1, y: 0 });
    expect(naive(beliefs, board, 0)).toBe("left");
  });
});
