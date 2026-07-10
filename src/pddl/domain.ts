/**
 * The Deliveroo PDDL domain, loaded from `domain.pddl` (the checked-in file is
 * the single source of truth so the same text feeds the remote solver, the
 * local pyperplan CLI, and the report).
 *
 * Formulation (ADR-0007): waypoint locations (not grid tiles) with abstract
 * complete-graph `move` actions that the executor expands into real steps via
 * A*. STRIPS-only (unit action cost — pyperplan supports no `:action-costs`),
 * so the planner minimizes waypoint *hops*: it learns tour *sequencing*
 * (batch pickups before delivering) while the BDI reward functions decide
 * which parcels are *valuable* — "sequencing, not valuation".
 *
 * The file is comment-free by design: `dual-bfws-ffparser` rejects `;;`
 * comment lines (CLAUDE.md §6).
 */

import { readFileSync } from "node:fs";

/** Must match the `(define (domain …))` name and every problem's `(:domain …)`. */
export const PDDL_DOMAIN_NAME = "deliveroo";

/** The full domain text, as sent to solvers. */
export const PDDL_DOMAIN: string = readFileSync(
  new URL("./domain.pddl", import.meta.url),
  "utf8",
);
