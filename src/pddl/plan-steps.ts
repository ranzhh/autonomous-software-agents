/**
 * Solved-plan → executable-step mapping. Abstract solver steps (`move` between
 * waypoints, per-parcel `pickup`/`deliver`) become `TourStep`s the executor
 * runs with the existing primitives: `goto` legs (expanded to real moves by
 * `GoTo`'s A*), and tile-level `pickup`/`putdown` actions. Because the game's
 * `pickup` grabs every parcel on the tile and `putdown` drops the whole stack
 * (CLAUDE.md §6), consecutive per-parcel solver steps at one stop collapse
 * into a single game action.
 *
 * Inputs are expected lowercase (the `Solver` layer normalizes once); names
 * are resolved through the `TourProblem` maps built with the problem, and an
 * unknown action/name throws `PlannerError` (the plan then falls back).
 */

import type { Pos } from "../core/beliefs/index.js";
import { PlannerError } from "../core/util/index.js";
import type { TourProblem } from "./problem.js";
import type { PddlStep } from "./solvers.js";

export type TourStep =
  | { readonly kind: "goto"; readonly target: Pos }
  | { readonly kind: "pickup"; readonly parcelIds: readonly string[] }
  | { readonly kind: "putdown" };

function resolveLocation(tour: TourProblem, name: string | undefined): Pos {
  const pos = name === undefined ? undefined : tour.locationAt.get(name);
  if (pos === undefined) {
    throw new PlannerError(`solved plan references unknown location "${name}"`);
  }
  return pos;
}

function resolveParcelId(tour: TourProblem, name: string | undefined): string {
  const id = name === undefined ? undefined : tour.parcelIdOf.get(name);
  if (id === undefined) {
    throw new PlannerError(`solved plan references unknown parcel "${name}"`);
  }
  return id;
}

/** Map a solved plan onto executable tour steps (collapsing same-tile actions). */
export function mapSolvedPlan(
  steps: readonly PddlStep[],
  tour: TourProblem,
): TourStep[] {
  const result: TourStep[] = [];

  for (const step of steps) {
    const last = result[result.length - 1];
    switch (step.action) {
      case "move": {
        result.push({
          kind: "goto",
          target: resolveLocation(tour, step.args[1]),
        });
        break;
      }
      case "pickup": {
        const parcelId = resolveParcelId(tour, step.args[0]);
        if (last?.kind === "pickup") {
          result[result.length - 1] = {
            kind: "pickup",
            parcelIds: [...last.parcelIds, parcelId],
          };
        } else {
          result.push({ kind: "pickup", parcelIds: [parcelId] });
        }
        break;
      }
      case "deliver": {
        // Validate the parcel name even though putdown drops the whole stack.
        resolveParcelId(tour, step.args[0]);
        if (last?.kind !== "putdown") result.push({ kind: "putdown" });
        break;
      }
      default:
        throw new PlannerError(
          `solved plan contains unknown action "${step.action}"`,
        );
    }
  }

  return result;
}
