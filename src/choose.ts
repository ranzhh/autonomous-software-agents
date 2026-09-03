import type { AgentBelief, Beliefs, ParcelBelief } from "./beliefs.js";
import type { Grid } from "./grid.js";
import { sameTile } from "./position.js";
import type { IOConfig, Position } from "./sdk.js";
import { nearestOrder } from "./tour.js";
import { MARGIN, priced, type Value, value } from "./value.js";

export interface Batch {
  parcels: ParcelBelief[];
  worth: number;
}

export type Cause = "gone" | "expired" | "beaten" | "stalled" | "ordered";

export const FRESH = 1_000;

export function supersedes(
  batch: Batch,
  held: number | undefined,
  lost: boolean,
  margin = MARGIN,
): Cause | undefined {
  if (lost) return "gone";
  // No tour to walk: nothing else will rebuild the commitment.
  if (held === undefined) return batch.worth > 0 ? "stalled" : undefined;
  if (held <= 0) return "expired";
  return batch.worth > held * margin ? "beaten" : undefined;
}

export function bestK(
  at: Position,
  loose: ParcelBelief[],
  carried: ParcelBelief[],
  grid: Grid,
  value: Value,
  batch = 1,
): Batch {
  const ranked = loose
    .map((p) => ({ p, worth: priced(at, [p], carried, grid, value) }))
    .filter(({ worth }) => worth > 0)
    .sort((a, b) => b.worth - a.worth)
    .map(({ p }) => p);

  let best: Batch = {
    parcels: [],
    worth: carried.length >= batch ? priced(at, [], carried, grid, value) : 0,
  };
  for (let k = 1; k <= ranked.length; k++) {
    const parcels = nearestOrder(at, ranked.slice(0, k), grid);
    if (parcels.length < k) break;
    if (parcels.length + carried.length < batch) continue;
    const worth = priced(at, parcels, carried, grid, value);
    if (worth > best.worth) best = { parcels, worth };
  }
  return best;
}

function unclaimed(
  at: Position,
  loose: ParcelBelief[],
  rivals: AgentBelief[],
  grid: Grid,
): ParcelBelief[] {
  if (rivals.length === 0) return loose;
  return loose.filter((parcel) => {
    const field = grid.route(parcel);
    const mine = field.distance(at);
    return !rivals.some((rival) => field.distance(rival) < mine);
  });
}

export interface Mates {
  id: string;
  /** Where the teammate last reported standing; undefined until it has. */
  at: Position | undefined;
  claimed: ReadonlySet<string>;
}

/** Whether the teammate's claim outranks ours: the shorter walk takes it, the id settles a tie. */
export function conceded(
  parcel: Position,
  at: Position,
  me: string,
  mates: Mates,
  grid: Grid,
): boolean {
  if (mates.at === undefined) return true;
  const field = grid.route(parcel);
  const theirs = field.distance(mates.at);
  const ours = field.distance(at);
  return theirs < ours || (theirs === ours && me > mates.id);
}

export interface Terms {
  /** A delivery pays only from this many parcels up. */
  batch: number;
  /** A tile whose parcels are somebody else's to take. */
  leave: Position | undefined;
}

export function choose(
  beliefs: Beliefs,
  grid: Grid,
  config: IOConfig,
  now = Date.now(),
  mates?: Mates,
  terms?: Terms,
): Batch {
  const at = beliefs.me();
  const rivals = beliefs
    .agents()
    .filter((a) => a.id !== mates?.id && now - a.seenAt < FRESH);
  const loose = beliefs
    .parcels(now)
    .filter(
      (p) =>
        !p.carriedBy &&
        !(mates?.claimed.has(p.id) && conceded(p, at, at.id, mates, grid)) &&
        !(terms?.leave && sameTile(p, terms.leave)),
    );
  return bestK(
    at,
    unclaimed(at, loose, rivals, grid),
    beliefs.carrying(now),
    grid,
    value(config),
    terms?.batch,
  );
}
