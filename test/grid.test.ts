import { describe, expect, test } from "vitest";
import { grid } from "../src/grid.js";
import { tilesOf } from "./tiles.js";

describe("route", () => {
  test("walls split the map", () => {
    const g = grid(tilesOf(["303", "303", "203"]));
    const home = g.route(...g.deliveries);

    expect(home.distance({ x: 0, y: 2 })).toBe(2);
    expect(home.step({ x: 0, y: 2 })).toBe("down");
    expect(home.distance({ x: 2, y: 0 })).toBe(Infinity);
    expect(home.step({ x: 2, y: 0 })).toBeUndefined();
  });

  test("an arrow refuses the step against it, and no other", () => {
    // `→` at (1,0), with its only perpendicular neighbour above it.
    const g = grid(tilesOf(["030", "3→3"]));

    expect(g.route({ x: 2, y: 0 }).distance({ x: 0, y: 0 })).toBe(2);
    expect(g.route({ x: 0, y: 0 }).distance({ x: 2, y: 0 })).toBe(Infinity);
    // Leaving an arrow sideways is not the tile's business, only entering it.
    expect(g.route({ x: 1, y: 1 }).distance({ x: 0, y: 0 })).toBe(2);
    expect(g.route({ x: 1, y: 1 }).step({ x: 1, y: 0 })).toBe("up");
  });

  test("routes to the nearest of many targets", () => {
    const g = grid(tilesOf(["23332"]));
    const home = g.route(...g.deliveries);

    expect(home.distance({ x: 1, y: 0 })).toBe(1);
    expect(home.step({ x: 1, y: 0 })).toBe("left");
    expect(home.step({ x: 3, y: 0 })).toBe("right");
    expect(home.step({ x: 0, y: 0 })).toBeUndefined();
  });
});

describe("the board", () => {
  const g = grid(tilesOf(["103", "320"]));

  test("knows what is walkable", () => {
    expect(g.walkable({ x: 0, y: 0 })).toBe(true);
    expect(g.walkable({ x: 2, y: 0 })).toBe(false);
    expect(g.walkable({ x: 9, y: 9 })).toBe(false);
  });

  test("lists deliveries and spawners", () => {
    expect(g.deliveries).toEqual([{ x: 1, y: 0 }]);
    expect(g.spawners).toEqual([{ x: 0, y: 1 }]);
  });
});
