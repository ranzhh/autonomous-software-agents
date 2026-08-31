import { key, MOVES } from "./position.js";
import type { Direction, IOTile, Position } from "./sdk.js";

export interface Route {
  /** Steps from `from` to the nearest target; Infinity when unreachable. */
  distance(from: Position): number;
  /** The move to make now; undefined on a target or off the route. */
  step(from: Position): Direction | undefined;
}

export interface Grid {
  walkable(p: Position): boolean;
  deliveries: Position[];
  spawners: Position[];
  /** One breadth-first search toward the nearest of the targets. */
  route(...targets: Position[]): Route;
}

// An arrow refuses only the step entering it against itself (Tile.js:90).
const AGAINST: Partial<Record<string, Direction>> = {
  "↑": "down",
  "↓": "up",
  "→": "left",
  "←": "right",
};

export function grid(tiles: IOTile[]): Grid {
  const walkables = new Map<string, IOTile>();
  for (const tile of tiles)
    if (tile.type !== "0") walkables.set(key(tile.x, tile.y), tile);

  function exits(tile: IOTile): [Direction, IOTile][] {
    const out: [Direction, IOTile][] = [];
    for (const [direction, { dx, dy }] of Object.entries(MOVES) as [
      Direction,
      { dx: number; dy: number },
    ][]) {
      const next = walkables.get(key(tile.x + dx, tile.y + dy));
      if (next && AGAINST[next.type] !== direction) out.push([direction, next]);
    }
    return out;
  }

  // Who can step onto each tile, honouring the arrows.
  const enters = new Map<string, IOTile[]>();
  for (const tile of walkables.values())
    for (const [, to] of exits(tile)) {
      const at = key(to.x, to.y);
      enters.set(at, [...(enters.get(at) ?? []), tile]);
    }

  function route(...targets: Position[]): Route {
    // Flood from the targets against the arrows, so each tile learns its way there.
    const distances = new Map<string, number>();
    let frontier = targets
      .map((t) => walkables.get(key(t.x, t.y)))
      .filter((tile) => tile !== undefined);
    for (const tile of frontier) distances.set(key(tile.x, tile.y), 0);

    for (let steps = 1; frontier.length > 0; steps++) {
      const next: IOTile[] = [];
      for (const tile of frontier)
        for (const from of enters.get(key(tile.x, tile.y)) ?? []) {
          const at = key(from.x, from.y);
          if (distances.has(at)) continue;
          distances.set(at, steps);
          next.push(from);
        }
      frontier = next;
    }

    const distance = (from: Position): number =>
      distances.get(key(from.x, from.y)) ?? Infinity;

    return {
      distance,
      step(from) {
        const here = walkables.get(key(from.x, from.y));
        if (!here || distance(from) === 0 || distance(from) === Infinity)
          return undefined;
        for (const [direction, to] of exits(here))
          if (distance(to) === distance(from) - 1) return direction;
        return undefined;
      },
    };
  }

  const positions = (type: IOTile["type"]): Position[] =>
    [...walkables.values()]
      .filter((tile) => tile.type === type)
      .map(({ x, y }) => ({ x, y }));

  return {
    walkable: (p) => walkables.has(key(p.x, p.y)),
    deliveries: positions("2"),
    spawners: positions("1"),
    route,
  };
}
