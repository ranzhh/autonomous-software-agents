import type { ParcelBelief } from "./beliefs.js";
import type { Grid } from "./grid.js";
import { type IOConfig, msOf, type Position } from "./sdk.js";

export const MARGIN = 1.2;

export interface Value {
  delivered(rewards: number[], steps: number): number;
}

export function value(config: IOConfig): Value {
  const perStep =
    config.GAME.player.movement_duration /
    msOf(config.GAME.parcels.decaying_event, config.CLOCK);
  return {
    delivered: (rewards, steps) =>
      Number.isFinite(steps)
        ? rewards.reduce((sum, r) => sum + Math.max(0, r - steps * perStep), 0)
        : 0,
  };
}

export function priced(
  from: Position,
  order: ParcelBelief[],
  carried: ParcelBelief[],
  grid: Grid,
  { delivered }: Value,
): number {
  const home = grid.route(...grid.deliveries);
  let at = from;
  let steps = 0;
  for (const p of order) {
    steps += grid.route(p).distance(at);
    if (!Number.isFinite(steps)) return 0;
    at = { x: p.x, y: p.y };
  }
  steps += home.distance(at);
  return delivered(
    [...order, ...carried].map((p) => p.reward),
    steps,
  );
}
