/**
 * A* shortest path over the 4-connected grid to a single target tile. Pure over a
 * `GameMap` plus an optional `isBlocked` predicate (dynamic blockers). The path
 * includes both endpoints (`path[0]===start`, last `===goal`); `start===goal`
 * yields `[start]`; an unreachable goal yields `null`. The start tile is always
 * traversable (you stand on it); any other tile is traversable iff
 * `map.isWalkable(p) && !isBlocked(p)`. Manhattan heuristic, unit step cost, and a
 * deterministic tie-break (lower f, then earlier insertion) via the min-heap below.
 */

import type { GameMap, Pos } from "../beliefs/index.js";
import {
  manhattan,
  type Path,
  posKey,
  reconstructPath,
  type SearchOptions,
} from "./geometry.js";

interface OpenNode {
  readonly key: number;
  readonly f: number;
  readonly seq: number;
}

function less(a: OpenNode, b: OpenNode): boolean {
  return a.f < b.f || (a.f === b.f && a.seq < b.seq);
}

/** Binary min-heap of open nodes, ordered by (f, insertion seq). `!`-free. */
class MinHeap {
  private readonly items: OpenNode[] = [];

  get size(): number {
    return this.items.length;
  }

  push(node: OpenNode): void {
    const items = this.items;
    items.push(node);
    let i = items.length - 1;
    while (i > 0) {
      const parentIdx = (i - 1) >> 1;
      const parent = items[parentIdx];
      const cur = items[i];
      if (parent === undefined || cur === undefined || !less(cur, parent))
        break;
      items[i] = parent;
      items[parentIdx] = cur;
      i = parentIdx;
    }
  }

  pop(): OpenNode | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (top === undefined) return undefined;
    if (last !== undefined && items.length > 0) {
      items[0] = last;
      this.siftDown();
    }
    return top;
  }

  private siftDown(): void {
    const items = this.items;
    const n = items.length;
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;
      const atSmallest = items[smallest];
      const atLeft = items[left];
      if (
        left < n &&
        atLeft !== undefined &&
        atSmallest !== undefined &&
        less(atLeft, atSmallest)
      ) {
        smallest = left;
      }
      const atSmallest2 = items[smallest];
      const atRight = items[right];
      if (
        right < n &&
        atRight !== undefined &&
        atSmallest2 !== undefined &&
        less(atRight, atSmallest2)
      ) {
        smallest = right;
      }
      if (smallest === i) break;
      const a = items[i];
      const b = items[smallest];
      if (a === undefined || b === undefined) break;
      items[i] = b;
      items[smallest] = a;
      i = smallest;
    }
  }
}

/**
 * Find a shortest path from `start` to `goal`, or `null` if none exists under the
 * current walkability + `isBlocked` view.
 */
export function astar(
  map: GameMap,
  start: Pos,
  goal: Pos,
  options: SearchOptions = {},
): Path | null {
  if (!map.isWalkable(goal)) return null;

  const startKey = posKey(start.x, start.y);
  const goalKey = posKey(goal.x, goal.y);
  if (startKey === goalKey) return [start];

  const isBlocked = options.isBlocked;
  if (isBlocked?.(goal) === true) return null;

  const gScore = new Map<number, number>([[startKey, 0]]);
  const cameFrom = new Map<number, number>();
  const posByKey = new Map<number, Pos>([[startKey, start]]);

  const open = new MinHeap();
  let seq = 0;
  open.push({ key: startKey, f: manhattan(start, goal), seq: seq++ });

  while (open.size > 0) {
    const current = open.pop();
    if (current === undefined) break;
    const currentKey = current.key;
    if (currentKey === goalKey) {
      return reconstructPath(cameFrom, posByKey, startKey, goalKey);
    }

    const cur = posByKey.get(currentKey);
    if (cur === undefined) continue;
    const g = gScore.get(currentKey);
    if (g === undefined) continue;

    for (const n of map.neighbours(cur)) {
      const nKey = posKey(n.x, n.y);
      if (isBlocked?.(n) === true) continue;
      const tentative = g + 1;
      const known = gScore.get(nKey);
      if (known === undefined || tentative < known) {
        cameFrom.set(nKey, currentKey);
        gScore.set(nKey, tentative);
        posByKey.set(nKey, n);
        open.push({ key: nKey, f: tentative + manhattan(n, goal), seq: seq++ });
      }
    }
  }
  return null;
}
