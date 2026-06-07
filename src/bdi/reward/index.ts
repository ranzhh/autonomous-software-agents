/**
 * bdi/reward — the value functions deliberation uses to rank candidate
 * intentions: remaining-reward after decay, distance/detour cost, multi-pickup
 * and en-route opportunistic pickup, and capacity as an advisory (not enforced
 * server-side). This is where Level-2 mission policy reshapes standard play via
 * reward shaping (per-tile multipliers, max parcel value).
 *
 * Intended files (added in Phase 3, extended in Phase 7):
 *   - value.ts — decay/distance/detour value of a pickup/deliver intention.
 */

export {};
