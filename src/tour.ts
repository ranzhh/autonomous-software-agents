import type { ParcelBelief } from "./beliefs.js";
import type { Grid, Route } from "./grid.js";
import { MOVES } from "./position.js";
import type { Position } from "./sdk.js";

export type Stop =
  | { action: "pickup"; at: Position; parcel: string }
  | { action: "deliver"; at: Position };

export type Tour = Stop[];

export interface Planner {
  plan(
    from: Position,
    parcels: ParcelBelief[],
    grid: Grid,
  ): Promise<Tour | undefined>;
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

export const nearest: Planner = {
  async plan(from, parcels, grid) {
    const home = grid.route(...grid.deliveries);
    const carried = parcels.some((parcel) => parcel.carriedBy);
    let left = parcels
      .filter((parcel) => !parcel.carriedBy)
      .map((parcel) => ({ parcel, route: grid.route(parcel) }));
    let at = from;
    const stops: Tour = [];

    while (left.length > 0) {
      const next = left.reduce((closest, candidate) =>
        candidate.route.distance(at) < closest.route.distance(at)
          ? candidate
          : closest,
      );
      if (!Number.isFinite(next.route.distance(at))) break;
      at = { x: next.parcel.x, y: next.parcel.y };
      stops.push({ action: "pickup", at, parcel: next.parcel.id });
      left = left.filter((candidate) => candidate !== next);
    }

    if (stops.length === 0 && !carried) return undefined;
    const delivery = destination(home, at);
    return delivery
      ? [...stops, { action: "deliver", at: delivery }]
      : undefined;
  },
};
