/**
 * bdi/reward — pure value functions deliberation uses to rank candidate
 * intentions: expected parcel reward at delivery time, accounting for decay
 * elapsed since last sensing and decay during travel. Detour cost for en-route
 * opportunistic pickup. Extended in Phase 7 with Level-2 reward shaping
 * (per-tile multipliers, max-parcel-value cap, stack-size gates).
 */

export {
  currentReward,
  deliverValue,
  detourCost,
  enRouteTourValue,
  enRouteValue,
  type ParcelLike,
  pickupValue,
} from "./value.js";
