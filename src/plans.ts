import type { Beliefs } from "./beliefs.js";
import { prospects } from "./field.js";
import type { Grid } from "./grid.js";
import { sameTile } from "./position.js";
import { randomStream } from "./random.js";
import { type Direction, type IOConfig, msOf, type Position } from "./sdk.js";

const random = randomStream("plans-drift");

export type Action = Direction | "pickup" | "putdown";

export type Intention =
  | { kind: "fetch"; id: string }
  | { kind: "home" }
  | { kind: "scout"; x: number; y: number }
  | { kind: "explore" };

/** A challenger must beat the held intention by this factor to prevent dithering. */
const MARGIN = 1.2;

export const same = (a: Intention, b: Intention): boolean => {
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
  mine?: (spawner: Position) => boolean,
): Intention {
  const me = beliefs.me();
  const at = { x: me.x ?? 0, y: me.y ?? 0 };
  // The server does not enforce config.GAME.player.capacity, so neither
  // does deliberation: fetches stay worthwhile at any load.
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

  const finds = prospects(beliefs, grid, config, now, mine);
  const reach = config.GAME.player.observation_distance;
  for (const t of grid.spawners) {
    const there = grid.route(t);
    const steps = there.distance(at);
    if (!Number.isFinite(steps)) continue;
    let utility = 0;
    for (const f of finds)
      if (Math.abs(f.x - t.x) + Math.abs(f.y - t.y) <= reach)
        utility +=
          f.chance *
          delivered([f.worth], steps + there.distance(f) + home.distance(f));
    if (utility > 0)
      options.push({ intention: { kind: "scout", x: t.x, y: t.y }, utility });
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
  return open[Math.floor(random() * open.length)]?.[0];
}
