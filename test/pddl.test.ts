import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { believe } from "../src/beliefs.js";
import { env } from "../src/env.js";
import { grid } from "../src/grid.js";
import { parse, plan, problem } from "../src/pddl.js";
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
    expect(parse(plan)).toEqual([
      { do: "right", push: false },
      { do: "right", push: true },
      { do: "pickup", push: false },
    ]);
  });

  test("collapses a run of putdowns into one", () => {
    expect(parse("(putdown p_a t_0_0)\n(putdown p_b t_0_0)")).toEqual([
      { do: "putdown", push: false },
    ]);
  });

  test("refuses an action it does not know", () => {
    expect(() => parse("(teleport t_0_0 t_9_9)")).toThrow(/teleport/);
  });
});

const available = spawnSync(env.FAST_DOWNWARD, ["--version"]).status === 0;

describe.skipIf(!available)("the domain, solved for real", () => {
  test("pushes the crate aside to fetch", { timeout: 30_000 }, async () => {
    const tiles = tilesOf(["00100", "35553"]);
    const beliefs = believe({ me, tiles, config });
    beliefs.seen(
      {
        positions: [],
        agents: [],
        parcels: [{ id: "p0", x: 2, y: 1, reward: 30 }],
        crates: [{ id: "c0", x: 1, y: 0 }],
      },
      0,
    );
    const actions = await plan(
      { kind: "fetch", id: "p0" },
      beliefs,
      grid(tiles),
      0,
    );
    expect(actions).toEqual([
      { do: "right", push: true },
      { do: "right", push: true },
      { do: "up", push: false },
      { do: "pickup", push: false },
    ]);
  });
});

describe("the plan outcomes", () => {
  test("explore states no goal", async () => {
    const tiles = tilesOf(["3"]);
    const beliefs = believe({ me, tiles, config });
    expect(await plan({ kind: "explore" }, beliefs, grid(tiles), 0)).toBe(
      "no goal",
    );
  });
});

describe.skipIf(!available)("the solver on a wedged crate", () => {
  test("answers no plan", { timeout: 30_000 }, async () => {
    const tiles = tilesOf(["353"]);
    const beliefs = believe({ me, tiles, config });
    beliefs.seen(
      {
        positions: [],
        agents: [],
        parcels: [{ id: "p0", x: 2, y: 0, reward: 30 }],
        crates: [{ id: "c0", x: 1, y: 0 }],
      },
      0,
    );
    expect(
      await plan({ kind: "fetch", id: "p0" }, beliefs, grid(tiles), 0),
    ).toBe("no plan");
  });
});
