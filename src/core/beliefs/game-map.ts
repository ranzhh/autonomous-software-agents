/**
 * Static world model built once from the `onMap` payload. Derives its bounds
 * from the `tiles` array (CLAUDE.md §6: `width`/`height` are max-coordinates,
 * not tile counts — live run observed 49×39 but tiles.length=2000 = 50×40).
 * Tile walkability follows §4: walkable = {1,2,3,4}; non-walkable = 0; crate
 * and arrow tiles {5, 5!, ←↑→↓} are treated as non-walkable with a one-time
 * warning (defensive rule). Coordinate convention: right x+1, left x−1,
 * up y+1, down y−1 (y is inverted vs screen, per §4).
 */

import type { IOTile, IOTileType } from "../sdk/index.js";
import { createLogger } from "../util/index.js";

export interface Pos {
  readonly x: number;
  readonly y: number;
}

export interface GameMap {
  /** Number of distinct x-coordinates derived from the tiles array. */
  readonly width: number;
  /** Number of distinct y-coordinates derived from the tiles array. */
  readonly height: number;
  inBounds(pos: Pos): boolean;
  isWalkable(pos: Pos): boolean;
  isDelivery(pos: Pos): boolean;
  isSpawner(pos: Pos): boolean;
  tileAt(pos: Pos): IOTileType | undefined;
  /** The four walkable, in-bounds neighbours of `pos` (up=y+1, down=y-1). */
  neighbours(pos: Pos): readonly Pos[];
  /** All delivery tiles on the map. */
  readonly deliveryTiles: readonly Pos[];
  /** All spawner tiles on the map. */
  readonly spawnerTiles: readonly Pos[];
}

const WALKABLE_TYPES = new Set<IOTileType>(["1", "2", "3", "4"]);
const DELIVERY_TYPE: IOTileType = "2";
const SPAWNER_TYPE: IOTileType = "1";

const DELTAS: readonly Pos[] = [
  { x: 0, y: 1 }, // up
  { x: 0, y: -1 }, // down
  { x: -1, y: 0 }, // left
  { x: 1, y: 0 }, // right
];

const log = createLogger({ scope: "game-map" });

function posKey(x: number, y: number): number {
  return x * 100_000 + y;
}

/**
 * Build a `GameMap` from the raw `onMap` payload. Derives bounds from the
 * tile array (max x+1, max y+1) rather than the reported width/height.
 */
export function buildGameMap(
  _width: number,
  _height: number,
  tiles: readonly IOTile[],
): GameMap {
  let maxX = 0;
  let maxY = 0;
  const tileMap = new Map<number, IOTileType>();
  const warnedTypes = new Set<string>();

  for (const tile of tiles) {
    if (tile.x > maxX) maxX = tile.x;
    if (tile.y > maxY) maxY = tile.y;

    const type = tile.type;
    if (!WALKABLE_TYPES.has(type) && type !== "0" && !warnedTypes.has(type)) {
      warnedTypes.add(type);
      log.warn(
        `unknown/crate/arrow tile type "${type}" treated as non-walkable`,
        {
          x: tile.x,
          y: tile.y,
        },
      );
    }

    tileMap.set(posKey(tile.x, tile.y), type);
  }

  const width = maxX + 1;
  const height = maxY + 1;

  const deliveryTiles: Pos[] = [];
  const spawnerTiles: Pos[] = [];

  for (const tile of tiles) {
    if (tile.type === DELIVERY_TYPE)
      deliveryTiles.push({ x: tile.x, y: tile.y });
    if (tile.type === SPAWNER_TYPE) spawnerTiles.push({ x: tile.x, y: tile.y });
  }

  function inBounds(pos: Pos): boolean {
    return pos.x >= 0 && pos.x < width && pos.y >= 0 && pos.y < height;
  }

  function tileAt(pos: Pos): IOTileType | undefined {
    return tileMap.get(posKey(pos.x, pos.y));
  }

  function isWalkable(pos: Pos): boolean {
    const type = tileAt(pos);
    return type !== undefined && WALKABLE_TYPES.has(type);
  }

  function isDelivery(pos: Pos): boolean {
    return tileAt(pos) === DELIVERY_TYPE;
  }

  function isSpawner(pos: Pos): boolean {
    return tileAt(pos) === SPAWNER_TYPE;
  }

  function neighbours(pos: Pos): readonly Pos[] {
    const result: Pos[] = [];
    for (const d of DELTAS) {
      const n = { x: pos.x + d.x, y: pos.y + d.y };
      if (inBounds(n) && isWalkable(n)) result.push(n);
    }
    return result;
  }

  return {
    width,
    height,
    inBounds,
    isWalkable,
    isDelivery,
    isSpawner,
    tileAt,
    neighbours,
    deliveryTiles,
    spawnerTiles,
  };
}
