/**
 * pddl — automated planning that the BDI invokes when an intention activates.
 * A multi-parcel tour problem (carried + N candidate free parcels + reachable
 * delivery tiles, abstract complete-graph moves expanded by A*) is built and
 * solved behind a `Solver` interface — remote `onlineSolver` baseline (default)
 * or an optional local planner — then mapped to executable steps as a `PddlPlan`
 * that replans on failure/belief change, with the reactive library as fallback.
 *
 * Intended files (added in Phase 4):
 *   - domain.pddl   — types location/parcel; actions move/pickup/deliver.
 *   - problem.ts    — multi-target problem builder (manual PDDL string; see §6).
 *   - solvers.ts    — Solver interface: remote onlineSolver | local pyperplan.
 *   - pddl-plan.ts  — build → solve → map → run; replan ≤2×; reactive fallback.
 */

export {};
