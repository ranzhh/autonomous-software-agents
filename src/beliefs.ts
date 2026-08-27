import { key } from "./position.js";
import {
  type IOAgent,
  type IOConfig,
  type IOSensing,
  type IOTile,
  msOf,
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

export interface Beliefs {
  me(): IOAgent;
  tileAt(x: number, y: number): IOTile | undefined;
  /** Rewards decayed to `now`; parcels decayed to nothing are dropped. */
  parcels(now?: number): ParcelBelief[];
  agents(): AgentBelief[];
  carrying(now?: number): ParcelBelief[];

  seen(sensing: IOSensing, at?: number): void;
  moved(me: IOAgent): void;
  changed(tile: IOTile): void;
}

export function decayedReward(
  parcel: ParcelBelief,
  config: IOConfig,
  now: number,
): number {
  // An infinite tick divides the elapsed time into zero passed ticks.
  const ms = msOf(config.GAME.parcels.decaying_event, config.CLOCK);
  return parcel.reward - Math.floor((now - parcel.seenAt) / ms);
}

export function believe(world: World): Beliefs {
  const { config } = world;
  let self = world.me;
  const grid = new Map(world.tiles.map((tile) => [key(tile.x, tile.y), tile]));
  const parcels = new Map<string, ParcelBelief>();
  const agents = new Map<string, AgentBelief>();

  function seen(sensing: IOSensing, at = Date.now()): void {
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

    // A memory on a tile we can see right now, yet absent from the snapshot, is gone.
    const visible = new Set(sensing.positions.map((p) => key(p.x, p.y)));
    const reported = new Set<string>([
      ...sensing.parcels.map((p) => p.id),
      ...sensing.agents.map((a) => a.id),
    ]);
    for (const [id, p] of parcels)
      if (!reported.has(id) && visible.has(key(p.x, p.y))) parcels.delete(id);
    for (const [id, a] of agents)
      if (!reported.has(id) && visible.has(key(a.x, a.y))) agents.delete(id);

    for (const [id, p] of parcels)
      if (decayedReward(p, config, at) <= 0) parcels.delete(id);
  }

  const current = (now: number): ParcelBelief[] =>
    [...parcels.values()]
      .map((p) => ({ ...p, reward: decayedReward(p, config, now) }))
      .filter((p) => p.reward > 0);

  return {
    me: () => self,
    tileAt: (x, y) => grid.get(key(x, y)),
    parcels: (now = Date.now()) => current(now),
    agents: () => [...agents.values()],
    carrying: (now = Date.now()) =>
      current(now).filter((p) => p.carriedBy === self.id),
    seen,
    moved: (me) => {
      self = me;
    },
    changed: (tile) => {
      grid.set(key(tile.x, tile.y), tile);
    },
  };
}
