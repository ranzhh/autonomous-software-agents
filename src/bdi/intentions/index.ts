/**
 * bdi/intentions — the deliberation half of the BDI loop. An `Intention` is a
 * committed goal that runs a `Plan` (or `PddlPlan`); the `IntentionRevision` loop
 * deliberates candidate intentions from beliefs, commits the highest-value
 * applicable one, drops it when it becomes invalid, and switches to a better one
 * only past a hysteresis margin (so the agent doesn't thrash between targets).
 *
 * Files:
 *   - intention.ts          — Intention discriminated union (seeded in Phase 2
 *                             with `goto`; extended in Phase 3).
 *   - intention-revision.ts — deliberate/commit/drop/switch loop with hysteresis
 *                             (added in Phase 3).
 */

export type {
  DeliverIntention,
  ExploreIntention,
  GoToIntention,
  Intention,
  PickupIntention,
} from "./intention.js";
export {
  type Candidate,
  deliberate,
  IntentionRevision,
  randomExploreTarget,
} from "./intention-revision.js";
