import type { Beliefs } from "./beliefs.js";
import { env } from "./env.js";
import type { Grid } from "./grid.js";
import type { Action, Intention } from "./plans.js";
import type { Position } from "./sdk.js";

/**
 * Means-ends reasoning as planning: turn an intention into the whole action
 * sequence by asking a PDDL solver, instead of walking a BFS distance field
 * one step at a time. Adjacency facts come from `grid.exits`, so the one-way
 * arrow tiles hold in the domain exactly as they do on the board.
 */

export const DOMAIN = `(define (domain deliveroo)
  (:requirements :strips :typing)
  (:types tile parcel)
  (:predicates
    (at ?t - tile)
    (up ?from ?to - tile)
    (down ?from ?to - tile)
    (right ?from ?to - tile)
    (left ?from ?to - tile)
    (on ?p - parcel ?t - tile)
    (carrying ?p - parcel)
    (delivery ?t - tile)
    (delivered ?p - parcel))
  (:action move-up
    :parameters (?from ?to - tile)
    :precondition (and (at ?from) (up ?from ?to))
    :effect (and (not (at ?from)) (at ?to)))
  (:action move-down
    :parameters (?from ?to - tile)
    :precondition (and (at ?from) (down ?from ?to))
    :effect (and (not (at ?from)) (at ?to)))
  (:action move-right
    :parameters (?from ?to - tile)
    :precondition (and (at ?from) (right ?from ?to))
    :effect (and (not (at ?from)) (at ?to)))
  (:action move-left
    :parameters (?from ?to - tile)
    :precondition (and (at ?from) (left ?from ?to))
    :effect (and (not (at ?from)) (at ?to)))
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

/**
 * The problem for an intention, from what is believed right now; undefined
 * when the intention states no goal (explore) or its target is gone.
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

  const facts = [`(at ${tile(at)})`];
  for (const from of grid.tiles)
    for (const [direction, to] of grid.exits(from))
      facts.push(`(${direction} ${tile(from)} ${tile(to)})`);
  for (const d of grid.deliveries) facts.push(`(delivery ${tile(d)})`);
  for (const p of loose) facts.push(`(on ${parcel(p.id)} ${tile(p)})`);
  for (const p of carried) facts.push(`(carrying ${parcel(p.id)})`);

  const parcels = [...loose, ...carried].map((p) => parcel(p.id));
  const objects = [
    `${grid.tiles.map(tile).join(" ")} - tile`,
    ...(parcels.length > 0 ? [`${parcels.join(" ")} - parcel`] : []),
  ];
  return `(define (problem deliveroo-${intention.kind})
  (:domain deliveroo)
  (:objects ${objects.join("\n            ")})
  (:init ${facts.join("\n         ")})
  (:goal ${goal}))`;
}

const NAMES: Record<string, Action> = {
  "move-up": "up",
  "move-down": "down",
  "move-right": "right",
  "move-left": "left",
  pickup: "pickup",
  putdown: "putdown",
};

/** Actions out of the solver's plan text, one per `(action ...)` line. */
export function parse(plan: string): Action[] {
  const actions: Action[] = [];
  for (const line of plan.split("\n")) {
    const name = line.match(/\(\s*([a-z-]+)/i)?.[1]?.toLowerCase();
    if (name === undefined) continue;
    const action = NAMES[name];
    if (action === undefined) throw new Error(`unknown plan action: ${line}`);
    // The game grabs and drops a whole tile at once; the domain goes parcel
    // by parcel, so a run of pickups or putdowns collapses into one.
    if (
      action === actions.at(-1) &&
      (action === "pickup" || action === "putdown")
    )
      continue;
    actions.push(action);
  }
  return actions;
}

const SOLVE_PATH = "/package/dual-bfws-ffparser/solve";
const POLL_MS = 100;
const DEADLINE_MS = 10_000;

/** One round trip to the planning-as-a-service solver. */
export async function solve(problem: string): Promise<Action[]> {
  const submitted = await fetch(`${env.PDDL_SOLVER}${SOLVE_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ domain: DOMAIN, problem, number_of_plans: "1" }),
  });
  if (!submitted.ok)
    throw new Error(
      `solver refused: ${submitted.status} ${await submitted.text()}`,
    );
  const { result } = (await submitted.json()) as { result?: string };
  if (result === undefined)
    throw new Error("solver answered without a result url");

  const expiry = Date.now() + DEADLINE_MS;
  while (Date.now() < expiry) {
    const res = await fetch(`${env.PDDL_SOLVER}${result}`);
    if (!res.ok)
      throw new Error(`solver result lost: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as {
      status: string;
      result?: { output?: { plan?: string } };
    };
    if (body.status === "PENDING") {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      continue;
    }
    if (body.status !== "ok") throw new Error(`solver ended ${body.status}`);
    return parse(body.result?.output?.plan ?? "");
  }
  throw new Error(`solver still pending after ${DEADLINE_MS}ms`);
}

/**
 * The full action sequence serving the intention; undefined when there is
 * nothing to plan for.
 */
export async function plan(
  intention: Intention,
  beliefs: Beliefs,
  grid: Grid,
  now = Date.now(),
): Promise<Action[] | undefined> {
  const text = problem(intention, beliefs, grid, now);
  if (text === undefined) return undefined;
  const actions = await solve(text);
  return actions.length > 0 ? actions : undefined;
}
