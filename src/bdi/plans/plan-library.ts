/**
 * The reactive plan library: a registry of plans queried by intention. `select`
 * returns the first plan applicable to the intention, or `undefined` when none
 * applies (the caller falls back to exploration / re-deliberation). Phase 2
 * registers a single `GoTo`; Phase 3 adds GoPickUp/Deliver/Wander, and this is
 * also the reactive fallback path for PDDL.
 */

import type { Intention } from "../intentions/index.js";
import type { BasePlan } from "./base-plan.js";

export class PlanLibrary {
  private readonly plans: readonly BasePlan[];

  constructor(plans: readonly BasePlan[]) {
    this.plans = plans;
  }

  /** The first registered plan applicable to `intention`, or `undefined`. */
  select(intention: Intention): BasePlan | undefined {
    return this.plans.find((plan) => plan.isApplicableTo(intention));
  }
}
