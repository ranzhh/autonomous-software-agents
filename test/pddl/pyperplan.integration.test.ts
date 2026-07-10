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
import { deliverValue, enRouteTourValue } from "../../src/bdi/reward/index.js";
import {
  buildGameMap,
  type GameMap,
  type Pos,
} from "../../src/core/beliefs/index.js";
import { astar } from "../../src/core/pathfinding/index.js";
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

/**
 * EXPERIMENT — "PDDL sequencing beats greedy" (the Phase-4 verification case;
 * numbers journaled in docs/journal.md 2026-07-10).
 *
 * Scenario: 7×3 grid, delivery (6,0); I'm at (0,0) carrying c1 (reward 30);
 * a small parcel p (reward 5) sits off-path at (3,2). Decay 1 s, move 100 ms.
 *
 *   deliverValue (deliver now, 6 steps)              = 30
 *   enRouteTourValue (divert via p, 10 steps, −1 tick) = 29 + 4 = 33
 *
 * Greedy (IntentionRevision) needs 33 > 30 × 1.2 = 36 to switch → it delivers
 * first and backtracks for p afterwards: 6 + 5 + 5 = 16 real moves. The tour
 * builder's marginal filter needs only 33 − 30 = 3 > 0 → PDDL plans one tour
 * me→p→delivery: 5 + 5 = 10 real moves. 6 moves (37%) saved on this case —
 * the commitment hysteresis that protects greedy from thrashing is exactly
 * what blinds it to profitable batching; the planner sequences sub-goals
 * while the reward layer keeps deciding what is worth wanting.
 */
describe.skipIf(!hasPyperplan)(
  "experiment: PDDL tour vs greedy hysteresis",
  () => {
    function openGrid(w: number, h: number, delivery: Pos): GameMap {
      const tiles: IOTile[] = [];
      for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
          tiles.push({
            x,
            y,
            type: x === delivery.x && y === delivery.y ? "2" : "3",
          });
        }
      }
      return buildGameMap(w, h, tiles);
    }

    const map = openGrid(7, 3, { x: 6, y: 0 });
    const settings = { parcelDecayMs: 1000, movementDurationMs: 100 };
    const me: Pos = { x: 0, y: 0 };
    const delivery: Pos = { x: 6, y: 0 };
    const carried = [{ id: "c1", reward: 30, updatedAt: 0 }];
    const parcel = { id: "p", x: 3, y: 2, reward: 5, updatedAt: 0 };

    it("greedy's hysteresis skips the divert that the tour builder includes", () => {
      const deliverNow = deliverValue(carried, me, delivery, 0, settings, map);
      const divert = enRouteTourValue(
        parcel,
        carried,
        me,
        delivery,
        0,
        settings,
        map,
      );
      expect(deliverNow).toBe(30);
      expect(divert).toBe(33);
      // Greedy: 33 < 30 × 1.2 → keeps "deliver now", pays the backtrack later.
      expect(divert).toBeLessThan(deliverNow * 1.2);
      // Tour builder: marginal 3 > 0 → p joins the tour.
      const tour = buildTourProblem({
        myPos: me,
        carried,
        freeParcels: [parcel],
        map,
        now: 0,
        settings,
      });
      expect(tour?.candidateParcelIds).toEqual(["p"]);
    });

    it("the optimal tour saves 6 of greedy's 16 real moves (37%)", async () => {
      const tour = buildTourProblem({
        myPos: me,
        carried,
        freeParcels: [parcel],
        map,
        now: 0,
        settings,
      });
      expect(tour).not.toBeNull();
      if (tour === null) return;

      const solver = new LocalSolver({ cmd: `${PYPERPLAN} -s astar -H lmcut` });
      const steps = await solver.solve(PDDL_DOMAIN, tour.problemText);
      expect(steps).not.toBeNull();
      if (steps === null) return;

      // Expand the abstract tour into real steps with A* (what GoTo executes).
      const waypoints = steps
        .filter((s) => s.action === "move")
        .map((s) => {
          const target =
            s.args[1] === undefined
              ? undefined
              : tour.locationAt.get(s.args[1]);
          if (target === undefined) throw new Error(`unknown loc ${s.args[1]}`);
          return target;
        });
      let from = me;
      let pddlMoves = 0;
      for (const wp of waypoints) {
        const path = astar(map, from, wp);
        expect(path).not.toBeNull();
        pddlMoves += (path?.length ?? 1) - 1;
        from = wp;
      }
      // Greedy: deliver (6) + go back to p (5) + deliver again (5) = 16.
      const greedyMoves = 6 + 5 + 5;
      expect(pddlMoves).toBe(10);
      expect(greedyMoves - pddlMoves).toBe(6);
    }, 30_000);
  },
);
