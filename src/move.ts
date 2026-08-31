import type { Beliefs } from "./beliefs.js";
import type { Grid, Route } from "./grid.js";
import { key, MOVES } from "./position.js";
import type { Connection, Direction, Position } from "./sdk.js";

const BLOCKED = 3_000;

export interface Mover {
  step(direction: Direction): Promise<boolean>;
  sidestep(avoid: Direction, route: Route): Promise<boolean>;
  open(at: Position): [Direction, Position][];
  pace(): Promise<unknown>;
}

export function mover(
  game: Connection,
  beliefs: Beliefs,
  board: () => Grid,
  movementDuration: number,
): Mover {
  const refusedAt = new Map<string, number>();
  const blocked = (to: Position): boolean =>
    (refusedAt.get(key(to.x, to.y)) ?? 0) > Date.now() - BLOCKED;

  const open = (at: Position): [Direction, Position][] =>
    board()
      .exits(at)
      .filter(([, to]) => !blocked(to));

  async function step(direction: Direction): Promise<boolean> {
    const at = beliefs.me();
    const to = { x: at.x + MOVES[direction].dx, y: at.y + MOVES[direction].dy };
    if (blocked(to)) return false;
    const landed = await game.move(direction);
    const me = game.me();
    if (me) beliefs.moved(me);
    if (landed !== false) return true;
    refusedAt.set(key(to.x, to.y), Date.now());
    return false;
  }

  return {
    step,
    open,
    pace: () => new Promise((resolve) => setTimeout(resolve, movementDuration)),
    async sidestep(avoid, route) {
      const at = beliefs.me();
      const here = route.distance(at);
      const detour = open(at)
        .filter(([d, to]) => d !== avoid && route.distance(to) <= here)
        .sort(([, a], [, b]) => route.distance(a) - route.distance(b))[0];
      return detour !== undefined && (await step(detour[0]));
    },
  };
}
