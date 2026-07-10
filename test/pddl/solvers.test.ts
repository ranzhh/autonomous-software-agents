import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PlannerError } from "../../src/core/util/index.js";
import {
  createSolver,
  LocalSolver,
  parseSolutionText,
  RemoteSolver,
} from "../../src/pddl/index.js";

const FAKE_PLANNER = fileURLToPath(
  new URL("./fixtures/fake-planner.mjs", import.meta.url),
);

describe("parseSolutionText", () => {
  it("parses upper-cased solver output case-insensitively (solver gotcha)", () => {
    const steps = parseSolutionText(
      "(MOVE L_0_0 L_2_0)\n(PICKUP P_P1 L_2_0)\n",
    );
    expect(steps).toEqual([
      { action: "move", args: ["l_0_0", "l_2_0"] },
      { action: "pickup", args: ["p_p1", "l_2_0"] },
    ]);
  });

  it("ignores blank and non-step lines", () => {
    const steps = parseSolutionText("\n; comment\n(move a b)\n   \n");
    expect(steps).toHaveLength(1);
  });

  it("returns an empty plan for an empty file (goal already satisfied)", () => {
    expect(parseSolutionText("")).toEqual([]);
  });
});

describe("RemoteSolver", () => {
  const savedHost = process.env.PAAS_HOST;
  const savedPath = process.env.PAAS_PATH;
  afterEach(() => {
    if (savedHost === undefined) delete process.env.PAAS_HOST;
    else process.env.PAAS_HOST = savedHost;
    if (savedPath === undefined) delete process.env.PAAS_PATH;
    else process.env.PAAS_PATH = savedPath;
  });

  it("lowercases the steps returned by the solver", async () => {
    const solver = new RemoteSolver({
      solverFn: async () => [
        { action: "MOVE", args: ["L_0_0", "L_5_0"] },
        { action: "DELIVER", args: ["P_P1", "L_5_0"] },
      ],
    });
    const steps = await solver.solve("(domain)", "(problem)");
    expect(steps).toEqual([
      { action: "move", args: ["l_0_0", "l_5_0"] },
      { action: "deliver", args: ["p_p1", "l_5_0"] },
    ]);
  });

  it("maps 'no plan found' (undefined) to null", async () => {
    const solver = new RemoteSolver({ solverFn: async () => undefined });
    expect(await solver.solve("(domain)", "(problem)")).toBeNull();
  });

  it("wraps solver rejections in PlannerError", async () => {
    const solver = new RemoteSolver({
      solverFn: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    await expect(solver.solve("(d)", "(p)")).rejects.toBeInstanceOf(
      PlannerError,
    );
  });

  it("times out a hung solver with PlannerError", async () => {
    const solver = new RemoteSolver({
      timeoutMs: 20,
      solverFn: () => new Promise(() => {}), // never resolves (polls forever)
    });
    await expect(solver.solve("(d)", "(p)")).rejects.toThrow(/timed out/);
  });

  it("exports a configured URL to the pddl-client env vars", () => {
    new RemoteSolver({
      url: "https://example.test:5001/package/foo/solve",
      solverFn: async () => undefined,
    });
    expect(process.env.PAAS_HOST).toBe("https://example.test:5001");
    expect(process.env.PAAS_PATH).toBe("/package/foo/solve");
  });
});

describe("LocalSolver (fake planner CLI)", () => {
  it("writes temp files, runs the command, and parses the .soln", async () => {
    const solver = new LocalSolver({ cmd: `node ${FAKE_PLANNER} solve` });
    const steps = await solver.solve("(domain)", "(problem)");
    expect(steps).toEqual([
      { action: "move", args: ["l_0_0", "l_2_0"] },
      { action: "pickup", args: ["p_p1", "l_2_0"] },
    ]);
  });

  it("returns null when the planner exits cleanly without a solution", async () => {
    const solver = new LocalSolver({ cmd: `node ${FAKE_PLANNER} unsolv` });
    expect(await solver.solve("(domain)", "(problem)")).toBeNull();
  });

  it("throws PlannerError when the planner crashes", async () => {
    const solver = new LocalSolver({ cmd: `node ${FAKE_PLANNER} crash` });
    await expect(solver.solve("(d)", "(p)")).rejects.toBeInstanceOf(
      PlannerError,
    );
  });

  it("throws PlannerError when the binary does not exist", async () => {
    const solver = new LocalSolver({ cmd: "./no/such/planner" });
    await expect(solver.solve("(d)", "(p)")).rejects.toBeInstanceOf(
      PlannerError,
    );
  });
});

describe("createSolver", () => {
  it("builds the solver selected by PDDL_SOLVER", () => {
    expect(createSolver({ pddlSolver: "remote" }).name).toBe("remote");
    expect(createSolver({ pddlSolver: "local" }).name).toBe("local");
  });
});
