import { describe, expect, test } from "vitest";
import { grid } from "../../src/grid.js";
import { planning } from "../../src/pddl/planner.js";
import type { Solver } from "../../src/pddl/solver.js";
import { nearest } from "../../src/tour.js";
import { parcelOf, tilesOf } from "../tiles.js";

const answering = (...plan: string[]): Solver => ({
  solve: async () => plan,
});

describe("the planning tour", () => {
  test("keeps the stops of the plan and drops its moves", async () => {
    const board = grid(tilesOf(["2333"]));
    const tour = await planning(
      answering(
        "(move t1-0 t3-0)",
        "(pickup p0 t3-0)",
        "(move t3-0 t0-0)",
        "(deliver p0 t0-0)",
      ),
    ).plan({ x: 1, y: 0 }, [parcelOf("p0", 3)], board);

    expect(tour).toEqual([
      { action: "pickup", at: { x: 3, y: 0 }, parcel: "p0" },
      { action: "deliver", at: { x: 0, y: 0 } },
    ]);
  });

  test("puts down a whole batch at one stop", async () => {
    const board = grid(tilesOf(["2333"]));
    const tour = await planning(
      answering(
        "(pickup p0 t2-0)",
        "(pickup p1 t3-0)",
        "(move t3-0 t0-0)",
        "(deliver p0 t0-0)",
        "(deliver p1 t0-0)",
      ),
    ).plan({ x: 2, y: 0 }, [parcelOf("p0", 2), parcelOf("p1", 3)], board);

    expect(tour?.filter((stop) => stop.action === "deliver")).toHaveLength(1);
  });

  test("falls back on the greedy order when the solver answers nothing", async () => {
    const board = grid(tilesOf(["2333333333"]));
    const from = { x: 5, y: 0 };
    const parcels = [parcelOf("p0", 4), parcelOf("p1", 9)];
    const silent: Solver = { solve: async () => undefined };

    expect(await planning(silent).plan(from, parcels, board)).toEqual(
      await nearest.plan(from, parcels, board),
    );
  });

  test("falls back on a plan that reaches no stop", async () => {
    const board = grid(tilesOf(["2333"]));
    const tour = await planning(answering("(move t1-0 t3-0)")).plan(
      { x: 1, y: 0 },
      [parcelOf("p0", 3)],
      board,
    );

    expect(tour).toEqual([
      { action: "pickup", at: { x: 3, y: 0 }, parcel: "p0" },
      { action: "deliver", at: { x: 0, y: 0 } },
    ]);
  });

  test("prices a leg by the route around a wall, not by the straight line", async () => {
    let asked = "";
    const board = grid(tilesOf(["333", "302"]));
    await planning({
      solve: async (_domain, problem) => {
        asked = problem;
        return undefined;
      },
    }).plan({ x: 0, y: 0 }, [parcelOf("p0", 2, 1)], board);

    expect(asked).toContain("(= (dist t0-0 t2-0) 4)");
  });

  test("names only the deliveries the tour can end at", async () => {
    let asked = "";
    const board = grid(tilesOf(["2333233332"]));
    await planning({
      solve: async (_domain, problem) => {
        asked = problem;
        return undefined;
      },
    }).plan({ x: 3, y: 0 }, [parcelOf("p0", 5)], board);

    expect(asked).toContain("(delivery t4-0)");
    expect(asked).not.toContain("t0-0");
    expect(asked).not.toContain("t9-0");
  });
});
