/**
 * Multi-parcel tour problem builder. From a belief snapshot it builds a PDDL
 * problem over *waypoints* (my tile, candidate parcel tiles, their nearest
 * delivery tiles) joined by abstract complete-graph `connected` edges — the
 * planner sequences the tour (which parcels to batch before delivering), and
 * the executor expands each abstract `move` into real steps with A*.
 *
 * Candidate selection reuses the deliberation value functions: empty-handed a
 * parcel's worth is `pickupValue`; while carrying it is the *marginal* gain of
 * `enRouteTourValue` over delivering the stack directly (`deliverValue`) — the
 * absolute tour value includes the carried stack and would admit worthless
 * detours. Only positive, reachable parcels make it in, capped at
 * `maxCandidates` to keep the problem small and the solve fast. The goal is
 * `(delivered …)` for every carried parcel + every candidate.
 *
 * Returns `null` (caller falls back to a reactive plan) when: my position is
 * fractional (a move is mid-flight — CLAUDE.md §6), there is nothing to plan
 * (no carried parcels and no worthwhile candidates), or no delivery tile is
 * reachable.
 *
 * The problem string is built manually — `PddlProblem.toPddlString()` emits a
 * `(:domain default)` header and a `;;` comment line that `dual-bfws-ffparser`
 * rejects (CLAUDE.md §6) — and contains no comment lines for the same reason.
 */

import type { ParcelLike } from "../bdi/reward/index.js";
import {
  deliverValue,
  enRouteTourValue,
  pickupValue,
} from "../bdi/reward/index.js";
import type { GameMap, Pos } from "../core/beliefs/index.js";
import { astar, bfsToNearest } from "../core/pathfinding/index.js";
import { PDDL_DOMAIN_NAME } from "./domain.js";

/** A free parcel eligible for the tour (position + decay inputs). */
export interface TourFreeParcel extends ParcelLike {
  readonly id: string;
}

/** A parcel I am carrying (no position needed — it moves with me). */
export interface TourCarriedParcel {
  readonly id: string;
  readonly reward: number;
  readonly updatedAt: number;
}

/** The decay/travel settings the value functions need. */
export interface TourSettings {
  readonly parcelDecayMs: number;
  readonly movementDurationMs: number;
}

export interface TourInput {
  /** My position, possibly fractional mid-move (then the builder returns `null`). */
  readonly myPos: { readonly x: number; readonly y: number };
  readonly carried: readonly TourCarriedParcel[];
  readonly freeParcels: readonly TourFreeParcel[];
  readonly map: GameMap;
  readonly now: number;
  readonly settings: TourSettings;
  /**
   * Parcel id to force into the candidate set (the parcel the activating
   * `pickup` intention committed to), bypassing the value ranking.
   */
  readonly mustIncludeParcelId?: string | undefined;
  /** Max free parcels in the tour (default {@link MAX_CANDIDATE_PARCELS}). */
  readonly maxCandidates?: number | undefined;
}

/** A built problem plus the metadata needed to execute the solved plan. */
export interface TourProblem {
  /** The problem PDDL text (manual string; no comments; `(:domain deliveroo)`). */
  readonly problemText: string;
  /** Lowercase location object name → tile (for expanding solved `move` steps). */
  readonly locationAt: ReadonlyMap<string, Pos>;
  /** Lowercase parcel object name → game parcel id (solved plans are re-cased). */
  readonly parcelIdOf: ReadonlyMap<string, string>;
  /** The free-parcel ids included in the tour (for pre-step re-validation). */
  readonly candidateParcelIds: readonly string[];
}

/**
 * Default cap on free parcels in one tour. 3 keeps the waypoint graph ≤ ~8
 * nodes, which the local optimal solver handles in tens of milliseconds.
 */
export const MAX_CANDIDATE_PARCELS = 3;

function locationName(p: Pos): string {
  return `l_${p.x}_${p.y}`;
}

/**
 * PDDL-safe, lowercase parcel object name. Distinct raw ids that sanitize to
 * the same name are disambiguated with a numeric suffix.
 */
function parcelName(id: string, taken: ReadonlyMap<string, string>): string {
  const base = `p_${id.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

function isReachable(map: GameMap, from: Pos, to: Pos): boolean {
  return astar(map, from, to) !== null;
}

function nearestDelivery(map: GameMap, from: Pos): Pos | undefined {
  const path = bfsToNearest(map, from, map.deliveryTiles);
  if (path === null) return undefined;
  return path[path.length - 1];
}

/**
 * Build the multi-parcel tour problem from a belief snapshot, or `null` when
 * there is nothing plannable (see module doc for the exact conditions).
 */
export function buildTourProblem(input: TourInput): TourProblem | null {
  const { map, carried, now, settings } = input;

  // Mid-move guard: fractional coords mean an emitMove is in flight; planning
  // from a rounded position could expand the first leg off by one tile.
  if (!Number.isInteger(input.myPos.x) || !Number.isInteger(input.myPos.y)) {
    return null;
  }
  const myPos: Pos = { x: input.myPos.x, y: input.myPos.y };

  // --- Candidate selection: positive-marginal-value, reachable parcels -----
  // While carrying, a parcel is only worth adding if diverting for it beats
  // delivering the stack directly — i.e. its *marginal* tour value is positive.
  const myDelivery = nearestDelivery(map, myPos);
  const deliverBaseline =
    carried.length > 0 && myDelivery !== undefined
      ? deliverValue(carried, myPos, myDelivery, now, settings, map)
      : 0;
  const scored = input.freeParcels
    .filter((p) => isReachable(map, myPos, p))
    .map((parcel) => {
      const delivery = nearestDelivery(map, parcel);
      if (delivery === undefined) return undefined;
      const value =
        carried.length > 0
          ? enRouteTourValue(
              parcel,
              carried,
              myPos,
              delivery,
              now,
              settings,
              map,
            ) - deliverBaseline
          : pickupValue(parcel, myPos, delivery, now, settings, map);
      return { parcel, value };
    })
    .filter((c) => c !== undefined);

  const maxCandidates = input.maxCandidates ?? MAX_CANDIDATE_PARCELS;
  const forced = scored.find((c) => c.parcel.id === input.mustIncludeParcelId);
  const ranked = scored
    .filter((c) => c.value > 0 && c !== forced)
    .sort((a, b) => b.value - a.value);
  const candidates = [
    ...(forced !== undefined ? [forced] : []),
    ...ranked,
  ].slice(0, maxCandidates);

  if (carried.length === 0 && candidates.length === 0) return null;

  // --- Waypoints: me + parcel tiles + their nearest deliveries -------------
  const locationAt = new Map<string, Pos>();
  const addLocation = (p: Pos): string => {
    const name = locationName(p);
    if (!locationAt.has(name)) locationAt.set(name, p);
    return name;
  };

  const startLoc = addLocation(myPos);
  const parcelLocs = candidates.map((c) => addLocation(c.parcel));

  const deliveryLocs = new Set<string>();
  for (const from of [myPos, ...candidates.map((c) => c.parcel)]) {
    const delivery = nearestDelivery(map, from);
    if (delivery !== undefined) deliveryLocs.add(addLocation(delivery));
  }
  if (deliveryLocs.size === 0) return null;

  // --- Parcel objects -------------------------------------------------------
  const parcelIdOf = new Map<string, string>();
  const addParcel = (id: string): string => {
    const name = parcelName(id, parcelIdOf);
    parcelIdOf.set(name, id);
    return name;
  };
  const candidateNames = candidates.map((c) => addParcel(c.parcel.id));
  const carriedNames = carried.map((p) => addParcel(p.id));

  // --- Facts ----------------------------------------------------------------
  // All waypoints are reachable from my tile (candidates are filtered on it,
  // deliveries are found by BFS from reachable tiles) and the grid is
  // undirected, so every pair lies in one connected component → the complete
  // graph needs no per-pair path checks.
  const locations = [...locationAt.keys()];
  const init: string[] = [`(at ${startLoc})`];
  for (const l of deliveryLocs) init.push(`(delivery ${l})`);
  candidates.forEach((_, i) => {
    const loc = parcelLocs[i];
    const name = candidateNames[i];
    if (loc !== undefined && name !== undefined) {
      init.push(`(parcel-at ${name} ${loc})`);
    }
  });
  for (const name of carriedNames) init.push(`(carrying ${name})`);
  for (const a of locations) {
    for (const b of locations) {
      if (a !== b) init.push(`(connected ${a} ${b})`);
    }
  }

  const goals = [...carriedNames, ...candidateNames].map(
    (name) => `(delivered ${name})`,
  );

  const problemText = [
    "(define (problem deliveroo-tour)",
    `  (:domain ${PDDL_DOMAIN_NAME})`,
    "  (:objects",
    `    ${locations.join(" ")} - location`,
    `    ${[...parcelIdOf.keys()].join(" ")} - parcel)`,
    "  (:init",
    ...init.map((fact) => `    ${fact}`),
    "  )",
    `  (:goal (and ${goals.join(" ")}))`,
    ")",
  ].join("\n");

  return {
    problemText,
    locationAt,
    parcelIdOf,
    candidateParcelIds: candidates.map((c) => c.parcel.id),
  };
}
