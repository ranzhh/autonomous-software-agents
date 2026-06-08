import { describe, expect, it } from "vitest";
import {
  buildGameMap,
  type GameMap,
  type Pos,
} from "../../../src/core/beliefs/index.js";
import { bfsToNearest } from "../../../src/core/pathfinding/index.js";
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

describe("bfsToNearest", () => {
  it("picks the nearest of several goals", () => {
    const map = gridMap(5, 1);
    const path = bfsToNearest(map, { x: 0, y: 0 }, [
      { x: 4, y: 0 },
      { x: 2, y: 0 },
    ]);
    expect(path).not.toBeNull();
    if (path === null) return;
    expect(path[path.length - 1]).toEqual({ x: 2, y: 0 });
    expect(path).toHaveLength(3);
  });

  it("returns [start] when already standing on a goal", () => {
    const map = gridMap(3, 3);
    const path = bfsToNearest(map, { x: 1, y: 1 }, [{ x: 1, y: 1 }]);
    expect(path).toEqual([{ x: 1, y: 1 }]);
  });

  it("returns null for an empty goal set", () => {
    const map = gridMap(3, 3);
    expect(bfsToNearest(map, { x: 0, y: 0 }, [])).toBeNull();
  });

  it("returns null when no goal is reachable", () => {
    const map = gridMap(3, 1, [{ x: 1, y: 0 }]);
    expect(bfsToNearest(map, { x: 0, y: 0 }, [{ x: 2, y: 0 }])).toBeNull();
  });

  it("skips a blocked nearer goal and reaches a farther reachable one", () => {
    const map = gridMap(3, 3);
    const start = { x: 0, y: 0 };
    const nearBlocked = { x: 0, y: 1 }; // distance 1, but blocked
    const far = { x: 2, y: 2 }; // distance 4, reachable
    const isBlocked = (p: Pos): boolean => p.x === 0 && p.y === 1;
    const path = bfsToNearest(map, start, [nearBlocked, far], { isBlocked });
    expect(path).not.toBeNull();
    if (path === null) return;
    expect(path[path.length - 1]).toEqual(far);
    expect(path).not.toContainEqual(nearBlocked);
  });
});
