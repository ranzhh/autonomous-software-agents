import type { Beliefs } from "./beliefs.js";
import type { Grid } from "./grid.js";
import { type IOConfig, msOf, type Position } from "./sdk.js";

export interface Prospect extends Position {
  /** That a parcel nobody has seen sits there. */
  chance: number;
  /** What such a parcel is worth now, before the walk home. */
  worth: number;
}

const manhattan = (a: Position, b: Position): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/**
 * Where the unseen parcels are likely to be. Each generation tick puts one
 * parcel on a random empty spawner while the board holds fewer than `max`, so
 * a spawner's chance grows with the time since anybody looked at it, and the
 * chances together cannot exceed the room left under the cap. An agent seen
 * beside a spawner counts as a look: had a parcel been there, it would have
 * taken it.
 */
export function prospects(
  beliefs: Beliefs,
  grid: Grid,
  config: IOConfig,
  now = Date.now(),
  mine: (spawner: Position) => boolean = () => true,
): Prospect[] {
  const { parcels, player } = config.GAME;
  const tick = msOf(parcels.generation_event, config.CLOCK);
  const decay = msOf(parcels.decaying_event, config.CLOCK);
  const life = parcels.reward_avg * decay;
  const self = beliefs.me().id;
  const others = beliefs.agents().filter((a) => a.id !== self);

  const raw = grid.spawners.map((s) => {
    let looked = beliefs.observedAt(s.x, s.y);
    for (const a of others)
      if (manhattan(a, s) <= player.observation_distance)
        looked = Math.max(looked, a.seenAt);
    const age = now - looked;
    const chance = 1 - Math.exp(-age / (tick * grid.spawners.length));
    const aged = Number.isFinite(decay) ? Math.min(age, life) / (2 * decay) : 0;
    return { ...s, chance, worth: Math.max(0, parcels.reward_avg - aged) };
  });

  const known = beliefs.parcels(now).length;
  const unseen = parcels.max - known;
  const total = raw.reduce((sum, s) => sum + s.chance, 0);
  const scale = total > 0 ? Math.min(1, Math.max(0, unseen) / total) : 0;
  return raw.filter(mine).map((s) => ({ ...s, chance: s.chance * scale }));
}
