import { describe, expect, it } from "vitest";
import {
  buildGameMap,
  type GameMap,
  type Pos,
} from "../../../src/core/beliefs/index.js";
import { astar, manhattan } from "../../../src/core/pathfinding/index.js";
import type { IOTile } from "../../../src/core/sdk/index.js";

/** Build a width×height all-walkable map ("3") minus the given wall tiles ("0"). */
function gridMap(
  width: number,
  height: number,
  walls: ReadonlyArray<Pos> = [],
): GameMap {
  const wallSet = new Set(walls.map((p) => `${p.x},${p.y}`));
  const tiles: IOTile[] = [];
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      tiles.push({ x, y, type: wallSet.has(`${x},${y}`) ? "0" : "3" });
    }
  }
  return buildGameMap(width, height, tiles);
}

/** Assert a returned path is a contiguous, walkable, non-blocked start..goal route. */
function assertValidPath(
  map: GameMap,
  path: ReadonlyArray<Pos>,
  start: Pos,
  goal: Pos,
  isBlocked: (p: Pos) => boolean = () => false,
): void {
  expect(path.length).toBeGreaterThan(0);
  expect(path[0]).toEqual(start);
  expect(path[path.length - 1]).toEqual(goal);
  for (let i = 0; i < path.length; i++) {
    const tile = path[i];
    if (tile === undefined) throw new Error("unexpected gap in path");
    expect(map.isWalkable(tile)).toBe(true);
    if (i > 0) {
      const prev = path[i - 1];
      if (prev === undefined) throw new Error("unexpected gap in path");
      expect(manhattan(prev, tile)).toBe(1); // each step is to an orthogonal neighbour
      expect(isBlocked(tile)).toBe(false); // never step onto a blocked tile
    }
  }
}

describe("astar — basic", () => {
  it("finds a straight-line path including both endpoints", () => {
    const map = gridMap(5, 1);
    const path = astar(map, { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(path).not.toBeNull();
    if (path === null) return;
    expect(path).toHaveLength(5);
    assertValidPath(map, path, { x: 0, y: 0 }, { x: 4, y: 0 });
  });

  it("returns [start] when start === goal", () => {
    const map = gridMap(3, 3);
    const path = astar(map, { x: 1, y: 1 }, { x: 1, y: 1 });
    expect(path).toEqual([{ x: 1, y: 1 }]);
  });

  it("returns null when the goal is walled off", () => {
    const map = gridMap(3, 1, [{ x: 1, y: 0 }]);
    expect(astar(map, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
  });

  it("returns null when the goal tile itself is non-walkable", () => {
    const map = gridMap(3, 1, [{ x: 2, y: 0 }]);
    expect(astar(map, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
  });
});

describe("astar — detours", () => {
  it("routes around a wall barrier", () => {
    // 3×3 grid with a vertical wall at x=1, y∈{0,1}; the only way around is via y=2.
    const map = gridMap(3, 3, [
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]);
    const start = { x: 0, y: 0 };
    const goal = { x: 2, y: 0 };
    const path = astar(map, start, goal);
    expect(path).not.toBeNull();
    if (path === null) return;
    assertValidPath(map, path, start, goal);
    expect(path).toHaveLength(7); // 6 steps around the barrier
    expect(path).toContainEqual({ x: 1, y: 2 }); // passes through the only gap
  });
});

describe("astar — dynamic blockers", () => {
  it("routes around a blocked intermediate tile", () => {
    const map = gridMap(3, 3);
    const start = { x: 0, y: 0 };
    const goal = { x: 2, y: 0 };
    const isBlocked = (p: Pos): boolean => p.x === 1 && p.y === 0;
    const path = astar(map, start, goal, { isBlocked });
    expect(path).not.toBeNull();
    if (path === null) return;
    assertValidPath(map, path, start, goal, isBlocked);
    expect(path).not.toContainEqual({ x: 1, y: 0 });
  });

  it("returns null when the goal is blocked (uniform isBlocked policy)", () => {
    const map = gridMap(3, 1);
    const isBlocked = (p: Pos): boolean => p.x === 2 && p.y === 0;
    expect(
      astar(map, { x: 0, y: 0 }, { x: 2, y: 0 }, { isBlocked }),
    ).toBeNull();
  });

  it("ignores a blocker sitting on the start tile (origin is always passable)", () => {
    const map = gridMap(3, 1);
    const start = { x: 0, y: 0 };
    const goal = { x: 2, y: 0 };
    const isBlocked = (p: Pos): boolean => p.x === 0 && p.y === 0;
    const path = astar(map, start, goal, { isBlocked });
    expect(path).not.toBeNull();
    if (path === null) return;
    expect(path[0]).toEqual(start);
  });
});
