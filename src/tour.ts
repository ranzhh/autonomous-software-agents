import type { ParcelBelief } from "./beliefs.js";
import type { Grid, Route } from "./grid.js";
import { MOVES } from "./position.js";
import type { Position } from "./sdk.js";
import type { Value } from "./value.js";

export type Stop =
  | { action: "pickup"; at: Position; parcel: string }
  | { action: "deliver"; at: Position; bonus?: number | undefined }
  | { action: "visit"; at: Position; bonus: number; together: boolean };

export type Tour = Stop[];

export interface Planner {
  plan(
    from: Position,
    parcels: ParcelBelief[],
    grid: Grid,
  ): Promise<Tour | undefined>;
}

/** What the tour is worth as walked, banking each parcel at the stop that drops it. */
export function pricedTour(
  from: Position,
  tour: Tour,
  carried: ParcelBelief[],
  loose: ParcelBelief[],
  grid: Grid,
  { delivered }: Value,
): number {
  const rewards = new Map(loose.map((p) => [p.id, p.reward]));
  let at = from;
  let steps = 0;
  let held = carried.map((p) => p.reward);
  let worth = 0;
  for (const stop of tour) {
    steps += grid.route(stop.at).distance(at);
    if (!Number.isFinite(steps)) return 0;
    at = stop.at;
    if (stop.action === "visit") {
      worth += stop.bonus;
      continue;
    }
    if (stop.action === "deliver") {
      worth += delivered(held, steps) + (stop.bonus ?? 0);
      held = [];
      continue;
    }
    const reward = rewards.get(stop.parcel);
    if (reward !== undefined) held.push(reward);
  }
  return worth;
}

export function nearestOrder(
  from: Position,
  parcels: ParcelBelief[],
  grid: Grid,
): ParcelBelief[] {
  let left = parcels.map((parcel) => ({ parcel, route: grid.route(parcel) }));
  let at = from;
  const order: ParcelBelief[] = [];
  while (left.length > 0) {
    const next = left.reduce((closest, candidate) =>
      candidate.route.distance(at) < closest.route.distance(at)
        ? candidate
        : closest,
    );
    if (!Number.isFinite(next.route.distance(at))) break;
    at = { x: next.parcel.x, y: next.parcel.y };
    order.push(next.parcel);
    left = left.filter((candidate) => candidate !== next);
  }
  return order;
}

export function destination(
  route: Route,
  from: Position,
): Position | undefined {
  if (!Number.isFinite(route.distance(from))) return undefined;
  let at = from;
  for (let move = route.step(at); move; move = route.step(at))
    at = { x: at.x + MOVES[move].dx, y: at.y + MOVES[move].dy };
  return at;
}

/** The tour that collects `order` in that order and banks it all at the nearest of `ends`. */
export function touring(
  from: Position,
  order: ParcelBelief[],
  grid: Grid,
  ends: Position[] = grid.deliveries,
  bonus?: number,
): Tour | undefined {
  const stops: Tour = order.map((parcel) => ({
    action: "pickup",
    at: { x: parcel.x, y: parcel.y },
    parcel: parcel.id,
  }));
  const home = grid.route(...ends);
  const delivery = destination(home, stops.at(-1)?.at ?? from);
  return delivery
    ? [...stops, { action: "deliver", at: delivery, bonus }]
    : undefined;
}

/** The tour with `stop` inserted where it prices best, or unchanged when no place pays. */
export function place(
  from: Position,
  tour: Tour,
  stop: (from: Position) => Stop | undefined,
  price: (walk: Tour) => number,
): Tour {
  let best = tour;
  let worth = price(tour);
  for (let i = 0; i <= tour.length; i++) {
    const added = stop(tour[i - 1]?.at ?? from);
    if (added === undefined) continue;
    const walk = [...tour.slice(0, i), added, ...tour.slice(i)];
    const w = price(walk);
    if (w > worth) {
      best = walk;
      worth = w;
    }
  }
  return best;
}

export const nearest: Planner = {
  async plan(from, parcels, grid) {
    const order = nearestOrder(
      from,
      parcels.filter((parcel) => !parcel.carriedBy),
      grid,
    );
    if (order.length === 0 && !parcels.some((parcel) => parcel.carriedBy))
      return undefined;
    return touring(from, order, grid);
  },
};
