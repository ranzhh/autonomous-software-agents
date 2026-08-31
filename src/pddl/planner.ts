import { readFileSync } from "node:fs";
import type { Grid, Route } from "../grid.js";
import { key, sameTile } from "../position.js";
import type { Position } from "../sdk.js";
import { destination, nearest, type Planner, type Tour } from "../tour.js";
import { type Distance, positionOf, problem } from "./problem.js";
import type { Solver } from "./solver.js";

const domain = readFileSync(new URL("domain.pddl", import.meta.url), "utf8");

const STOP = /^\((pickup|deliver) (\S+) (\S+)\)$/;

function tourOf(plan: string[]): Tour {
  const stops: Tour = [];
  for (const line of plan) {
    const [, action, parcel, tile] = STOP.exec(line.trim()) ?? [];
    if (action === undefined || parcel === undefined || tile === undefined)
      continue;
    const at = positionOf(tile);
    if (at === undefined) continue;

    if (action === "pickup") {
      stops.push({ action: "pickup", at, parcel });
      continue;
    }
    const last = stops.at(-1);
    if (last?.action === "deliver" && sameTile(last.at, at)) continue;
    stops.push({ action: "deliver", at });
  }
  return stops;
}

function nearby(from: Position, parcels: Position[], grid: Grid): Position[] {
  const home = grid.route(...grid.deliveries);
  const chosen = new Map<string, Position>();
  for (const at of [from, ...parcels]) {
    const delivery = destination(home, at);
    if (delivery) chosen.set(key(delivery.x, delivery.y), delivery);
  }
  return [...chosen.values()];
}

function distances(tiles: Position[], grid: Grid): Distance {
  const routes = new Map<string, Route>();
  for (const tile of tiles) {
    const at = key(tile.x, tile.y);
    if (!routes.has(at)) routes.set(at, grid.route(tile));
  }
  return (from, to) => routes.get(key(to.x, to.y))?.distance(from) ?? Infinity;
}

export const planning = (solver: Solver): Planner => ({
  async plan(from, parcels, grid) {
    const deliveries = nearby(from, parcels, grid);
    const dist = distances([from, ...parcels, ...deliveries], grid);
    const plan = await solver.solve(
      domain,
      problem(from, parcels, deliveries, dist),
    );

    const stops = plan && tourOf(plan);
    return stops && stops.length > 0
      ? stops
      : nearest.plan(from, parcels, grid);
  },
});
