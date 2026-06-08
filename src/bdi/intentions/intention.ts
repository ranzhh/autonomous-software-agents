/**
 * An `Intention` is a concrete goal the agent commits to and a `Plan` achieves.
 * Plans match on `kind` with an exhaustive switch, so adding a variant forces
 * every plan to acknowledge it.
 *
 * Priority order (highest → lowest): deliver > pickup > explore. `goto` is a
 * low-level navigation primitive used directly by plans, not by deliberation.
 */

import type { Pos } from "../../core/beliefs/index.js";

/** Low-level: navigate to a specific tile (used directly by plans). */
export interface GoToIntention {
  readonly kind: "goto";
  readonly target: Pos;
}

/** Commit to picking up a specific free parcel at `target`. */
export interface PickupIntention {
  readonly kind: "pickup";
  readonly parcelId: string;
  readonly target: Pos;
}

/** Carry all held parcels to the delivery tile `target`. */
export interface DeliverIntention {
  readonly kind: "deliver";
  readonly target: Pos;
}

/**
 * Wander toward `target` (a random walkable tile). Lowest priority; always
 * yields immediately to any real intention.
 */
export interface ExploreIntention {
  readonly kind: "explore";
  readonly target: Pos;
}

export type Intention =
  | GoToIntention
  | PickupIntention
  | DeliverIntention
  | ExploreIntention;
