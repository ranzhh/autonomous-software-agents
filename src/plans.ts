import type { Beliefs } from "./beliefs.js";
import type { Grid } from "./grid.js";
import { sameTile } from "./position.js";
import { type Direction, type IOConfig, msOf, type Position } from "./sdk.js";

export type Action = Direction | "pickup" | "putdown";

export type Intention =
  | { kind: "fetch"; id: string }
  | { kind: "home" }
  | { kind: "scout"; x: number; y: number }
  | { kind: "explore" };

/** A challenger must beat the held intention by this factor to prevent dithering. */
const MARGIN = 1.2;

const same = (a: Intention, b: Intention): boolean => {
  if (a.kind === "fetch" && b.kind === "fetch") return a.id === b.id;
  if (a.kind === "scout" && b.kind === "scout")
    return a.x === b.x && a.y === b.y;
  return a.kind === b.kind;
};

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
  veto?: (intention: Intention) => boolean,
): Intention {
  const me = beliefs.me();
  const at = { x: me.x ?? 0, y: me.y ?? 0 };
  const loose = beliefs.parcels(now).filter((p) => !p.carriedBy);
  const carried = beliefs.carrying(now);

  // Reward lost per step travelled; zero when rewards never decay.
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

  // Parcels spawn one per generation tick on a random empty spawner tile, so
  // a spawner unseen for n ticks holds a parcel with chance ~n/spawners.
  // Generation stops at the board cap: the chance never exceeds max/spawners.
  const tick = msOf(config.GAME.parcels.generation_event, config.CLOCK);
  const cap = config.GAME.parcels.max / grid.spawners.length;
  for (const s of grid.spawners) {
    const stale = now - beliefs.observedAt(s.x, s.y);
    const holds = Math.min(1, cap, stale / (tick * grid.spawners.length));
    if (holds <= 0) continue;
    const steps = grid.route(s).distance(at) + home.distance(s);
    // The carried delivery is not credited here: a spawner re-arms by going
    // stale, so a scout scored as home-plus-bonus outbids home forever.
    options.push({
      intention: { kind: "scout", x: s.x, y: s.y },
      utility: holds * delivered([config.GAME.parcels.reward_avg], steps),
    });
  }

  const considered =
    veto === undefined ? options : options.filter((o) => !veto(o.intention));
  const best = considered.reduce((a, b) => (b.utility > a.utility ? b : a), {
    intention: { kind: "explore" } as Intention,
    utility: 0,
  });
  const kept = considered.find((o) => same(o.intention, held));
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

  // Grab loose parcels underfoot first; it costs no steps.
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
  if (intention.kind === "scout") return grid.route(intention).step(at);
  return grid.route(...grid.spawners).step(at) ?? drift(grid, at);
}

/**
 * Recompute the next action after every completed one: pick up parcels
 * here, deliver what is carried, chase the nearest known parcel, else head
 * for the spawners. Undefined when boxed in.
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

  // Drift when idle on a spawner so new parcels come into view.
  return drift(grid, at);
}

/** A random step into any open neighbouring tile; undefined when boxed in. */
export function drift(grid: Grid, at: Position): Direction | undefined {
  const open = grid.exits(at);
  return open[Math.floor(Math.random() * open.length)]?.[0];
}
