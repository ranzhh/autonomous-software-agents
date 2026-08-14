/**
 * bdi/plans — the reactive plan library. `BasePlan` defines the contract
 * (`isApplicableTo` / `execute` / `stop`); concrete plans achieve intentions by
 * emitting SDK actions, re-pathing on `emitMove === false` and aborting with a
 * `PlanFailedError`. `PlanLibrary` selects an applicable plan; this is also the
 * reactive fallback for PDDL. Plans run against a narrow `PlanContext` (self
 * position, map, blockers, emitters, wait) so they stay unit-testable.
 */

export { BasePlan } from "./base-plan.js";
export { Deliver } from "./deliver.js";
export { GoPickUp } from "./go-pick-up.js";
export { GoTo, type GoToOptions } from "./go-to.js";
export {
  createPlanContext,
  type PlanContext,
  type PlanContextOptions,
} from "./plan-context.js";
export { type PlanFactory, PlanLibrary } from "./plan-library.js";
export { Wander } from "./wander.js";
