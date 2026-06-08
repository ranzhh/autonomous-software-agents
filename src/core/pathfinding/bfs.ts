/**
 * Breadth-first search from a start tile to the NEAREST tile in a goal set. Unit
 * step cost, so BFS yields a shortest path; ties (several goals at the same depth)
 * are broken by neighbour-expansion order (game-map's up/down/left/right). Returns
 * the path (start..goal inclusive, last element = the chosen goal) or `null` if no
 * goal is reachable. Same passability rule as A*: the start is always allowed; any
 * other tile is enterable iff `map.isWalkable(p) && !isBlocked(p)`.
 *
 * Used by the live navigation demo (nearest delivery tile) and, later, the Deliver
 * plan.
 */

import type { GameMap, Pos } from "../beliefs/index.js";
import {
  type Path,
  posKey,
  reconstructPath,
  type SearchOptions,
} from "./geometry.js";

/** Shortest path from `start` to the nearest tile in `goals`, or `null`. */
export function bfsToNearest(
  map: GameMap,
  start: Pos,
  goals: Iterable<Pos>,
  options: SearchOptions = {},
): Path | null {
  const goalSet = new Set<number>();
  for (const g of goals) goalSet.add(posKey(g.x, g.y));
  if (goalSet.size === 0) return null;

  const startKey = posKey(start.x, start.y);
  if (goalSet.has(startKey)) return [start];

  const isBlocked = options.isBlocked;
  const visited = new Set<number>([startKey]);
  const cameFrom = new Map<number, number>();
  const posByKey = new Map<number, Pos>([[startKey, start]]);

  let frontier: Pos[] = [start];
  while (frontier.length > 0) {
    const next: Pos[] = [];
    for (const cur of frontier) {
      const curKey = posKey(cur.x, cur.y);
      for (const n of map.neighbours(cur)) {
        const nKey = posKey(n.x, n.y);
        if (visited.has(nKey)) continue;
        if (isBlocked?.(n) === true) continue;
        visited.add(nKey);
        cameFrom.set(nKey, curKey);
        posByKey.set(nKey, n);
        if (goalSet.has(nKey)) {
          return reconstructPath(cameFrom, posByKey, startKey, nKey);
        }
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}
