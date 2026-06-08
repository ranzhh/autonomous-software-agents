/**
 * An `Intention` is a concrete goal the agent commits to and a `Plan` achieves.
 * Phase 2 seeds the single navigation variant (`goto`); Phase 3 extends this
 * discriminated union (`pickup`/`deliver`/`explore`) together with the
 * `IntentionRevision` loop that deliberates them from beliefs. Plans match on
 * `kind` with an exhaustive `switch`, so adding a variant forces every plan to
 * acknowledge it.
 */

import type { Pos } from "../../core/beliefs/index.js";

/** Navigate to a specific tile. */
export interface GoToIntention {
  readonly kind: "goto";
  readonly target: Pos;
}

export type Intention = GoToIntention;
