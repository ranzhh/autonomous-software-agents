import { key, sameTile } from "./position.js";
import {
  type IOAgent,
  type IOConfig,
  type IOSensing,
  type IOTile,
  msOf,
  type Parcel,
  type Position,
  type World,
} from "./sdk.js";

export interface ParcelBelief {
  id: string;
  x: number;
  y: number;
  carriedBy?: string | undefined;
  /** As last seen; `parcels()` reports the value decayed to now. */
  reward: number;
  seenAt: number;
}

export interface AgentBelief {
  id: string;
  name: string;
  x: number;
  y: number;
  seenAt: number;
}

/** Last seen position; crates never decay or respawn. */
export interface CrateBelief {
  id: string;
  x: number;
  y: number;
  seenAt: number;
}

/** What a teammate sensed, from where and when. */
export interface Report {
  at: number;
  from: Omit<AgentBelief, "seenAt">;
  parcels: Omit<ParcelBelief, "seenAt">[];
  agents: Omit<AgentBelief, "seenAt">[];
}

export interface Beliefs {
  me(): IOAgent;
  tileAt(x: number, y: number): IOTile | undefined;
  /** Rewards decayed to `now`; parcels decayed to nothing are dropped. */
  parcels(now?: number): ParcelBelief[];
  agents(): AgentBelief[];
  crates(): CrateBelief[];
  carrying(now?: number): ParcelBelief[];
  /** When the tile was last in view; -Infinity when it never was. */
  observedAt(x: number, y: number): number;

  seen(sensing: IOSensing, at?: number): void;
  /** A teammate's frame, folded in where it is the newer word. */
  heard(report: Report): void;
  moved(me: IOAgent): void;
  changed(tile: IOTile): void;
  /** Apply a pickup ack: mark underfoot parcels carried; on an empty ack forget them. */
  took(taken: Parcel[] | undefined): void;
  /** Apply a putdown ack: forget everything carried. */
  gave(): void;
}

export function decayedReward(
  parcel: ParcelBelief,
  config: IOConfig,
  now: number,
): number {
  // A decaying_event of "infinite" makes ms Infinity, so zero ticks have passed.
  const ms = msOf(config.GAME.parcels.decaying_event, config.CLOCK);
  return parcel.reward - Math.floor((now - parcel.seenAt) / ms);
}

export function believe(world: World): Beliefs {
  const { config } = world;
  let self = world.me;
  const grid = new Map(world.tiles.map((tile) => [key(tile.x, tile.y), tile]));
  const parcels = new Map<string, ParcelBelief>();
  const agents = new Map<string, AgentBelief>();
  const crates = new Map<string, CrateBelief>();
  const observed = new Map<string, number>();

  function seen(sensing: IOSensing, at = Date.now()): void {
    merge(
      at,
      sensing.positions,
      sensing.parcels,
      sensing.agents.map((a) => ({
        id: a.id,
        name: a.name,
        x: a.x ?? 0,
        y: a.y ?? 0,
      })),
    );
    for (const c of sensing.crates)
      crates.set(c.id, { id: c.id, x: c.x, y: c.y, seenAt: at });
    const visible = new Set(sensing.positions.map((p) => key(p.x, p.y)));
    const reported = new Set(sensing.crates.map((c) => c.id));
    for (const [id, c] of crates)
      if (!reported.has(id) && visible.has(key(c.x, c.y))) crates.delete(id);
  }

  function heard({ at, from, parcels, agents }: Report): void {
    merge(at, viewFrom(from), parcels, [from, ...agents]);
  }

  function merge(
    at: number,
    visible: Position[],
    sighted: Omit<ParcelBelief, "seenAt">[],
    met: Omit<AgentBelief, "seenAt">[],
  ): void {
    const stale = (held: { seenAt: number } | undefined) =>
      held === undefined || held.seenAt <= at;

    for (const { x, y } of visible)
      if (stale({ seenAt: observedAt(x, y) })) observed.set(key(x, y), at);
    for (const p of sighted)
      if (stale(parcels.get(p.id))) parcels.set(p.id, { ...p, seenAt: at });
    for (const a of met)
      if (a.id !== self.id && stale(agents.get(a.id)))
        agents.set(a.id, { ...a, seenAt: at });

    // A memory on a tile in view, absent from a frame no older than it, is gone.
    const inView = new Set(visible.map((p) => key(p.x, p.y)));
    const reported = new Set([...sighted, ...met].map((it) => it.id));
    for (const [id, p] of parcels)
      if (
        !reported.has(id) &&
        stale(p) &&
        p.carriedBy !== self.id &&
        inView.has(key(p.x, p.y))
      )
        parcels.delete(id);
    for (const [id, a] of agents)
      if (!reported.has(id) && stale(a) && inView.has(key(a.x, a.y)))
        agents.delete(id);

    for (const [id, p] of parcels)
      if (decayedReward(p, config, at) <= 0) parcels.delete(id);
  }

  const observedAt = (x: number, y: number): number =>
    observed.get(key(x, y)) ?? Number.NEGATIVE_INFINITY;

  function viewFrom({ x, y }: Position): Position[] {
    const reach = config.GAME.player.observation_distance;
    const cx = Math.round(x);
    const cy = Math.round(y);
    const out: Position[] = [];
    for (let dx = -reach; dx <= reach; dx++)
      for (let dy = Math.abs(dx) - reach; dy <= reach - Math.abs(dx); dy++)
        if (grid.has(key(cx + dx, cy + dy)))
          out.push({ x: cx + dx, y: cy + dy });
    return out;
  }

  const current = (now: number): ParcelBelief[] =>
    [...parcels.values()]
      .map((p) => ({ ...p, reward: decayedReward(p, config, now) }))
      .filter((p) => p.reward > 0);

  function took(taken: Parcel[] | undefined): void {
    const at = { x: self.x ?? 0, y: self.y ?? 0 };
    for (const [id, p] of parcels) {
      if (p.carriedBy || !sameTile(p, at)) continue;
      if (taken && taken.length > 0) p.carriedBy = self.id;
      else parcels.delete(id);
    }
  }

  return {
    me: () => self,
    tileAt: (x, y) => grid.get(key(x, y)),
    parcels: (now = Date.now()) => current(now),
    observedAt,
    agents: () => [...agents.values()],
    crates: () => [...crates.values()],
    carrying: (now = Date.now()) =>
      current(now).filter((p) => p.carriedBy === self.id),
    seen,
    heard,
    moved: (me) => {
      self = me;
    },
    changed: (tile) => {
      grid.set(key(tile.x, tile.y), tile);
    },
    took,
    gave: () => {
      for (const [id, p] of parcels)
        if (p.carriedBy === self.id) parcels.delete(id);
    },
  };
}
