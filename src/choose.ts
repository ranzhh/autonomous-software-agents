import type { AgentBelief, Beliefs, ParcelBelief } from "./beliefs.js";
import type { Grid } from "./grid.js";
import type { IOConfig, Position } from "./sdk.js";
import { nearestOrder } from "./tour.js";
import { priced, type Value, value } from "./value.js";

export interface Batch {
  parcels: ParcelBelief[];
  worth: number;
}

export type Cause = "gone" | "expired" | "beaten" | "stalled";

const FRESH = 1_000;

export function supersedes(
  batch: Batch,
  held: number | undefined,
  lost: boolean,
  margin: number,
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
): Batch {
  const ranked = loose
    .map((p) => ({ p, worth: priced(at, [p], carried, grid, value) }))
    .filter(({ worth }) => worth > 0)
    .sort((a, b) => b.worth - a.worth)
    .map(({ p }) => p);

  let best: Batch = {
    parcels: [],
    worth: priced(at, [], carried, grid, value),
  };
  for (let k = 1; k <= ranked.length; k++) {
    const parcels = nearestOrder(at, ranked.slice(0, k), grid);
    if (parcels.length < k) break;
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

export function choose(
  beliefs: Beliefs,
  grid: Grid,
  config: IOConfig,
  now = Date.now(),
): Batch {
  const at = beliefs.me();
  const rivals = beliefs.agents().filter((a) => now - a.seenAt < FRESH);
  const loose = beliefs.parcels(now).filter((p) => !p.carriedBy);
  return bestK(
    at,
    unclaimed(at, loose, rivals, grid),
    beliefs.carrying(now),
    grid,
    value(config),
  );
}
