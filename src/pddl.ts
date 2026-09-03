import type { Beliefs } from "./beliefs.js";
import { env } from "./env.js";
import type { Grid } from "./grid.js";
import type { Action, Intention } from "./plans.js";
import type { Position } from "./sdk.js";

/**
 * Means-ends reasoning as planning: an intention becomes a whole action
 * sequence through a PDDL solver. Adjacency facts come from `grid.exits`,
 * so the one-way arrow tiles hold in the domain as they do on the board.
 */

// A move onto a crate's tile is a push: the crate slides one tile onward,
// so it must land on a slidable ('5') tile holding no other crate. `clear`
// tracks crates only; other agents stay outside the domain.
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

// A push is executed as the move into the crate; the server slides it.
const NAMES: Record<string, Action> = {
  "move-up": "up",
  "move-down": "down",
  "move-right": "right",
  "move-left": "left",
  "push-up": "up",
  "push-down": "down",
  "push-right": "right",
  "push-left": "left",
  pickup: "pickup",
  putdown: "putdown",
};

/** Actions out of the solver's plan text, one per `(action ...)` line. */
export function parse(plan: string): Action[] {
  const actions: Action[] = [];
  for (const line of plan.split("\n")) {
    if (line.trimStart().startsWith(";")) continue;
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
