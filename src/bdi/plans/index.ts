/**
 * bdi/plans — the reactive plan library. `BasePlan` defines the contract
 * (`isApplicableTo()` / `execute()` / `stop()`); concrete plans (GoTo, GoPickUp,
 * Deliver, Wander) achieve intentions by emitting SDK actions, re-pathing on
 * `emitMove === false` and aborting with `PlanFailedError`. The `PlanLibrary`
 * selects an applicable plan; this is also the reactive fallback for PDDL.
 *
 * Intended files (added in Phases 2–3):
 *   - base-plan.ts    — abstract BasePlan contract.
 *   - go-to.ts        — navigate to a tile (re-path, failure-aware).
 *   - go-pick-up.ts   — go to a parcel and pick up.
 *   - deliver.ts      — go to a delivery tile and put down.
 *   - wander.ts       — explore when nothing better is known.
 *   - plan-library.ts — typed registry + applicable-plan selection.
 */

export {};
