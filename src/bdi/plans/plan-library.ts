/**
 * The reactive plan library: a registry of plan *factories* queried by
 * intention. `select` builds candidates in registration order and returns the
 * first one applicable to the intention, or `undefined` when none applies (the
 * caller falls back to exploration / re-deliberation). It is also the reactive
 * fallback path for PDDL.
 *
 * **A fresh instance per selection is the point.** A plan holds per-execution
 * state (`aborted`, the inner `GoTo`), so a shared instance would host several
 * overlapping executions whenever deliberation preempts one — and `stop()`
 * could no longer be terminal, since the next `execute()` would have to clear
 * the abort flag and thereby resurrect the old run. Handing out fresh
 * instances is the same discipline the plans already apply internally, where
 * every navigation leg is a `new GoTo(ctx)` (see `GoTo`'s note on `stop()`).
 * → ADR-0008.
 */

import type { Intention } from "../intentions/index.js";
import type { BasePlan } from "./base-plan.js";

/** Builds a ready-to-execute plan. Called once per `select`. */
export type PlanFactory = () => BasePlan;

export class PlanLibrary {
  private readonly factories: readonly PlanFactory[];

  constructor(factories: readonly PlanFactory[]) {
    this.factories = factories;
  }

  /** A fresh instance of the first plan applicable to `intention`. */
  select(intention: Intention): BasePlan | undefined {
    for (const build of this.factories) {
      const plan = build();
      if (plan.isApplicableTo(intention)) return plan;
    }
    return undefined;
  }
}
