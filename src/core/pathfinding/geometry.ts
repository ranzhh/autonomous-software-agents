/**
 * Shared pathfinding primitives: coordinate geometry plus the search types and
 * path-reconstruction helper that A* and BFS both build on. All pure, no I/O.
 * Coordinate convention (CLAUDE.md §6): right x+1, left x-1, up y+1, down y-1
 * (y is inverted vs screen).
 *
 * `reconstructPath` is an internal helper shared by the two search files in this
 * folder; it is intentionally NOT re-exported from the barrel (public API is just
 * the geometry helpers + `astar`/`bfsToNearest`).
 */

import type { Pos } from "../beliefs/index.js";
import type { Direction } from "../sdk/index.js";

/** A walkable route as a sequence of tiles, start..goal inclusive. */
export type Path = readonly Pos[];

/** Options shared by the grid searches. */
export interface SearchOptions {
  /**
   * Tiles to treat as impassable beyond static map walkability — e.g. tiles
   * currently occupied by other agents. Applied uniformly to every tile except
   * the start (you always stand on the start). Callers that want to reach a tile
   * a mover is sitting on can exempt it inside their own predicate.
   */
  readonly isBlocked?: (p: Pos) => boolean;
}

/** Manhattan (L1) distance — the admissible heuristic for a 4-connected grid. */
export function manhattan(a: Pos, b: Pos): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** True when two positions denote the same tile. */
export function samePos(a: Pos, b: Pos): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * The `emitMove` direction from `from` to `to` when `to` is an orthogonal
 * neighbour, else `undefined`. up = y+1, down = y-1, right = x+1, left = x-1.
 */
export function directionTo(from: Pos, to: Pos): Direction | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 1 && dy === 0) return "right";
  if (dx === -1 && dy === 0) return "left";
  if (dx === 0 && dy === 1) return "up";
  if (dx === 0 && dy === -1) return "down";
  return undefined;
}

/** Pack a tile coordinate into a single number key (matches game-map's scheme). */
export function posKey(x: number, y: number): number {
  return x * 100_000 + y;
}

/**
 * Walk a `childKey → parentKey` chain back from the goal to the start and emit
 * the path in start..goal order. `posByKey` resolves each key to its `Pos`.
 */
export function reconstructPath(
  cameFrom: ReadonlyMap<number, number>,
  posByKey: ReadonlyMap<number, Pos>,
  startKey: number,
  goalKey: number,
): Path {
  const keys: number[] = [];
  let key: number | undefined = goalKey;
  while (key !== undefined) {
    keys.push(key);
    if (key === startKey) break;
    key = cameFrom.get(key);
  }

  const path: Pos[] = [];
  for (let i = keys.length - 1; i >= 0; i--) {
    const k = keys[i];
    if (k === undefined) continue;
    const pos = posByKey.get(k);
    if (pos !== undefined) path.push(pos);
  }
  return path;
}
