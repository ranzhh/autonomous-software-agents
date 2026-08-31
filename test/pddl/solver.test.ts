import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { type Grid, grid } from "../../src/grid.js";
import { planning } from "../../src/pddl/planner.js";
import { fastDownward } from "../../src/pddl/solver.js";
import type { Position } from "../../src/sdk.js";
import { nearest, type Tour } from "../../src/tour.js";
import { parcelOf, tilesOf } from "../tiles.js";

const bin = process.env.DOWNWARD ?? ".solver/fast-downward.py";

const steps = (from: Position, tour: Tour | undefined, board: Grid): number => {
  let at = from;
  let walked = 0;
  for (const stop of tour ?? []) {
    walked += board.route(stop.at).distance(at);
    at = stop.at;
  }
  return walked;
};

describe.skipIf(!existsSync(bin))("Fast Downward", () => {
  const board = grid(tilesOf(["2333333333"]));
  const from = { x: 5, y: 0 };
  const parcels = [parcelOf("p4", 4), parcelOf("p6", 6), parcelOf("p9", 9)];

  test("orders a tour the greedy cannot find", async () => {
    const planned = await planning(fastDownward(bin)).plan(
      from,
      parcels,
      board,
    );

    expect(steps(from, await nearest.plan(from, parcels, board), board)).toBe(
      15,
    );
    expect(steps(from, planned, board)).toBe(13);
    expect(planned?.at(-1)).toEqual({ action: "deliver", at: { x: 0, y: 0 } });
  }, 20_000);

  test("gives back nothing it cannot deliver", async () => {
    const walled = grid(tilesOf(["23033"]));
    const tour = await planning(fastDownward(bin)).plan(
      { x: 3, y: 0 },
      [parcelOf("p0", 4)],
      walled,
    );

    expect(tour).toBeUndefined();
  }, 20_000);
});
