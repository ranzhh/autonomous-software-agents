/**
 * Pure value functions for ranking candidate intentions. No side effects, no
 * BeliefSet dependency — all inputs passed explicitly so every function is
 * fully unit-testable offline.
 *
 * Core idea: a pickup/deliver intention is worth the parcel reward that will
 * actually be collected at delivery time, accounting for:
 *   (a) decay already elapsed since last sensing (`updatedAt` → `now`), and
 *   (b) decay during the travel itself (steps × moveDurationMs / decayMs ticks).
 *
 * `pickupValue`     — standalone pickup + deliver (full path: me → parcel → delivery).
 * `deliverValue`    — deliver all currently-carried parcels (path: me → delivery).
 * `detourCost`      — extra steps when detouring via a parcel on the way to delivery.
 * `enRouteValue`    — opportunistic pickup while already heading to delivery:
 *                     same as `pickupValue` but uses `detourCost` as the decay driver
 *                     (since the committed delivery travel is paid regardless).
 * `enRouteTourValue`— total reward delivered if, while carrying `carried`, I divert via a
 *                     new parcel and then deliver the whole stack (me → parcel → delivery).
 *                     Directly comparable to `deliverValue` (both are total-delivered-value),
 *                     so deliberation can rank "divert for this parcel" against "deliver now":
 *                     the longer route decays the WHOLE carried stack (cost scales with how
 *                     many parcels I hold), and a divert only wins when the new parcel's
 *                     reward outweighs that extra stack decay.
 */

import type { GameMap, Pos } from "../../core/beliefs/index.js";
import type { Settings } from "../../core/beliefs/settings.js";
import { astar, samePos } from "../../core/pathfinding/index.js";

/** Minimal parcel shape required by the value functions. */
export interface ParcelLike {
  readonly reward: number;
  /** Timestamp (ms) when `reward` was last observed. */
  readonly updatedAt: number;
  readonly x: number;
  readonly y: number;
}

type RewardSettings = Pick<Settings, "parcelDecayMs" | "movementDurationMs">;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** A* path length (number of steps), or `null` if unreachable. */
function stepsTo(map: GameMap, from: Pos, to: Pos): number | null {
  if (samePos(from, to)) return 0;
  const path = astar(map, from, to);
  if (path === null) return null;
  return path.length - 1;
}

/**
 * Decay ticks lost while making `steps` moves.
 * Returns 0 when `decayMs` is infinite (no-decay maps).
 */
function decayDuringTravel(
  steps: number,
  moveDurationMs: number,
  decayMs: number,
): number {
  if (!Number.isFinite(decayMs) || steps <= 0) return 0;
  return Math.floor((steps * moveDurationMs) / decayMs);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Remaining reward of a parcel at time `now`, accounting for local decay since
 * its last sensed `updatedAt`. Returns 0 if the parcel has expired.
 */
export function currentReward(
  lastReward: number,
  updatedAt: number,
  now: number,
  decayMs: number,
): number {
  if (!Number.isFinite(decayMs)) return lastReward;
  const elapsed = Math.max(0, now - updatedAt);
  const ticks = Math.floor(elapsed / decayMs);
  return Math.max(0, lastReward - ticks);
}

/**
 * Expected reward of `parcel` when picked up and delivered: starts from the
 * current reward, then subtracts decay accumulated during the full journey
 * myPos → parcel → deliveryPos. Returns 0 if the parcel is unreachable or
 * will expire before we can deliver it.
 */
export function pickupValue(
  parcel: ParcelLike,
  myPos: Pos,
  deliveryPos: Pos,
  now: number,
  settings: RewardSettings,
  map: GameMap,
): number {
  const parcelPos: Pos = { x: parcel.x, y: parcel.y };
  const s1 = stepsTo(map, myPos, parcelPos);
  if (s1 === null) return 0;
  const s2 = stepsTo(map, parcelPos, deliveryPos);
  if (s2 === null) return 0;

  const { parcelDecayMs, movementDurationMs } = settings;
  const cur = currentReward(
    parcel.reward,
    parcel.updatedAt,
    now,
    parcelDecayMs,
  );
  const lost = decayDuringTravel(s1 + s2, movementDurationMs, parcelDecayMs);
  return Math.max(0, cur - lost);
}

/**
 * Expected total reward when delivering all `carried` parcels to `deliveryPos`.
 * Each parcel decays during the travel steps; parcels that would expire in
 * transit contribute 0. Returns 0 if there is nothing to carry or no path.
 */
export function deliverValue(
  carried: ReadonlyArray<Pick<ParcelLike, "reward" | "updatedAt">>,
  myPos: Pos,
  deliveryPos: Pos,
  now: number,
  settings: RewardSettings,
  map: GameMap,
): number {
  if (carried.length === 0) return 0;
  const steps = stepsTo(map, myPos, deliveryPos);
  if (steps === null) return 0;

  const { parcelDecayMs, movementDurationMs } = settings;
  const lost = decayDuringTravel(steps, movementDurationMs, parcelDecayMs);
  return carried.reduce<number>((sum, p) => {
    const cur = currentReward(p.reward, p.updatedAt, now, parcelDecayMs);
    return sum + Math.max(0, cur - lost);
  }, 0);
}

/**
 * Extra steps added by detouring via `parcelPos` on the way from `myPos` to
 * `deliveryPos`. Returns 0 when the parcel lies on (or adjacent to) the direct
 * path. Returns `+Infinity` when any leg is unreachable.
 */
export function detourCost(
  myPos: Pos,
  parcelPos: Pos,
  deliveryPos: Pos,
  map: GameMap,
): number {
  const direct = stepsTo(map, myPos, deliveryPos);
  if (direct === null) return Number.POSITIVE_INFINITY;
  const leg1 = stepsTo(map, myPos, parcelPos);
  if (leg1 === null) return Number.POSITIVE_INFINITY;
  const leg2 = stepsTo(map, parcelPos, deliveryPos);
  if (leg2 === null) return Number.POSITIVE_INFINITY;
  return Math.max(0, leg1 + leg2 - direct);
}

/**
 * Value of grabbing `parcel` opportunistically while already heading to
 * `deliveryPos`. Uses `detourCost` (extra steps) as the decay driver instead of
 * the full myPos→parcel→delivery travel, reflecting that the committed delivery
 * journey is paid regardless. A detour of 0 (parcel on path) means the current
 * reward is captured nearly in full.
 */
export function enRouteValue(
  parcel: ParcelLike,
  myPos: Pos,
  deliveryPos: Pos,
  now: number,
  settings: RewardSettings,
  map: GameMap,
): number {
  const parcelPos: Pos = { x: parcel.x, y: parcel.y };
  const extra = detourCost(myPos, parcelPos, deliveryPos, map);
  if (!Number.isFinite(extra)) return 0;

  const { parcelDecayMs, movementDurationMs } = settings;
  const cur = currentReward(
    parcel.reward,
    parcel.updatedAt,
    now,
    parcelDecayMs,
  );
  const lost = decayDuringTravel(extra, movementDurationMs, parcelDecayMs);
  return Math.max(0, cur - lost);
}

/**
 * Total reward delivered if, while already carrying `carried`, I divert via the
 * free `parcel` and then deliver the whole (carried + parcel) stack along the
 * route myPos → parcel → deliveryPos. Every parcel (carried and new) decays over
 * the full `legA + legB` travel — so the cost of the detour grows with the size
 * of the carried stack. Returns 0 if either leg is unreachable.
 *
 * Comparable to `deliverValue(carried, myPos, nearestDelivery)`: ranking the two
 * lets deliberation decide "divert for this parcel" vs "deliver now" — the divert
 * wins only when the new parcel's reward beats the extra decay it inflicts on the
 * stack. With `carried = []` it reduces to `pickupValue`.
 */
export function enRouteTourValue(
  parcel: ParcelLike,
  carried: ReadonlyArray<Pick<ParcelLike, "reward" | "updatedAt">>,
  myPos: Pos,
  deliveryPos: Pos,
  now: number,
  settings: RewardSettings,
  map: GameMap,
): number {
  const parcelPos: Pos = { x: parcel.x, y: parcel.y };
  const legA = stepsTo(map, myPos, parcelPos);
  if (legA === null) return 0;
  const legB = stepsTo(map, parcelPos, deliveryPos);
  if (legB === null) return 0;

  const { parcelDecayMs, movementDurationMs } = settings;
  const lost = decayDuringTravel(
    legA + legB,
    movementDurationMs,
    parcelDecayMs,
  );

  const newParcel = Math.max(
    0,
    currentReward(parcel.reward, parcel.updatedAt, now, parcelDecayMs) - lost,
  );
  return carried.reduce<number>((sum, p) => {
    const cur = currentReward(p.reward, p.updatedAt, now, parcelDecayMs);
    return sum + Math.max(0, cur - lost);
  }, newParcel);
}
