import type { ParcelBelief } from "./beliefs.js";
import type { Grid } from "./grid.js";
import { key, sameTile } from "./position.js";
import { fields, type IOTile, type Position } from "./sdk.js";

export interface Goal {
  kind: "visit" | "deliver";
  tiles: Position[];
  bonus: number;
  /** Counts only once the teammate stands on one of the tiles too. */
  together: boolean;
}

export interface Rule {
  contains: string;
  effect: "hold" | "resume";
}

export interface Policy {
  avoid: Position[];
  noDelivery: Position[];
  /** A delivery is exactly this many parcels. */
  batch?: number | undefined;
  /** A delivery is one parcel worth at most this. */
  cheap?: number | undefined;
  handoff: boolean;
  hold: boolean;
  goals: Goal[];
  rules: Rule[];
}

export const NONE: Policy = {
  avoid: [],
  noDelivery: [],
  handoff: false,
  hold: false,
  goals: [],
  rules: [],
};

const goalKey = (goal: Goal): string =>
  `${goal.kind} ${goal.tiles.map((t) => key(t.x, t.y)).join(" ")}`;

export interface Orders {
  policy(): Policy;
  issue(policy: Policy): void;
  onIssue(listener: (policy: Policy) => void): void;
  /** A goal reached; it is not pursued again. */
  done(goal: Goal): void;
  achieved(): ReadonlySet<string>;
  pending(): Goal[];
}

export function orders(initial: Policy = NONE): Orders {
  let policy = initial;
  const achieved = new Set<string>();
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
    done: (goal) => {
      achieved.add(goalKey(goal));
    },
    achieved: () => achieved,
    pending: () => policy.goals.filter((g) => !achieved.has(goalKey(g))),
  };
}

/** The policy after the standing rule the text triggers first, if any changes it. */
export function react(policy: Policy, text: string): Policy | undefined {
  const lower = text.toLowerCase();
  let first: Rule | undefined;
  let earliest = Infinity;
  for (const rule of policy.rules) {
    const at = lower.indexOf(rule.contains.toLowerCase());
    if (at >= 0 && at < earliest) {
      earliest = at;
      first = rule;
    }
  }
  if (first === undefined) return undefined;
  const hold = first.effect === "hold";
  return hold === policy.hold ? undefined : { ...policy, hold };
}

/** The tiles as the policy has them: a forbidden delivery tile is merely walkable. */
export function constrain(tiles: IOTile[], policy: Policy): IOTile[] {
  if (policy.noDelivery.length === 0) return tiles;
  const banned = new Set(policy.noDelivery.map((t) => key(t.x, t.y)));
  return tiles.map((tile) =>
    tile.type === "2" && banned.has(key(tile.x, tile.y))
      ? { ...tile, type: "3" }
      : tile,
  );
}

export interface Exchange {
  /** Where this agent leaves what it picked up. */
  mine: Position;
  /** Where the teammate leaves what it picked up. */
  theirs: Position;
}

/** Two tiles beside the delivery nearest the spawners' centre, split by id order, so both agents agree without a word. */
export function rendezvous(
  grid: Grid,
  me: string,
  mate: string,
): Exchange | undefined {
  if (grid.spawners.length === 0) return undefined;
  const centre = {
    x: grid.spawners.reduce((s, p) => s + p.x, 0) / grid.spawners.length,
    y: grid.spawners.reduce((s, p) => s + p.y, 0) / grid.spawners.length,
  };
  const delivery = new Set(grid.deliveries.map((d) => key(d.x, d.y)));
  const ordered = [...grid.deliveries].sort(
    (a, b) =>
      Math.abs(a.x - centre.x) +
      Math.abs(a.y - centre.y) -
      (Math.abs(b.x - centre.x) + Math.abs(b.y - centre.y)),
  );
  for (const tile of ordered) {
    const beside = grid
      .exits(tile)
      .map(([, to]) => to)
      .filter((to) => !delivery.has(key(to.x, to.y)));
    const [a, b] = beside;
    if (a === undefined || b === undefined) continue;
    return me < mate ? { mine: a, theirs: b } : { mine: b, theirs: a };
  }
  return undefined;
}

export type Handing = { drop: string[]; more: boolean } | "wait" | "leave";

/** What to put down on arriving where the tour banks, or whether to stay or move on. */
export function handing(carrying: ParcelBelief[], policy: Policy): Handing {
  if (carrying.length === 0) return "leave";
  const max = policy.cheap;
  if (max !== undefined) {
    const cheap = carrying.find((p) => p.reward <= max);
    if (cheap === undefined) return "wait";
    return { drop: [cheap.id], more: carrying.length > 1 };
  }
  if (policy.batch !== undefined && policy.batch > 1) {
    if (carrying.length < policy.batch) return "leave";
    return {
      drop: carrying.slice(0, policy.batch).map((p) => p.id),
      more: carrying.length - policy.batch >= policy.batch,
    };
  }
  return { drop: carrying.map((p) => p.id), more: false };
}

function positions(value: unknown): Position[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: Position[] = [];
  for (const one of value) {
    const record = fields(one);
    if (typeof record?.x !== "number" || typeof record.y !== "number")
      return undefined;
    out.push({ x: record.x, y: record.y });
  }
  return out;
}

function goals(value: unknown): Goal[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: Goal[] = [];
  for (const one of value) {
    const record = fields(one);
    const tiles = positions(record?.tiles);
    if (record === undefined || tiles === undefined) return undefined;
    if (record.kind !== "visit" && record.kind !== "deliver") return undefined;
    if (typeof record.bonus !== "number") return undefined;
    out.push({
      kind: record.kind,
      tiles,
      bonus: record.bonus,
      together: record.together === true,
    });
  }
  return out;
}

function rules(value: unknown): Rule[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: Rule[] = [];
  for (const one of value) {
    const record = fields(one);
    if (typeof record?.contains !== "string") return undefined;
    if (record.effect !== "hold" && record.effect !== "resume")
      return undefined;
    out.push({ contains: record.contains, effect: record.effect });
  }
  return out;
}

const optional = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

export function policyOf(value: unknown): Policy | undefined {
  const record = fields(value);
  if (record === undefined) return undefined;
  const avoid = positions(record.avoid);
  const noDelivery = positions(record.noDelivery);
  const wanted = goals(record.goals);
  const standing = rules(record.rules);
  if (!avoid || !noDelivery || !wanted || !standing) return undefined;
  return {
    avoid,
    noDelivery,
    batch: optional(record.batch),
    cheap: optional(record.cheap),
    handoff: record.handoff === true,
    hold: record.hold === true,
    goals: wanted,
    rules: standing,
  };
}

export const within = (at: Position, tiles: Position[]): boolean =>
  tiles.some((tile) => sameTile(tile, at));

/** The tile of the set closest to all the others. */
export function centre(tiles: Position[]): Position {
  const spread = (a: Position): number =>
    tiles.reduce(
      (sum, b) => sum + Math.abs(a.x - b.x) + Math.abs(a.y - b.y),
      0,
    );
  return tiles.reduce((best, tile) =>
    spread(tile) < spread(best) ? tile : best,
  );
}
