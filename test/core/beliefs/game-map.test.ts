import { describe, expect, it } from "vitest";
import { buildGameMap } from "../../../src/core/beliefs/index.js";
import type { IOTile } from "../../../src/core/sdk/index.js";

// 3×2 grid used by most tests:
//   (0,1)=spawner  (1,1)=walkable  (2,1)=wall
//   (0,0)=wall     (1,0)=walkable  (2,0)=delivery
const SIMPLE_TILES: IOTile[] = [
  // 3×2 grid
  { x: 0, y: 0, type: "0" }, // wall
  { x: 1, y: 0, type: "3" }, // walkable
  { x: 2, y: 0, type: "2" }, // delivery
  { x: 0, y: 1, type: "1" }, // spawner
  { x: 1, y: 1, type: "3" }, // walkable
  { x: 2, y: 1, type: "0" }, // wall
];

describe("buildGameMap — bounds", () => {
  it("derives width and height from the tiles array, not from reported w/h", () => {
    // Simulate the 49×39 vs 2000-tiles discrepancy: report width=49 height=39
    // but tiles cover x=0..49, y=0..39 → actual 50×40
    const tiles: IOTile[] = [
      { x: 0, y: 0, type: "3" },
      { x: 49, y: 39, type: "3" },
    ];
    const map = buildGameMap(49, 39, tiles);
    expect(map.width).toBe(50);
    expect(map.height).toBe(40);
  });

  it("handles a single-tile map", () => {
    const map = buildGameMap(1, 1, [{ x: 0, y: 0, type: "3" }]);
    expect(map.width).toBe(1);
    expect(map.height).toBe(1);
  });
});

describe("buildGameMap — inBounds", () => {
  it("accepts tile coords", () => {
    const map = buildGameMap(3, 2, SIMPLE_TILES);
    expect(map.inBounds({ x: 0, y: 0 })).toBe(true);
    expect(map.inBounds({ x: 2, y: 1 })).toBe(true);
  });

  it("rejects coords outside the grid", () => {
    const map = buildGameMap(3, 2, SIMPLE_TILES);
    expect(map.inBounds({ x: -1, y: 0 })).toBe(false);
    expect(map.inBounds({ x: 3, y: 0 })).toBe(false);
    expect(map.inBounds({ x: 0, y: 2 })).toBe(false);
  });
});

describe("buildGameMap — walkability", () => {
  it("marks types 1/2/3/4 as walkable", () => {
    const tiles: IOTile[] = [
      { x: 0, y: 0, type: "1" },
      { x: 1, y: 0, type: "2" },
      { x: 2, y: 0, type: "3" },
      { x: 3, y: 0, type: "4" },
    ];
    const map = buildGameMap(4, 1, tiles);
    expect(map.isWalkable({ x: 0, y: 0 })).toBe(true);
    expect(map.isWalkable({ x: 1, y: 0 })).toBe(true);
    expect(map.isWalkable({ x: 2, y: 0 })).toBe(true);
    expect(map.isWalkable({ x: 3, y: 0 })).toBe(true);
  });

  it("marks type 0 (wall) as non-walkable", () => {
    const map = buildGameMap(3, 2, SIMPLE_TILES);
    expect(map.isWalkable({ x: 0, y: 0 })).toBe(false);
  });

  it("marks unknown/crate/arrow types as non-walkable (defensive)", () => {
    const tiles: IOTile[] = [
      { x: 0, y: 0, type: "5" },
      { x: 1, y: 0, type: "5!" },
      { x: 2, y: 0, type: "←" },
    ];
    const map = buildGameMap(3, 1, tiles);
    expect(map.isWalkable({ x: 0, y: 0 })).toBe(false);
    expect(map.isWalkable({ x: 1, y: 0 })).toBe(false);
    expect(map.isWalkable({ x: 2, y: 0 })).toBe(false);
  });

  it("returns false for an out-of-bounds position", () => {
    const map = buildGameMap(3, 2, SIMPLE_TILES);
    expect(map.isWalkable({ x: 99, y: 99 })).toBe(false);
  });
});

describe("buildGameMap — delivery and spawner", () => {
  it("identifies delivery tiles correctly", () => {
    const map = buildGameMap(3, 2, SIMPLE_TILES);
    expect(map.isDelivery({ x: 2, y: 0 })).toBe(true);
    expect(map.isDelivery({ x: 1, y: 0 })).toBe(false);
  });

  it("identifies spawner tiles correctly", () => {
    const map = buildGameMap(3, 2, SIMPLE_TILES);
    expect(map.isSpawner({ x: 0, y: 1 })).toBe(true);
    expect(map.isSpawner({ x: 1, y: 0 })).toBe(false);
  });

  it("populates deliveryTiles and spawnerTiles sets", () => {
    const map = buildGameMap(3, 2, SIMPLE_TILES);
    expect(map.deliveryTiles).toHaveLength(1);
    expect(map.deliveryTiles[0]).toEqual({ x: 2, y: 0 });
    expect(map.spawnerTiles).toHaveLength(1);
    expect(map.spawnerTiles[0]).toEqual({ x: 0, y: 1 });
  });
});

describe("buildGameMap — neighbours (up=y+1, down=y-1)", () => {
  // 5-tile plus shape: centre at (1,1), arms N/S/E/W all walkable
  const PLUS_TILES: IOTile[] = [
    { x: 1, y: 2, type: "3" }, // north (up, y+1)
    { x: 0, y: 1, type: "3" }, // west
    { x: 1, y: 1, type: "3" }, // centre
    { x: 2, y: 1, type: "3" }, // east
    { x: 1, y: 0, type: "3" }, // south (down, y-1)
  ];

  it("returns all 4 walkable neighbours for the centre", () => {
    const map = buildGameMap(3, 3, PLUS_TILES);
    const ns = map.neighbours({ x: 1, y: 1 });
    expect(ns).toHaveLength(4);
    expect(ns).toContainEqual({ x: 1, y: 2 }); // up
    expect(ns).toContainEqual({ x: 1, y: 0 }); // down
    expect(ns).toContainEqual({ x: 0, y: 1 }); // left
    expect(ns).toContainEqual({ x: 2, y: 1 }); // right
  });

  it("excludes wall neighbours", () => {
    const map = buildGameMap(3, 2, SIMPLE_TILES);
    // (1,0) is walkable; left=(0,0) is wall; right=(2,0) is delivery(walkable); up=(1,1) walkable; down=OOB
    const ns = map.neighbours({ x: 1, y: 0 });
    const keys = ns.map((p) => `${p.x},${p.y}`).sort();
    expect(keys).toEqual(["1,1", "2,0"].sort());
  });

  it("excludes out-of-bounds neighbours", () => {
    const map = buildGameMap(3, 3, PLUS_TILES);
    // corner tile (1,0): south (y=-1) is OOB
    const ns = map.neighbours({ x: 1, y: 0 });
    expect(ns.every((p) => p.y >= 0)).toBe(true);
  });

  it("returns empty when all four neighbours are walls", () => {
    // 3×3 grid: centre (1,1) surrounded entirely by walls
    const walls: IOTile[] = [
      { x: 0, y: 0, type: "0" },
      { x: 1, y: 0, type: "0" },
      { x: 2, y: 0, type: "0" },
      { x: 0, y: 1, type: "0" },
      { x: 1, y: 1, type: "0" },
      { x: 2, y: 1, type: "0" },
      { x: 0, y: 2, type: "0" },
      { x: 1, y: 2, type: "0" },
      { x: 2, y: 2, type: "0" },
    ];
    const map = buildGameMap(3, 3, walls);
    expect(map.neighbours({ x: 1, y: 1 })).toHaveLength(0);
  });
});

describe("buildGameMap — tileAt", () => {
  it("returns the tile type for a known position", () => {
    const map = buildGameMap(3, 2, SIMPLE_TILES);
    expect(map.tileAt({ x: 0, y: 0 })).toBe("0");
    expect(map.tileAt({ x: 2, y: 0 })).toBe("2");
  });

  it("returns undefined for an unknown position", () => {
    const map = buildGameMap(3, 2, SIMPLE_TILES);
    expect(map.tileAt({ x: 99, y: 99 })).toBeUndefined();
  });
});
