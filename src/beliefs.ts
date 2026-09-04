import { key, sameTile } from "./position.js";
import {
  type IOAgent,
  type IOConfig,
  type IOSensing,
  type IOTile,
  msOf,
  type Parcel,
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
    for (const p of sensing.positions) observed.set(key(p.x, p.y), at);
    for (const p of sensing.parcels)
      parcels.set(p.id, {
        id: p.id,
        x: p.x,
        y: p.y,
        carriedBy: p.carriedBy,
        reward: p.reward,
        seenAt: at,
      });
    for (const a of sensing.agents)
      agents.set(a.id, {
        id: a.id,
        name: a.name,
        x: a.x ?? 0,
        y: a.y ?? 0,
        seenAt: at,
      });
    for (const c of sensing.crates)
      crates.set(c.id, { id: c.id, x: c.x, y: c.y, seenAt: at });

    // Forget anything remembered on a visible tile that the snapshot does not report.
    const visible = new Set(sensing.positions.map((p) => key(p.x, p.y)));
    const reported = new Set<string>([
      ...sensing.parcels.map((p) => p.id),
      ...sensing.agents.map((a) => a.id),
      ...sensing.crates.map((c) => c.id),
    ]);
    for (const [id, p] of parcels)
      if (!reported.has(id) && visible.has(key(p.x, p.y))) parcels.delete(id);
    for (const [id, a] of agents)
      if (!reported.has(id) && visible.has(key(a.x, a.y))) agents.delete(id);
    for (const [id, c] of crates)
      if (!reported.has(id) && visible.has(key(c.x, c.y))) crates.delete(id);

    for (const [id, p] of parcels)
      if (decayedReward(p, config, at) <= 0) parcels.delete(id);
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
    observedAt: (x, y) => observed.get(key(x, y)) ?? Number.NEGATIVE_INFINITY,
    agents: () => [...agents.values()],
    crates: () => [...crates.values()],
    carrying: (now = Date.now()) =>
      current(now).filter((p) => p.carriedBy === self.id),
    seen,
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
