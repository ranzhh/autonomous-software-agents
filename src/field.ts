import type { AgentBelief, Beliefs } from "./beliefs.js";
import { FRESH } from "./choose.js";
import type { Grid, Route } from "./grid.js";
import { key, MOVES, sameTile } from "./position.js";
import { type IOConfig, msOf, type Position } from "./sdk.js";
import { MARGIN } from "./value.js";

export interface Intent {
  /** The tiles the agent means to stand on, in order. */
  stops: Position[];
  /** Where it is scouting, when nothing is committed. */
  going: Position | undefined;
}

export interface Sighting {
  id: string;
  x: number;
  y: number;
  reward: number;
  carriedBy?: string | null | undefined;
}

export interface Seen extends Position {
  id: string;
}

/** One spawner tile as the model reads it now; every factor is shown, not only the product. */
export interface Yield extends Position {
  /** Milliseconds somebody on the team has had it in view. */
  exposure: number;
  /** Parcels that appeared on it while it was in view. */
  spawns: number;
  /** Parcels per millisecond, the config prior updated by what was seen. */
  rate: number;
  /** Reward a parcel there is worth when first seen. */
  reward: number;
  /** Milliseconds since anybody looked, capped at a parcel's lifetime. */
  age: number;
  /** That a parcel is sitting there unseen. */
  chance: number;
  /** That it would be ours to take, 0 to 1. */
  share: number;
  /** Fraction of the watched time a stranger stood within reach of it. */
  presence: number;
  /** That a stranger emptied it since anybody looked, read off what it carries. */
  drain: number;
  /** Milliseconds since that inferred pickup. */
  since: number;
  /** Points banked from parcels born there against the points seen there. */
  ledger: number;
  /** Reward left on the unseen parcel, before the walk home. */
  remaining: number;
  /** Expected points banked from the unseen parcel, everything above multiplied. */
  worth: number;
}

export interface Candidate extends Position {
  /** Expected points revealed by standing there. */
  reveals: number;
  steps: number;
  /** Milliseconds the path is expected to lose to refusals. */
  stall: number;
  /** Milliseconds a head-on meeting in a corridor would cost. */
  conflict: number;
  /** Points per second of the trip. */
  rate: number;
}

export interface Predicted {
  who: string;
  path: Position[];
}

export interface Assessment {
  known: number;
  /** What the global parcel cap leaves for the sum of the chances. */
  scale: number;
  yields: Yield[];
  candidates: Candidate[];
  chosen: Candidate | undefined;
  /** The destination kept from the previous choice, when one was made with `keep`. */
  held: Position | undefined;
  paths: Predicted[];
}

export interface Field {
  /** A frame from one pair of eyes: the tiles in view, the parcels and the strangers in it. */
  saw(
    grid: Grid,
    who: string,
    view: Position[],
    parcels: Sighting[],
    strangers: Seen[],
    now?: number,
  ): void;
  /** An attempt to step onto a tile, and whether it landed. */
  stepped(to: Position, landed: boolean, now?: number): void;
  /** Parcels the team delivered, at the reward they paid. */
  banked(parcels: { id: string; reward: number }[]): void;
  /** Where to scout, with every number behind it; `keep` commits the choice. */
  assess(
    grid: Grid,
    others: AgentBelief[],
    mate?: { id: string; intent: Intent | undefined },
    now?: number,
    keep?: boolean,
  ): Assessment;
  stalls(): (Position & Stall)[];
}

/** Stepping onto one tile: the times it went through, the times it stuck, and for how long. */
export interface Stall {
  passages: number;
  episodes: number;
  stalled: number;
}

interface Stat {
  exposure: number;
  spawns: number;
  rewards: number;
  sightings: number;
  presence: number;
  drain: number;
  drainedAt: number;
  seen: number;
  banked: number;
}

interface Tracked {
  origin: string | undefined;
  reward: number;
  open: boolean;
  /** When it was last seen lying where it was born. */
  loose: number | undefined;
  /** Its pickup by a stranger has been charged to a spawner. */
  drained: boolean;
}

interface Board {
  grid: Grid;
  spawner: Set<string>;
  /** Spawner tile to the tiles within sight of it, walking, with the steps. */
  near: Map<string, [Position, number][]>;
  /** Tile to the spawner tiles that have it within reach, with the steps back. */
  watch: Map<string, [string, number][]>;
  home: Route;
  /** Toward the nearest tile with room to pass. */
  wide: Route;
}

const blank = (): Stat => ({
  exposure: 0,
  spawns: 0,
  rewards: 0,
  sightings: 0,
  presence: 0,
  drain: 0,
  drainedAt: 0,
  seen: 0,
  banked: 0,
});

const at = (p: Position): string => key(p.x, p.y);

function around(
  grid: Grid,
  from: Position,
  depth: number,
): [Position, number][] {
  const found: [Position, number][] = [];
  const dist = new Map<string, number>([[at(from), 0]]);
  const queue: Position[] = [from];
  for (let head = 0; head < queue.length; head++) {
    const here = queue[head] as Position;
    const d = dist.get(at(here)) ?? 0;
    found.push([here, d]);
    if (d >= depth) continue;
    for (const [, to] of grid.exits(here))
      if (!dist.has(at(to))) {
        dist.set(at(to), d + 1);
        queue.push(to);
      }
  }
  return found;
}

function trail(route: Route, from: Position): Position[] {
  const out: Position[] = [];
  let here = from;
  for (
    let move = route.step(here);
    move !== undefined;
    move = route.step(here)
  ) {
    here = { x: here.x + MOVES[move].dx, y: here.y + MOVES[move].dy };
    out.push(here);
  }
  return out;
}

export function fielding(
  beliefs: Beliefs,
  config: IOConfig,
  me: string,
): Field {
  const tick = msOf(config.GAME.parcels.generation_event, config.CLOCK);
  const decay = msOf(config.GAME.parcels.decaying_event, config.CLOCK);
  const step = config.GAME.player.movement_duration;
  const reach = config.GAME.player.observation_distance;
  const cap = config.GAME.parcels.max;
  const avg = config.GAME.parcels.reward_avg;
  const perStep = step / decay;

  const stats = new Map<string, Stat>();
  const stalls = new Map<string, Stall>();
  let stuck: { tile: string; since: number } | undefined;
  const records = new Map<string, Tracked>();
  const watched = new Map<string, Set<string>>();
  let lastAt: number | undefined;
  let held: Position | undefined;
  let board: Board | undefined;

  const stat = (k: string): Stat => {
    const found = stats.get(k);
    if (found) return found;
    const made = blank();
    stats.set(k, made);
    return made;
  };

  function build(grid: Grid): Board {
    const depth = reach < 0 ? Infinity : reach;
    const spawner = new Set(grid.spawners.map(at));
    const near = new Map<string, [Position, number][]>();
    const watch = new Map<string, [string, number][]>();
    for (const s of grid.spawners) {
      const seen = around(grid, s, depth);
      near.set(at(s), seen);
      for (const [t, d] of seen) {
        const list = watch.get(at(t));
        if (list) list.push([at(s), d]);
        else watch.set(at(t), [[at(s), d]]);
      }
    }
    const flooded = new Map<string, Position>();
    for (const from of [...grid.spawners, ...grid.deliveries])
      for (const [t] of around(grid, from, Infinity)) flooded.set(at(t), t);
    const roomy = [...flooded.values()].filter((t) => grid.exits(t).length > 2);
    return {
      grid,
      spawner,
      near,
      watch,
      home: grid.route(...grid.deliveries),
      wide: grid.route(...roomy),
    };
  }

  const current = (grid: Grid): Board => {
    if (board?.grid !== grid) board = build(grid);
    return board;
  };

  function saw(
    grid: Grid,
    who: string,
    view: Position[],
    parcels: Sighting[],
    strangers: Seen[],
    now = Date.now(),
  ): void {
    const b = current(grid);
    const union = new Set<string>();
    for (const tiles of watched.values()) for (const k of tiles) union.add(k);
    if (lastAt !== undefined) {
      const dt = Math.max(0, now - lastAt);
      for (const k of union) if (b.spawner.has(k)) stat(k).exposure += dt;
      for (const a of strangers)
        for (const [s] of b.watch.get(at(a)) ?? [])
          if (union.has(s)) stat(s).presence += dt;
    }
    const rivals = new Set(strangers.map((a) => a.id));
    for (const p of parcels) {
      const k = key(p.x, p.y);
      let r = records.get(p.id);
      if (r === undefined) {
        const born = !p.carriedBy && b.spawner.has(k);
        r = {
          origin: born ? k : undefined,
          reward: p.reward,
          open: born,
          loose: born ? now : undefined,
          drained: false,
        };
        records.set(p.id, r);
        if (born) {
          const st = stat(k);
          st.rewards += p.reward;
          st.sightings++;
          if (union.has(k)) st.spawns++;
        }
      } else if (!p.carriedBy && r.origin === k) r.loose = now;
      if (!p.carriedBy || r.drained || !rivals.has(p.carriedBy)) continue;
      r.drained = true;
      if (r.origin !== undefined)
        drain(r.origin, 1, ((r.loose ?? now) + now) / 2);
      else {
        const from = b.watch.get(k) ?? [];
        const total = from.reduce((sum, [, d]) => sum + Math.exp(-d), 0);
        for (const [s, d] of from)
          drain(s, Math.exp(-d) / total, now - d * step);
      }
    }
    watched.set(who, new Set(view.map(at)));
    lastAt = now;
    const alive = new Set(beliefs.parcels(now).map((p) => p.id));
    for (const [id, r] of records)
      if (r.open && !alive.has(id)) {
        r.open = false;
        if (r.origin !== undefined) stat(r.origin).seen += r.reward;
      }
  }

  // A stranger's parcel came off the spawner it was seen on, or off those within reach
  // of where it is carried, weighted by the walk back; a look at the tile settles it.
  function drain(k: string, q: number, when: number): void {
    const st = stat(k);
    const [x, y] = k.split(",").map(Number) as [number, number];
    if (beliefs.observedAt(x, y) >= st.drainedAt) st.drain = 0;
    st.drainedAt = (st.drain * st.drainedAt + q * when) / (st.drain + q);
    st.drain = 1 - (1 - st.drain) * (1 - q);
  }

  function banked(parcels: { id: string; reward: number }[]): void {
    for (const p of parcels) {
      const r = records.get(p.id);
      if (r === undefined || !r.open || r.origin === undefined) continue;
      r.open = false;
      stat(r.origin).seen += r.reward;
      stat(r.origin).banked += p.reward;
    }
  }

  const stall = (k: string): Stall => {
    const found = stalls.get(k);
    if (found) return found;
    const made = { passages: 0, episodes: 0, stalled: 0 };
    stalls.set(k, made);
    return made;
  };

  // A run of refusals entering one tile is one episode, timed until a step lands anywhere.
  function stepped(to: Position, landed: boolean, now = Date.now()): void {
    const k = at(to);
    if (stuck !== undefined && (landed || stuck.tile !== k)) {
      stall(stuck.tile).stalled += now - stuck.since;
      stuck = undefined;
    }
    if (landed) stall(k).passages++;
    else if (stuck === undefined) {
      stuck = { tile: k, since: now };
      stall(k).episodes++;
    }
  }

  // A meeting head-on in a corridor: the one who gives way walks back to the nearest
  // tile with room to pass and returns, and the other waits as long.
  function clash(b: Board, mine: Position[], theirs: Position[]): number {
    const where = new Map(theirs.map((p, j) => [at(p), j]));
    let worst = 0;
    for (let i = 1; i < mine.length; i++) {
      const x = mine[i] as Position;
      const j = where.get(at(x));
      if (j === undefined || b.grid.exits(x).length > 2) continue;
      const prev = at(mine[i - 1] as Position);
      const next = mine[i + 1];
      const theirNext = theirs[j + 1];
      const theirPrev = theirs[j - 1];
      const opposite =
        (theirNext !== undefined && at(theirNext) === prev) ||
        (next !== undefined &&
          theirPrev !== undefined &&
          at(theirPrev) === at(next));
      if (!opposite) continue;
      const out = b.wide.distance(x);
      const room = Number.isFinite(out) ? out : mine.length;
      if (Math.abs(i - j) > room + 1) continue;
      worst = Math.max(worst, 2 * room * step);
    }
    return worst;
  }

  function predicted(
    b: Board,
    others: AgentBelief[],
    mate: { id: string; intent: Intent | undefined } | undefined,
    now: number,
  ): Predicted[] {
    const grid = b.grid;
    const out: Predicted[] = [];
    const loose = beliefs.parcels(now).filter((p) => !p.carriedBy);
    for (const a of others) {
      if (a.id === me || now - a.seenAt >= FRESH) continue;
      const path: Position[] = [{ x: Math.round(a.x), y: Math.round(a.y) }];
      const through = (targets: Position[]): void => {
        if (targets.length === 0) return;
        path.push(
          ...trail(grid.route(...targets), path[path.length - 1] as Position),
        );
      };
      if (a.id === mate?.id) {
        for (const stop of mate.intent?.stops ?? []) through([stop]);
        if (mate.intent?.going) through([mate.intent.going]);
      } else {
        through(loose);
        through(grid.deliveries);
      }
      out.push({ who: a.id, path });
    }
    return out;
  }

  function assess(
    grid: Grid,
    others: AgentBelief[],
    mate?: { id: string; intent: Intent | undefined },
    now = Date.now(),
    keep = false,
  ): Assessment {
    const b = current(grid);
    const here = beliefs.me();
    const prior = tick * grid.spawners.length;
    const known = beliefs.parcels(now).length;
    const fresh = others.filter((a) => a.id !== me && now - a.seenAt < FRESH);
    const claimed = new Set<string>();
    if (mate?.intent) {
      const going = mate.intent.going ? [mate.intent.going] : [];
      for (const x of [...mate.intent.stops, ...going])
        for (const [t] of around(grid, x, reach < 0 ? Infinity : reach))
          claimed.add(at(t));
    }

    const yields: Yield[] = [];
    let chances = 0;
    for (const s of grid.spawners) {
      const k = at(s);
      const st = stats.get(k) ?? blank();
      const rate = (1 + st.spawns) / (prior + st.exposure);
      const reward = (avg + st.rewards) / (1 + st.sightings);
      const life = reward * decay;
      const looked = beliefs.observedAt(s.x, s.y);
      const age = Math.min(now - looked, life);
      const drain = looked >= st.drainedAt ? 0 : st.drain;
      const since = Math.max(0, now - st.drainedAt);
      const unseen = (dt: number): number =>
        Number.isFinite(dt) ? 1 - Math.exp(-rate * dt) : rate > 0 ? 1 : 0;
      const chance =
        (1 - drain) * unseen(age) + drain * unseen(Math.min(since, life));
      const remaining =
        reward - (Number.isFinite(decay) ? age / (2 * decay) : 0);
      const route = grid.route(s);
      const mine = route.distance(here);
      let share = claimed.has(k) ? 0 : 1;
      for (const a of fresh) {
        const theirs = route.distance(a);
        if (theirs < mine || (theirs === mine && a.id < me)) share = 0;
      }
      const presence = st.presence / (prior + st.exposure);
      share *= 1 - presence;
      const ledger = (avg + st.banked) / (avg + st.seen);
      chances += chance;
      yields.push({
        x: s.x,
        y: s.y,
        exposure: st.exposure,
        spawns: st.spawns,
        rate,
        reward,
        age,
        chance,
        share,
        presence,
        drain,
        since: drain > 0 ? since : 0,
        ledger,
        remaining,
        worth: 0,
      });
    }
    const scale =
      chances > 0 ? Math.min(1, Math.max(0, cap - known) / chances) : 1;
    const banks = (y: Yield, steps: number): number =>
      scale *
      y.chance *
      y.share *
      y.ledger *
      Math.max(0, y.remaining - perStep * (steps + b.home.distance(y)));
    for (const y of yields) y.worth = banks(y, 0);
    const byKey = new Map(yields.map((y) => [at(y), y]));

    const paths = predicted(b, others, mate, now);
    const candidates: Candidate[] = [];
    for (const t of grid.spawners) {
      const route = grid.route(t);
      const steps = route.distance(here);
      if (!Number.isFinite(steps)) continue;
      let reveals = 0;
      for (const [s, d] of b.near.get(at(t)) ?? []) {
        const y = byKey.get(at(s));
        if (y) reveals += banks(y, d);
      }
      const path = [here, ...trail(route, here)];
      // Time lost entering each tile so far, per passage, with one clean pass as the prior.
      let lost = 0;
      for (const x of path.slice(1)) {
        const st = stalls.get(at(x));
        if (st !== undefined) lost += st.stalled / (1 + st.passages);
      }
      const conflict = Math.max(0, ...paths.map((q) => clash(b, path, q.path)));
      const time = Math.max(step, steps * step + lost + conflict);
      candidates.push({
        x: t.x,
        y: t.y,
        reveals,
        steps,
        stall: lost,
        conflict,
        rate: (reveals / time) * 1000,
      });
    }

    const viable = candidates.filter((c) => c.reveals > 0);
    let chosen = viable.reduce<Candidate | undefined>(
      (best, c) => (best === undefined || c.rate > best.rate ? c : best),
      undefined,
    );
    if (keep && chosen && held) {
      const kept = viable.find((c) => sameTile(c, held as Position));
      if (kept && kept.rate * MARGIN >= chosen.rate) chosen = kept;
    }
    if (chosen === undefined) {
      const pool = candidates.filter((c) => (byKey.get(at(c))?.share ?? 0) > 0);
      chosen = (pool.length > 0 ? pool : candidates).reduce<
        Candidate | undefined
      >(
        (best, c) => (best === undefined || c.steps < best.steps ? c : best),
        undefined,
      );
    }
    if (keep) held = chosen && { x: chosen.x, y: chosen.y };
    return { known, scale, yields, candidates, chosen, held, paths };
  }

  return {
    saw,
    stepped,
    banked,
    assess,
    stalls: () =>
      [...stalls].map(([k, st]) => {
        const [x, y] = k.split(",").map(Number) as [number, number];
        return { x, y, ...st };
      }),
  };
}
