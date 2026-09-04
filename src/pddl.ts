import type { Beliefs } from "./beliefs.js";
import type { Grid } from "./grid.js";
import type { Action, Intention } from "./plans.js";
import type { Position } from "./sdk.js";
import { solve } from "./solver.js";

/**
 * Compile an intention and the current beliefs into a PDDL problem; parse
 * the solver's plan back into game actions. Adjacency facts come from
 * `grid.exits`, which already applies the arrow rule.
 */

// Moving into a crate pushes it one tile in the move direction. The server
// allows this only onto a '5' tile with no crate on it. `clear` means "no
// crate here"; other agents are not modelled.
const MOVE = (d: string) => `  (:action move-${d}
    :parameters (?from ?to - tile)
    :precondition (and (at ?from) (${d} ?from ?to) (clear ?to))
    :effect (and (not (at ?from)) (at ?to)))`;

const PUSH = (d: string) => `  (:action push-${d}
    :parameters (?c - crate ?from ?mid ?to - tile)
    :precondition (and (at ?from) (${d} ?from ?mid) (crate-at ?c ?mid)
                       (${d} ?mid ?to) (slidable ?to) (clear ?to))
    :effect (and (not (at ?from)) (at ?mid)
                 (not (crate-at ?c ?mid)) (crate-at ?c ?to)
                 (clear ?mid) (not (clear ?to))))`;

export const DOMAIN = `(define (domain deliveroo)
  (:requirements :strips :typing)
  (:types tile parcel crate)
  (:predicates
    (at ?t - tile)
    (up ?from ?to - tile)
    (down ?from ?to - tile)
    (right ?from ?to - tile)
    (left ?from ?to - tile)
    (on ?p - parcel ?t - tile)
    (carrying ?p - parcel)
    (delivery ?t - tile)
    (delivered ?p - parcel)
    (crate-at ?c - crate ?t - tile)
    (clear ?t - tile)
    (slidable ?t - tile))
${["up", "down", "right", "left"].flatMap((d) => [MOVE(d), PUSH(d)]).join("\n")}
  (:action pickup
    :parameters (?p - parcel ?t - tile)
    :precondition (and (at ?t) (on ?p ?t))
    :effect (and (carrying ?p) (not (on ?p ?t))))
  (:action putdown
    :parameters (?p - parcel ?t - tile)
    :precondition (and (at ?t) (delivery ?t) (carrying ?p))
    :effect (and (delivered ?p) (not (carrying ?p)))))`;

const tile = (p: Position): string => `t_${Math.round(p.x)}_${Math.round(p.y)}`;
const parcel = (id: string): string => `p_${id}`;
const crate = (id: string): string => `c_${id}`;

/**
 * Build the problem for an intention; undefined when there is no goal to
 * state (explore, or the target is gone).
 */
export function problem(
  intention: Intention,
  beliefs: Beliefs,
  grid: Grid,
  now = Date.now(),
): string | undefined {
  const me = beliefs.me();
  const at = { x: me.x ?? 0, y: me.y ?? 0 };
  const loose = beliefs.parcels(now).filter((p) => !p.carriedBy);
  const carried = beliefs.carrying(now);

  let goal: string | undefined;
  if (intention.kind === "fetch" && loose.some((p) => p.id === intention.id))
    goal = `(carrying ${parcel(intention.id)})`;
  if (intention.kind === "home" && carried.length > 0)
    goal = `(and ${carried.map((p) => `(delivered ${parcel(p.id)})`).join(" ")})`;
  if (intention.kind === "scout" && grid.walkable(intention))
    goal = `(at ${tile(intention)})`;
  if (goal === undefined) return undefined;

  const crates = beliefs.crates();
  const blocked = new Set(crates.map((c) => tile(c)));

  const facts = [`(at ${tile(at)})`];
  for (const from of grid.walkables)
    for (const [direction, to] of grid.exits(from))
      facts.push(`(${direction} ${tile(from)} ${tile(to)})`);
  for (const t of grid.walkables)
    if (!blocked.has(tile(t))) facts.push(`(clear ${tile(t)})`);
  for (const s of grid.slidables) facts.push(`(slidable ${tile(s)})`);
  for (const d of grid.deliveries) facts.push(`(delivery ${tile(d)})`);
  for (const c of crates) facts.push(`(crate-at ${crate(c.id)} ${tile(c)})`);
  for (const p of loose) facts.push(`(on ${parcel(p.id)} ${tile(p)})`);
  for (const p of carried) facts.push(`(carrying ${parcel(p.id)})`);

  const parcels = [...loose, ...carried].map((p) => parcel(p.id));
  const objects = [
    `${grid.walkables.map(tile).join(" ")} - tile`,
    ...(parcels.length > 0 ? [`${parcels.join(" ")} - parcel`] : []),
    ...(crates.length > 0
      ? [`${crates.map((c) => crate(c.id)).join(" ")} - crate`]
      : []),
  ];
  return `(define (problem deliveroo-${intention.kind})
  (:domain deliveroo)
  (:objects ${objects.join("\n            ")})
  (:init ${facts.join("\n         ")})
  (:goal ${goal}))`;
}

/** One planned action; a push expects a crate on the target tile. */
export interface Step {
  do: Action;
  push: boolean;
}

// The server executes a push as a plain move into the crate.
const NAMES: Record<string, Step> = {
  "move-up": { do: "up", push: false },
  "move-down": { do: "down", push: false },
  "move-right": { do: "right", push: false },
  "move-left": { do: "left", push: false },
  "push-up": { do: "up", push: true },
  "push-down": { do: "down", push: true },
  "push-right": { do: "right", push: true },
  "push-left": { do: "left", push: true },
  pickup: { do: "pickup", push: false },
  putdown: { do: "putdown", push: false },
};

/** Parse the solver's plan text, one step per `(action ...)` line. */
export function parse(plan: string): Step[] {
  const steps: Step[] = [];
  for (const line of plan.split("\n")) {
    if (line.trimStart().startsWith(";")) continue;
    const name = line.match(/\(\s*([a-z-]+)/i)?.[1]?.toLowerCase();
    if (name === undefined) continue;
    const step = NAMES[name];
    if (step === undefined) throw new Error(`unknown plan action: ${line}`);
    // pickup and putdown act on every parcel on the tile, but the domain
    // plans them per parcel: collapse consecutive repeats into one.
    if (
      step.do === steps.at(-1)?.do &&
      (step.do === "pickup" || step.do === "putdown")
    )
      continue;
    steps.push({ ...step });
  }
  return steps;
}

export type Planned = Step[] | "no goal" | "no plan";

/** Plan the intention: steps, "no goal" to state, or "no plan" found. */
export async function plan(
  intention: Intention,
  beliefs: Beliefs,
  grid: Grid,
  now = Date.now(),
): Promise<Planned> {
  const text = problem(intention, beliefs, grid, now);
  if (text === undefined) return "no goal";
  const lines = await solve(DOMAIN, text);
  if (lines === undefined) return "no plan";
  const steps = parse(lines);
  // A solved, empty plan means the goal already holds.
  return steps.length > 0 ? steps : "no goal";
}
