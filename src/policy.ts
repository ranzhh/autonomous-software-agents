import { z } from "zod";
import type { Grid } from "./grid.js";
import { key } from "./position.js";
import type { IOTile, Position } from "./sdk.js";

const tile = z.object({
  x: z.int().nonnegative(),
  y: z.int().nonnegative(),
});

export const Policy = z.object({
  avoid: z.array(tile).describe("Never step on these."),
  noDelivery: z.array(tile).describe("Never deliver on these."),
  batch: z
    .int()
    .min(1)
    .nullable()
    .describe("A delivery is exactly this many parcels at once."),
  cheap: z
    .number()
    .min(1)
    .nullable()
    .describe("A delivery is one parcel worth at most this."),
  handoff: z.boolean().describe("One agent picks up, the other delivers."),
  hold: z.boolean().describe("Both agents stand still."),
  goals: z.array(
    z.object({
      kind: z
        .enum(["visit", "deliver"])
        .describe("Stand on one of the tiles, or deliver parcels on one."),
      tiles: z.array(tile),
      radius: z
        .int()
        .nonnegative()
        .describe("Any tile within this distance of one of them counts."),
      bonus: z.number(),
      together: z
        .boolean()
        .describe("Both agents must be there at the same time."),
    }),
  ),
  rules: z
    .array(
      z.object({
        contains: z.string().describe("A phrase a later message may contain."),
        effect: z.enum(["hold", "resume"]),
      }),
    )
    .describe("Only for a red light, green light game."),
});

export type Policy = z.infer<typeof Policy>;

export const NONE: Policy = {
  avoid: [],
  noDelivery: [],
  batch: null,
  cheap: null,
  handoff: false,
  hold: false,
  goals: [],
  rules: [],
};

export interface Orders {
  policy(): Policy;
  issue(policy: Policy): void;
  onIssue(listener: (policy: Policy) => void): void;
}

export function orders(initial = NONE): Orders {
  let policy = initial;
  const listeners = new Set<(policy: Policy) => void>();
  return {
    policy: () => policy,
    issue: (next) => {
      if (JSON.stringify(next) === JSON.stringify(policy)) return;
      policy = next;
      for (const listener of listeners) listener(next);
    },
    onIssue: (listener) => {
      listeners.add(listener);
    },
  };
}

export function react(policy: Policy, text: string): Policy | undefined {
  const lower = text.toLowerCase();
  const hits = policy.rules
    .map((rule) => ({ rule, at: lower.indexOf(rule.contains.toLowerCase()) }))
    .filter(({ at }) => at >= 0)
    .sort((a, b) => a.at - b.at);
  const first = hits[0]?.rule;
  if (first === undefined) return undefined;
  const hold = first.effect === "hold";
  return hold === policy.hold ? undefined : { ...policy, hold };
}

export type Goal = Policy["goals"][number];

export const mark = (goal: Goal): string => JSON.stringify(goal);
/** The goals not yet reached, `done` holding the marks of those that were. */
export const pending = (policy: Policy, done: Set<string>): Goal[] =>
  policy.goals.filter((goal) => !done.has(mark(goal)));

const near = (a: Position, b: Position, radius: number): boolean =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= radius;

export const within = (at: Position, goal: Goal): boolean =>
  goal.tiles.some((tile) => near(at, tile, goal.radius));

/** The tile of the set closest to all the others. */
function centre(tiles: Position[]): Position | undefined {
  const spread = (a: Position): number =>
    tiles.reduce(
      (sum, b) => sum + Math.abs(a.x - b.x) + Math.abs(a.y - b.y),
      0,
    );
  return tiles.reduce<Position | undefined>(
    (best, tile) =>
      best === undefined || spread(tile) < spread(best) ? tile : best,
    undefined,
  );
}

/**
 * Where to walk for a goal: any tile of the set, or, when the two agents must
 * both be inside, its centre, so that the first one in does not stop on the
 * door and shut the other out.
 */
export function targets(goal: Goal, grid: Grid): Position[] {
  const inside =
    goal.radius === 0
      ? goal.tiles
      : grid.walkables.filter((t) => within(t, goal));
  if (!goal.together) return inside;
  const middle = centre(inside);
  return middle === undefined ? [] : [middle];
}

/** The map as the orders shape it: forbidden tiles walled, `sites` the only deliveries. */
export function constrain(
  tiles: IOTile[],
  policy: Policy,
  sites: Position[],
): IOTile[] {
  const walled = new Set(policy.avoid.map((t) => key(t.x, t.y)));
  const delivery = new Set(sites.map((t) => key(t.x, t.y)));
  return tiles.map((tile) => {
    const at = key(tile.x, tile.y);
    if (walled.has(at)) return { ...tile, type: "0" };
    if (delivery.has(at)) return { ...tile, type: "2" };
    return tile.type === "2" ? { ...tile, type: "3" } : tile;
  });
}

export interface Exchange {
  /** Where the collector leaves parcels: beside the post, off the delivery tile. */
  drop: Position;
  /** The delivery tile the deliverer waits on. */
  post: Position;
}

/** A hand-off point both agents derive from the map alone: the delivery tile nearest the spawners. */
export function exchange(grid: Grid): Exchange | undefined {
  const middle = centre(grid.spawners);
  if (middle === undefined) return undefined;
  const delivery = new Set(grid.deliveries.map((t) => key(t.x, t.y)));
  const posts = [...grid.deliveries].sort(
    (a, b) =>
      Math.abs(a.x - middle.x) +
      Math.abs(a.y - middle.y) -
      (Math.abs(b.x - middle.x) + Math.abs(b.y - middle.y)),
  );
  for (const post of posts) {
    const beside = grid
      .exits(post)
      .find(([, to]) => !delivery.has(key(to.x, to.y)));
    if (beside !== undefined) return { drop: beside[1], post };
  }
  return undefined;
}

/**
 * What to put down on a delivery tile: everything, a batch of exactly the
 * ordered size, or the single cheapest parcel once it is worth little enough.
 * Undefined when the orders say to keep carrying.
 */
export function drop(
  carrying: { id: string; reward: number }[],
  policy: Policy,
): string[] | undefined {
  if (carrying.length === 0) return undefined;
  const max = policy.cheap;
  if (max !== null) {
    const cheapest = [...carrying]
      .sort((a, b) => a.reward - b.reward)
      .find((p) => p.reward <= max);
    return cheapest && [cheapest.id];
  }
  if (policy.batch !== null)
    return carrying.length < policy.batch
      ? undefined
      : carrying.slice(0, policy.batch).map((p) => p.id);
  return carrying.map((p) => p.id);
}
