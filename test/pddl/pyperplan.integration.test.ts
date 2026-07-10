/**
 * Integration against the REAL local pyperplan (optimal A* + LM-cut).
 * Requires the documented dev venv (`.env.example`): `python3 -m venv
 * .venv-pddl && ./.venv-pddl/bin/pip install pyperplan`. Skipped when absent,
 * so CI/offline runs stay green — the offline suite covers the same seams
 * with a fake planner CLI.
 *
 * This is also the "PDDL sequencing beats greedy" evidence (PLAN.md Phase 4):
 * the optimal plan batches both pickups before delivering (3 abstract moves),
 * where a deliver-as-you-go tour needs 4 — see docs/journal.md.
 */

import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildGameMap, type GameMap } from "../../src/core/beliefs/index.js";
import type { IOTile, IOTileType } from "../../src/core/sdk/index.js";
import {
  buildTourProblem,
  LocalSolver,
  PDDL_DOMAIN,
} from "../../src/pddl/index.js";

const PYPERPLAN = "./.venv-pddl/bin/pyperplan";
const hasPyperplan = existsSync(PYPERPLAN);

function lineMap(types: readonly IOTileType[]): GameMap {
  const tiles: IOTile[] = types.map((type, x) => ({ x, y: 0, type }));
  return buildGameMap(types.length, 1, tiles);
}

const NO_DECAY = {
  parcelDecayMs: Number.POSITIVE_INFINITY,
  movementDurationMs: 100,
};

describe.skipIf(!hasPyperplan)("pyperplan end-to-end (optimal)", () => {
  it("solves a two-parcel tour and batches pickups before delivering", async () => {
    //  x:  0(me) 1  2(p1) 3  4(p2) 5(delivery)
    const map = lineMap(["3", "3", "3", "3", "3", "2"]);
    const tour = buildTourProblem({
      myPos: { x: 0, y: 0 },
      carried: [],
      freeParcels: [
        { id: "p1", x: 2, y: 0, reward: 10, updatedAt: 0 },
        { id: "p2", x: 4, y: 0, reward: 10, updatedAt: 0 },
      ],
      map,
      now: 0,
      settings: NO_DECAY,
    });
    expect(tour).not.toBeNull();
    if (tour === null) return;

    const solver = new LocalSolver({
      cmd: `${PYPERPLAN} -s astar -H lmcut`,
    });
    const steps = await solver.solve(PDDL_DOMAIN, tour.problemText);
    expect(steps).not.toBeNull();
    if (steps === null) return;

    const actions = steps.map((s) => s.action);
    // Optimal = batched: 3 abstract moves (me→p1→p2→delivery), 2 pickups,
    // 2 delivers. A deliver-as-you-go tour would need 4 moves — the optimal
    // planner must find the 3-move sequencing.
    expect(actions.filter((a) => a === "move")).toHaveLength(3);
    expect(actions.filter((a) => a === "pickup")).toHaveLength(2);
    expect(actions.filter((a) => a === "deliver")).toHaveLength(2);
    // Both delivers happen at the end (single delivery visit).
    expect(actions.at(-1)).toBe("deliver");
    expect(actions.at(-2)).toBe("deliver");
  }, 30_000);

  it("solves the carried-only case (goal already reachable in one hop)", async () => {
    const map = lineMap(["3", "3", "2"]);
    const tour = buildTourProblem({
      myPos: { x: 0, y: 0 },
      carried: [{ id: "c1", reward: 8, updatedAt: 0 }],
      freeParcels: [],
      map,
      now: 0,
      settings: NO_DECAY,
    });
    expect(tour).not.toBeNull();
    if (tour === null) return;

    const solver = new LocalSolver({ cmd: `${PYPERPLAN} -s astar -H lmcut` });
    const steps = await solver.solve(PDDL_DOMAIN, tour.problemText);
    expect(steps).toEqual([
      { action: "move", args: ["l_0_0", "l_2_0"] },
      { action: "deliver", args: ["p_c1", "l_2_0"] },
    ]);
  }, 30_000);
});
