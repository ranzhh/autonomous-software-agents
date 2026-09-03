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

export interface Beliefs {
  me(): IOAgent & Position;
  tileAt(x: number, y: number): IOTile | undefined;
  /** Rewards decayed to `now`; parcels decayed to nothing are dropped. */
  parcels(now?: number): ParcelBelief[];
  agents(): AgentBelief[];
  carrying(now?: number): ParcelBelief[];
  /** When the tile was last in view; -Infinity when it never was. */
  observedAt(x: number, y: number): number;

  /** Ingests a frame and returns the parcels it retired as visibly absent. */
  seen(sensing: IOSensing, now?: number): string[];
  moved(me: IOAgent): void;
  changed(tile: IOTile): void;
  /** A pickup ack: what was believed loose underfoot is carried, or was never there. */
  took(taken: Parcel[] | undefined): void;
  /** A putdown ack: nothing is carried any more. */
  gave(): void;
}

function decayedReward(
  parcel: ParcelBelief,
  config: IOConfig,
  now: number,
): number {
  // An infinite tick divides the elapsed time into zero passed ticks.
  const ms = msOf(config.GAME.parcels.decaying_event, config.CLOCK);
  return parcel.reward - Math.floor((now - parcel.seenAt) / ms);
}

const settle = (me: IOAgent): IOAgent & Position => ({
  ...me,
  x: me.x ?? 0,
  y: me.y ?? 0,
});

export function believe(world: World): Beliefs {
  const { config } = world;
  let self = settle(world.me);
  const grid = new Map(world.tiles.map((tile) => [key(tile.x, tile.y), tile]));
  const parcels = new Map<string, ParcelBelief>();
  const agents = new Map<string, AgentBelief>();
  const observed = new Map<string, number>();

  function seen(sensing: IOSensing, now = Date.now()): string[] {
    for (const p of sensing.positions) observed.set(key(p.x, p.y), now);
    for (const p of sensing.parcels)
      parcels.set(p.id, {
        id: p.id,
        x: p.x,
        y: p.y,
        carriedBy: p.carriedBy,
        reward: p.reward,
        seenAt: now,
      });
    for (const a of sensing.agents)
      agents.set(a.id, {
        id: a.id,
        name: a.name,
        x: a.x ?? 0,
        y: a.y ?? 0,
        seenAt: now,
      });

    // A memory on a tile we can see right now, yet absent from the snapshot, is gone.
    const visible = new Set(sensing.positions.map((p) => key(p.x, p.y)));
    const reported = new Set<string>([
      ...sensing.parcels.map((p) => p.id),
      ...sensing.agents.map((a) => a.id),
    ]);
    const retired: string[] = [];
    for (const [id, p] of parcels)
      if (!reported.has(id) && visible.has(key(p.x, p.y))) {
        parcels.delete(id);
        retired.push(id);
      }
    for (const [id, a] of agents)
      if (!reported.has(id) && visible.has(key(a.x, a.y))) agents.delete(id);

    for (const [id, p] of parcels)
      if (decayedReward(p, config, now) <= 0) parcels.delete(id);
    return retired;
  }

  const current = (now: number): ParcelBelief[] =>
    [...parcels.values()]
      .map((p) => ({ ...p, reward: decayedReward(p, config, now) }))
      .filter((p) => p.reward > 0);

  function took(taken: Parcel[] | undefined): void {
    for (const [id, p] of parcels) {
      if (p.carriedBy || !sameTile(p, self)) continue;
      if (taken === undefined || taken.length > 0) p.carriedBy = self.id;
      else parcels.delete(id);
    }
  }

  return {
    me: () => self,
    tileAt: (x, y) => grid.get(key(x, y)),
    parcels: (now = Date.now()) => current(now),
    observedAt: (x, y) => observed.get(key(x, y)) ?? Number.NEGATIVE_INFINITY,
    agents: () => [...agents.values()],
    carrying: (now = Date.now()) =>
      current(now).filter((p) => p.carriedBy === self.id),
    seen,
    moved: (me) => {
      self = settle(me);
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
