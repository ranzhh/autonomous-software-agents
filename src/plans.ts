import type { Beliefs } from "./beliefs.js";
import type { Grid } from "./grid.js";
import { MOVES, sameTile } from "./position.js";
import { DIRECTIONS, type Direction } from "./sdk.js";

export type Action = Direction | "pickup" | "putdown";

/**
 * The next action, asked fresh after every completed one: grab what is here,
 * bring home what we carry, chase the nearest known parcel, else go where
 * parcels spawn. Undefined when boxed in.
 */
export function naive(
  beliefs: Beliefs,
  grid: Grid,
  now = Date.now(),
): Action | undefined {
  const me = beliefs.me();
  const at = { x: me.x ?? 0, y: me.y ?? 0 };
  const loose = beliefs.parcels(now).filter((p) => !p.carriedBy);

  if (loose.some((p) => sameTile(p, at))) return "pickup";

  if (beliefs.carrying(now).length > 0) {
    const home = grid.route(...grid.deliveries);
    if (home.distance(at) === 0) return "putdown";
    return home.step(at);
  }

  if (loose.length > 0) {
    const step = grid.route(...loose).step(at);
    if (step) return step;
  }

  const spawn = grid.route(...grid.spawners).step(at);
  if (spawn) return spawn;

  // On a spawner with nothing to do: drift, so new parcels come into view.
  const open = DIRECTIONS.filter((d) =>
    grid.walkable({ x: at.x + MOVES[d].dx, y: at.y + MOVES[d].dy }),
  );
  return open[Math.floor(Math.random() * open.length)];
}
