import { describe, expect, test } from "vitest";
import { believe } from "../src/beliefs.js";
import { grid } from "../src/grid.js";
import { parse, problem } from "../src/pddl.js";
import type { IOAgent, IOConfig } from "../src/sdk.js";
import { tilesOf } from "./tiles.js";

const config = {
  CLOCK: 50,
  GAME: { parcels: { decaying_event: "1s" } },
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

describe("the problem", () => {
  test("states a crate as an obstruction on slidable tiles", () => {
    const tiles = tilesOf(["35533"]);
    const beliefs = believe({ me, tiles, config });
    beliefs.seen(
      {
        positions: [],
        agents: [],
        parcels: [{ id: "p0", x: 4, y: 0, reward: 30 }],
        crates: [{ id: "c0", x: 1, y: 0 }],
      },
      0,
    );
    const text = problem({ kind: "fetch", id: "p0" }, beliefs, grid(tiles), 0);

    expect(text).toContain("(crate-at c_c0 t_1_0)");
    expect(text).toContain("(slidable t_1_0)");
    expect(text).toContain("(slidable t_2_0)");
    expect(text).not.toContain("(clear t_1_0)");
    expect(text).toContain("(clear t_2_0)");
    expect(text).toContain("(:goal (carrying p_p0))");
  });
});

describe("the plan text", () => {
  test("turns moves and pushes into steps, skipping the cost line", () => {
    const plan = [
      "(move-right t_0_0 t_1_0)",
      "(push-right c_c0 t_1_0 t_2_0 t_3_0)",
      "(pickup p_p0 t_2_0)",
      "; cost = 3 (unit cost)",
    ].join("\n");
    expect(parse(plan)).toEqual(["right", "right", "pickup"]);
  });

  test("collapses a run of putdowns into one", () => {
    expect(parse("(putdown p_a t_0_0)\n(putdown p_b t_0_0)")).toEqual([
      "putdown",
    ]);
  });

  test("refuses an action it does not know", () => {
    expect(() => parse("(teleport t_0_0 t_9_9)")).toThrow(/teleport/);
  });
});
