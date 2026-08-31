import { readFileSync } from "node:fs";
import type { Grid } from "../grid.js";
import { key, sameTile } from "../position.js";
import type { Position } from "../sdk.js";
import { destination, nearest, type Planner, type Tour } from "../tour.js";
import { positionOf, problem } from "./problem.js";
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

export const planning = (solver: Solver): Planner => ({
  async plan(from, parcels, grid) {
    const deliveries = nearby(from, parcels, grid);
    const plan = await solver.solve(
      domain,
      problem(from, parcels, deliveries, (f, t) => grid.route(t).distance(f)),
    );

    const stops = plan && tourOf(plan);
    return stops && stops.length > 0
      ? stops
      : nearest.plan(from, parcels, grid);
  },
});
