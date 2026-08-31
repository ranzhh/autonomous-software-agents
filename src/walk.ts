import type { Grid, Route } from "./grid.js";
import { drift } from "./plans.js";
import { key, MOVES, sameTile } from "./position.js";
import { DIRECTIONS, type Direction, type Position } from "./sdk.js";
import { destination } from "./tour.js";

const REFUSALS = 3;
const BLOCKED = 3_000;
const STALE = 30_000;

export interface Mover {
  here(): Position;
  move(direction: Direction): Promise<Position | false | undefined>;
  pace(): Promise<void>;
}

export interface Walker {
  walk(to: Position, board: Grid): Promise<boolean>;
  explore(board: Grid): Promise<void>;
}

const beside = (at: Position, board: Grid): [Direction, Position][] =>
  DIRECTIONS.map((d): [Direction, Position] => [
    d,
    { x: at.x + MOVES[d].dx, y: at.y + MOVES[d].dy },
  ]).filter(([, to]) => board.walkable(to));

export function walker(mover: Mover, now: () => number = Date.now): Walker {
  const refusedAt = new Map<string, number>();
  const visited = new Map<string, number>();

  const blocked = (to: Position): boolean =>
    (refusedAt.get(key(to.x, to.y)) ?? 0) > now() - BLOCKED;

  async function step(direction: Direction): Promise<boolean> {
    const at = mover.here();
    const to = { x: at.x + MOVES[direction].dx, y: at.y + MOVES[direction].dy };
    if (blocked(to)) return false;
    if ((await mover.move(direction)) !== false) return true;
    refusedAt.set(key(to.x, to.y), now());
    return false;
  }

  async function sidestep(
    avoid: Direction,
    route: Route,
    board: Grid,
  ): Promise<boolean> {
    const around = beside(mover.here(), board)
      .filter(([direction, to]) => direction !== avoid && !blocked(to))
      .sort(([, a], [, b]) => route.distance(a) - route.distance(b));
    const detour = around[0];
    if (detour === undefined) {
      await mover.pace();
      return false;
    }
    return await step(detour[0]);
  }

  async function walk(to: Position, board: Grid): Promise<boolean> {
    const route = board.route(to);
    let refused = 0;
    while (!sameTile(mover.here(), to)) {
      const next = route.step(mover.here());
      if (next === undefined) return false;
      if (await step(next)) continue;
      if (++refused > REFUSALS) return false;
      if (!(await sidestep(next, route, board))) refused++;
    }
    return true;
  }

  async function explore(board: Grid): Promise<void> {
    const at = mover.here();
    visited.set(key(at.x, at.y), now());
    const stale = board.spawners.filter(
      (s) => (visited.get(key(s.x, s.y)) ?? 0) < now() - STALE,
    );

    const route = board.route(...stale);
    const next = route.step(at);
    if (next !== undefined) {
      if (await step(next)) return;
      const target = destination(route, at);
      if (target) visited.set(key(target.x, target.y), now());
    }

    const aside = drift(board, at, (to) => !blocked(to));
    if (aside === undefined || !(await step(aside))) await mover.pace();
  }

  return { walk, explore };
}
