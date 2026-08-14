/**
 * Shared test doubles for plan-level tests. `stubPlanContext` supplies an inert
 * default for every `PlanContext` member so each test overrides only what it
 * actually exercises — adding a member to the interface then stays a one-line
 * change here instead of an edit in every plan test (and no test needs an
 * `as unknown as PlanContext` cast, which used to hide missing members).
 */

import type { PlanContext } from "../../src/bdi/plans/index.js";
import {
  buildGameMap,
  type GameMap,
  type Pos,
} from "../../src/core/beliefs/index.js";
import type { Direction, IOTile } from "../../src/core/sdk/index.js";

/** A fully-walkable `w × h` grid. */
export function gridMap(w: number, h: number): GameMap {
  const tiles: IOTile[] = [];
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) tiles.push({ x, y, type: "3" });
  }
  return buildGameMap(w, h, tiles);
}

/** Apply a direction to a position (up = y+1, per CLAUDE.md §6). */
export function applyDir(p: Pos, dir: Direction): Pos {
  switch (dir) {
    case "up":
      return { x: p.x, y: p.y + 1 };
    case "down":
      return { x: p.x, y: p.y - 1 };
    case "left":
      return { x: p.x - 1, y: p.y };
    case "right":
      return { x: p.x + 1, y: p.y };
  }
}

export function stubPlanContext(
  overrides: Partial<PlanContext> = {},
): PlanContext {
  return {
    map: gridMap(1, 1),
    moveDurationMs: 10,
    parcelDecayMs: Number.POSITIVE_INFINITY,
    now: () => 0,
    wait: async () => {},
    myPosition: () => ({ x: 0, y: 0 }),
    myExactPosition: () => ({ x: 0, y: 0 }),
    isBlocked: () => false,
    emitMove: async () => false,
    pickUpHere: async () => [],
    putDownAll: async () => [],
    carriedParcelIds: () => [],
    freeParcels: () => [],
    carriedParcels: () => [],
    isParcelFree: () => true,
    ...overrides,
  };
}
