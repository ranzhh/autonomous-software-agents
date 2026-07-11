/**
 * BDI deliberation: generate candidate intentions from beliefs, rank them by
 * expected value, and commit to the best one — switching away only when the
 * current intention becomes invalid or a clearly better option emerges.
 *
 * `deliberate` is a pure function: given beliefs and the current time it
 * returns a sorted list of `{intention, value}` candidates. `IntentionRevision`
 * wraps the stateful "compare against current commitment + hysteresis" logic.
 *
 * Hysteresis (HYSTERESIS = 0.2): switching is suppressed unless the new
 * candidate is at least 20 % better than the current one. This prevents the
 * agent from thrashing between targets of similar value. Two exceptions:
 *   - The current intention is *invalid* (parcel gone/taken/expired, delivery
 *     tile no longer reachable, or phantom-carry) → immediate drop.
 *   - The current intention is `explore` → always switch to any real intention.
 */

import type { BeliefSet, GameMap, Pos } from "../../core/beliefs/index.js";
import { bfsToNearest } from "../../core/pathfinding/index.js";
import {
  deliverValue,
  enRouteTourValue,
  pickupValue,
} from "../reward/value.js";
import type {
  DeliverIntention,
  ExploreIntention,
  Intention,
  PickupIntention,
} from "./intention.js";

/** A candidate intention with its computed expected value. */
export interface Candidate {
  readonly intention: Intention;
  readonly value: number;
}

/** Same goal? (kind + target tile, and the parcel for pickups). */
function sameIntention(a: Intention, b: Intention): boolean {
  if (a.kind !== b.kind) return false;
  if (a.target.x !== b.target.x || a.target.y !== b.target.y) return false;
  if (a.kind === "pickup" && b.kind === "pickup") {
    return a.parcelId === b.parcelId;
  }
  return true;
}

/**
 * The hysteresis margin: switch only when `newValue > currentValue × (1 + HYSTERESIS)`.
 * Chosen conservatively at 20 % to avoid thrashing between similarly-valued parcels.
 */
const HYSTERESIS = 0.2;

// ---------------------------------------------------------------------------
// Explore target generation
// ---------------------------------------------------------------------------

/** Minimum Manhattan distance from current position for an explore target. */
const MIN_EXPLORE_DISTANCE = 3;

/**
 * Pick a random walkable tile at least `MIN_EXPLORE_DISTANCE` steps from
 * `myPos`. Falls back to any walkable tile if the map is too small/crowded.
 */
export function randomExploreTarget(map: GameMap, myPos: Pos): Pos {
  const walkable = map.spawnerTiles.length > 0 ? map.spawnerTiles : [];
  // Prefer spawner tiles (parcels appear there); fall back to delivery tiles.
  const candidates =
    walkable.length > 0 ? walkable : (map.deliveryTiles as Pos[]);

  const far = candidates.filter(
    (t) =>
      Math.abs(t.x - myPos.x) + Math.abs(t.y - myPos.y) >= MIN_EXPLORE_DISTANCE,
  );
  const pool = far.length > 0 ? far : candidates;
  if (pool.length === 0) return myPos; // degenerate map — stay put

  const idx = Math.floor(Math.random() * pool.length);
  const picked = pool[idx];
  return picked ?? myPos;
}

// ---------------------------------------------------------------------------
// Nearest delivery tile helper
// ---------------------------------------------------------------------------

function nearestDelivery(map: GameMap, from: Pos): Pos | undefined {
  const result = bfsToNearest(map, from, map.deliveryTiles);
  if (result === null) return undefined;
  return result[result.length - 1];
}

// ---------------------------------------------------------------------------
// deliberate — pure ranking function
// ---------------------------------------------------------------------------

/**
 * Generate a ranked list of candidate intentions from `beliefs` at time `now`.
 *
 * Priority order:
 *  1. Deliver (if carrying parcels and a delivery tile is reachable).
 *  2. Pickup (one candidate per free parcel, filtered to positive value).
 *  3. Explore (always included as the fallback with value 0).
 *
 * Pickup values are comparable to the deliver value so the two compete directly:
 *  - empty-handed → `pickupValue` (full me→parcel→delivery journey);
 *  - already carrying → `enRouteTourValue` (total reward delivered if I divert via
 *    the parcel and then deliver the whole stack). A divert candidate only outranks
 *    "deliver now" when the new parcel's reward beats the extra decay the detour
 *    inflicts on the carried stack — so opportunistic multi-parcel pickup falls out
 *    of the same ranking, no extra intention kind needed. (Zero-detour freebies the
 *    agent simply walks over are grabbed by `GoTo` itself.)
 *
 * The list is sorted descending by value. `explore` will always be last.
 */
export function deliberate(beliefs: BeliefSet, now: number): Candidate[] {
  const myRaw = beliefs.me;
  if (myRaw?.x === undefined || myRaw.y === undefined) return [];

  const myPos: Pos = { x: Math.round(myRaw.x), y: Math.round(myRaw.y) };
  const map = beliefs.gameMap;
  const settings = beliefs.settings;

  if (map === undefined || settings === undefined) return [];

  const candidates: Candidate[] = [];

  // --- Deliver intention ---
  const carried = beliefs.parcels.carriedByMe();
  if (carried.length > 0) {
    const delivery = nearestDelivery(map, myPos);
    if (delivery !== undefined) {
      const value = deliverValue(carried, myPos, delivery, now, settings, map);
      const intention: DeliverIntention = { kind: "deliver", target: delivery };
      candidates.push({ intention, value });
    }
  }

  // --- Pickup intentions ---
  const free = beliefs.parcels.free();
  for (const parcel of free) {
    const parcelPos: Pos = { x: parcel.x, y: parcel.y };
    const delivery = nearestDelivery(map, parcelPos);
    if (delivery === undefined) continue;

    const value =
      carried.length > 0
        ? enRouteTourValue(parcel, carried, myPos, delivery, now, settings, map)
        : pickupValue(parcel, myPos, delivery, now, settings, map);
    if (value <= 0) continue;

    const intention: PickupIntention = {
      kind: "pickup",
      parcelId: parcel.id,
      target: parcelPos,
    };
    candidates.push({ intention, value });
  }

  // Sort descending by value.
  candidates.sort((a, b) => b.value - a.value);

  // --- Explore fallback ---
  const exploreTarget = randomExploreTarget(map, myPos);
  const explore: ExploreIntention = { kind: "explore", target: exploreTarget };
  candidates.push({ intention: explore, value: 0 });

  return candidates;
}

// ---------------------------------------------------------------------------
// IntentionRevision — stateful commitment + hysteresis
// ---------------------------------------------------------------------------

/**
 * Wraps `deliberate` with a committed intention and a hysteresis guard. Call
 * `revise(beliefs, now)` after every sensing event; it returns the new
 * intention to adopt, or `undefined` to keep the current one.
 *
 * The caller is responsible for stopping the current plan and starting the
 * new one when a non-`undefined` value is returned.
 */
export class IntentionRevision {
  private current: Candidate | undefined = undefined;

  /** The currently committed intention (for logging/diagnostics). */
  get committed(): Intention | undefined {
    return this.current?.intention;
  }

  /**
   * Re-deliberate from `beliefs` at time `now`. Returns the new intention to
   * adopt, or `undefined` if the current commitment should continue unchanged.
   */
  revise(beliefs: BeliefSet, now: number): Intention | undefined {
    const candidates = deliberate(beliefs, now);
    const best = candidates[0];

    // No candidates at all (map/position not ready yet).
    if (best === undefined) return undefined;

    const prev = this.current;

    // No current commitment — adopt the best candidate immediately.
    if (prev === undefined) {
      this.current = best;
      return best.intention;
    }

    // --- Validity check: drop current intention if it has become invalid ---
    if (this.isInvalid(prev.intention, beliefs)) {
      this.current = best;
      return best.intention;
    }

    // --- Refresh the commitment's value to what it is worth NOW ---
    // Hysteresis must compare against the commitment's re-computed value, not
    // its commit-time one: values inflate as the agent approaches its target,
    // so a stale baseline lets the (often identical) best "beat" it every
    // belief tick — live 2026-07-10 this restarted the running plan dozens of
    // times per second and the agent never completed a tour.
    const refreshed = candidates.find((c) =>
      sameIntention(c.intention, prev.intention),
    );
    if (refreshed !== undefined) this.current = refreshed;
    const currentValue = refreshed?.value ?? prev.value;

    // --- Re-adopting the identical intention is not a switch ---
    if (sameIntention(best.intention, prev.intention)) return undefined;

    // --- Always switch from explore to a real intention ---
    if (
      prev.intention.kind === "explore" &&
      best.intention.kind !== "explore"
    ) {
      this.current = best;
      return best.intention;
    }

    // --- Hysteresis: switch only if the new best is significantly better ---
    const threshold = currentValue * (1 + HYSTERESIS);
    if (best.value > threshold && best.intention.kind !== "explore") {
      this.current = best;
      return best.intention;
    }

    // Keep the current intention.
    return undefined;
  }

  /**
   * Force a re-deliberation on the next `revise` call (e.g. after a plan
   * failure). Clears the current commitment so the agent starts fresh.
   */
  reset(): void {
    this.current = undefined;
  }

  // ---------------------------------------------------------------------------
  // Validity helpers
  // ---------------------------------------------------------------------------

  private isInvalid(intention: Intention, beliefs: BeliefSet): boolean {
    switch (intention.kind) {
      case "goto":
        return false; // goto never becomes invalid from beliefs alone

      case "pickup": {
        // Invalid if the parcel is no longer free (taken, expired, delivered).
        const isStillFree = beliefs.parcels
          .free()
          .some((p) => p.id === intention.parcelId);
        return !isStillFree;
      }

      case "deliver": {
        // Invalid if we are no longer carrying any parcels (phantom-carry
        // guard: parcels delivered → beliefs drops them → carried = 0).
        return beliefs.parcels.carriedByMe().length === 0;
      }

      case "explore":
        return false; // explore is always nominally valid (we'll just switch away)
    }
  }
}
