import type { Beliefs } from "./beliefs.js";
import type { Grid } from "./grid.js";
import { sameTile } from "./position.js";
import { type Direction, type IOConfig, msOf, type Position } from "./sdk.js";
import { priced, value } from "./value.js";

export type Action = Direction | "pickup" | "putdown";

const MARGIN = 1.2;

export type Intention =
  | { kind: "fetch"; id: string }
  | { kind: "home" }
  | { kind: "scout"; x: number; y: number }
  | { kind: "explore" };

const same = (a: Intention, b: Intention): boolean => {
  if (a.kind === "fetch" && b.kind === "fetch") return a.id === b.id;
  if (a.kind === "scout" && b.kind === "scout")
    return a.x === b.x && a.y === b.y;
  return a.kind === b.kind;
};

export interface Choice {
  intention: Intention;
  utility: number;
  heldUtility: number;
}

export function decide(
  beliefs: Beliefs,
  grid: Grid,
  config: IOConfig,
  held: Intention,
  now = Date.now(),
): Choice {
  const at = beliefs.me();
  const loose = beliefs.parcels(now).filter((p) => !p.carriedBy);
  const carried = beliefs.carrying(now);
  const worth = value(config);

  const home = grid.route(...grid.deliveries);
  const options: { intention: Intention; utility: number }[] = [];
  if (carried.length > 0)
    options.push({
      intention: { kind: "home" },
      utility: priced(at, [], carried, grid, worth),
    });
  for (const p of loose)
    options.push({
      intention: { kind: "fetch", id: p.id },
      utility: priced(at, [p], carried, grid, worth),
    });

  // One parcel per tick lands on a random spawner holding none, so a spawner
  // unseen for n ticks holds one with chance ~n/spawners, capped by max
  // (ParcelSpawner.js:27-40).
  const tick = msOf(config.GAME.parcels.generation_event, config.CLOCK);
  const cap = config.GAME.parcels.max / grid.spawners.length;
  for (const s of grid.spawners) {
    const stale = now - beliefs.observedAt(s.x, s.y);
    const holds = Math.min(1, cap, stale / (tick * grid.spawners.length));
    if (holds <= 0) continue;
    const steps = grid.route(s).distance(at) + home.distance(s);
    options.push({
      intention: { kind: "scout", x: s.x, y: s.y },
      utility:
        holds * worth.delivered([config.GAME.parcels.reward_avg], steps) +
        worth.delivered(
          carried.map((c) => c.reward),
          steps,
        ),
    });
  }

  const best = options.reduce((a, b) => (b.utility > a.utility ? b : a), {
    intention: { kind: "explore" } as Intention,
    utility: 0,
  });
  const kept = options.find((o) => same(o.intention, held));
  const heldUtility = kept?.utility ?? 0;
  if (kept && kept.utility > 0 && best.utility <= kept.utility * MARGIN)
    return { intention: held, utility: heldUtility, heldUtility };
  return { intention: best.intention, utility: best.utility, heldUtility };
}

export function pursue(
  intention: Intention,
  beliefs: Beliefs,
  grid: Grid,
  now = Date.now(),
): Action | undefined {
  const at = beliefs.me();
  const loose = beliefs.parcels(now).filter((p) => !p.carriedBy);

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

export function naive(
  beliefs: Beliefs,
  grid: Grid,
  now = Date.now(),
): Action | undefined {
  const at = beliefs.me();
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

  return drift(grid, at);
}

export function drift(
  grid: Grid,
  at: Position,
  clear: (to: Position) => boolean = () => true,
): Direction | undefined {
  const open = grid.exits(at).filter(([, to]) => clear(to));
  return open[Math.floor(Math.random() * open.length)]?.[0];
}
