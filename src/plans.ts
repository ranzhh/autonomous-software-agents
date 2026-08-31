import type { Beliefs } from "./beliefs.js";
import type { Grid } from "./grid.js";
import { MOVES, sameTile } from "./position.js";
import {
  DIRECTIONS,
  type Direction,
  type IOConfig,
  msOf,
  type Position,
} from "./sdk.js";

export type Action = Direction | "pickup" | "putdown";

export type Intention =
  | { kind: "fetch"; id: string }
  | { kind: "home" }
  | { kind: "explore" };

/** A challenger must beat the held intention by this factor, against dithering. */
const MARGIN = 1.2;

const same = (a: Intention, b: Intention): boolean =>
  a.kind === b.kind &&
  (a.kind !== "fetch" || b.kind !== "fetch" || a.id === b.id);

/**
 * Choose what to pursue: the option delivering the most reward, decayed over
 * the steps it takes to get it home. The held intention is kept unless a
 * challenger clears the margin; a vanished target is dropped outright.
 */
export function deliberate(
  beliefs: Beliefs,
  grid: Grid,
  config: IOConfig,
  held: Intention,
  now = Date.now(),
): Intention {
  const me = beliefs.me();
  const at = { x: me.x ?? 0, y: me.y ?? 0 };
  const loose = beliefs.parcels(now).filter((p) => !p.carriedBy);
  const carried = beliefs.carrying(now);

  // Reward each parcel sheds per step travelled; zero when rewards never decay.
  const perStep =
    config.GAME.player.movement_duration /
    msOf(config.GAME.parcels.decaying_event, config.CLOCK);
  const delivered = (rewards: number[], steps: number): number =>
    Number.isFinite(steps)
      ? rewards.reduce((sum, r) => sum + Math.max(0, r - steps * perStep), 0)
      : 0;

  const home = grid.route(...grid.deliveries);
  const options: { intention: Intention; utility: number }[] = [];
  if (carried.length > 0)
    options.push({
      intention: { kind: "home" },
      utility: delivered(
        carried.map((p) => p.reward),
        home.distance(at),
      ),
    });
  for (const p of loose)
    options.push({
      intention: { kind: "fetch", id: p.id },
      utility: delivered(
        [p.reward, ...carried.map((c) => c.reward)],
        grid.route(p).distance(at) + home.distance(p),
      ),
    });

  const best = options.reduce((a, b) => (b.utility > a.utility ? b : a), {
    intention: { kind: "explore" } as Intention,
    utility: 0,
  });
  const kept = options.find((o) => same(o.intention, held));
  if (kept && kept.utility > 0 && best.utility <= kept.utility * MARGIN)
    return held;
  return best.intention;
}

/** The next action serving the intention; undefined when there is none. */
export function pursue(
  intention: Intention,
  beliefs: Beliefs,
  grid: Grid,
  now = Date.now(),
): Action | undefined {
  const me = beliefs.me();
  const at = { x: me.x ?? 0, y: me.y ?? 0 };
  const loose = beliefs.parcels(now).filter((p) => !p.carriedBy);

  // Whatever the intention, a loose parcel underfoot is free value.
  if (loose.some((p) => sameTile(p, at))) return "pickup";

  if (intention.kind === "home") {
    const home = grid.route(...grid.deliveries);
    if (home.distance(at) === 0) return "putdown";
    return home.step(at);
  }
  if (intention.kind === "fetch") {
    const target = loose.find((p) => p.id === intention.id);
    return target && grid.route(target).step(at);
  }
  return grid.route(...grid.spawners).step(at) ?? drift(grid, at);
}

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
  return drift(grid, at);
}

/** A random step into any open neighbouring tile; undefined when boxed in. */
export function drift(grid: Grid, at: Position): Direction | undefined {
  const open = DIRECTIONS.filter((d) =>
    grid.walkable({ x: at.x + MOVES[d].dx, y: at.y + MOVES[d].dy }),
  );
  return open[Math.floor(Math.random() * open.length)];
}
