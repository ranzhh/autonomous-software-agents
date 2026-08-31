import { describe, expect, test } from "vitest";
import { grid } from "../src/grid.js";
import { tilesOf } from "./world.js";

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

  test("one field serves a target set however it is ordered", () => {
    const g = grid(tilesOf(["23332"]));
    const a = { x: 0, y: 0 };
    const b = { x: 4, y: 0 };

    expect(g.route(a, b)).toBe(g.route(b, a));
  });

  test("keeps the field it is still being asked for", () => {
    const g = grid(tilesOf([`2${"3".repeat(299)}`]));
    const kept = g.route({ x: 1, y: 0 });

    for (let x = 2; x < 300; x++) {
      g.route({ x, y: 0 });
      g.route({ x: 1, y: 0 });
    }

    expect(g.route({ x: 1, y: 0 })).toBe(kept);
  });

  test("drops the field it has stopped being asked for", () => {
    const g = grid(tilesOf([`2${"3".repeat(299)}`]));
    const dropped = g.route({ x: 1, y: 0 });

    for (let x = 2; x < 300; x++) g.route({ x, y: 0 });

    expect(g.route({ x: 1, y: 0 })).not.toBe(dropped);
  });

  test("targets it cannot stand on leave nowhere to go", () => {
    const g = grid(tilesOf(["23332"]));

    for (const nowhere of [g.route(), g.route({ x: 9, y: 9 })]) {
      expect(nowhere.distance({ x: 1, y: 0 })).toBe(Infinity);
      expect(nowhere.step({ x: 1, y: 0 })).toBeUndefined();
    }
  });
});

describe("the board", () => {
  const g = grid(tilesOf(["103", "320"]));

  test("offers only the steps the server allows", () => {
    expect(g.exits({ x: 0, y: 0 })).toEqual([
      ["up", { x: 0, y: 1 }],
      ["right", { x: 1, y: 0 }],
    ]);
    expect(g.exits({ x: 1, y: 1 })).toEqual([]);
    expect(g.exits({ x: 9, y: 9 })).toEqual([]);
  });

  test("will not step into an arrow against itself", () => {
    const arrows = grid(tilesOf(["3→3"]));

    expect(arrows.exits({ x: 0, y: 0 })).toEqual([["right", { x: 1, y: 0 }]]);
    expect(arrows.exits({ x: 2, y: 0 })).toEqual([]);

    const back = grid(tilesOf(["3←3"]));

    expect(back.exits({ x: 2, y: 0 })).toEqual([["left", { x: 1, y: 0 }]]);
    expect(back.exits({ x: 0, y: 0 })).toEqual([]);
  });

  test("will not step into a vertical arrow against itself", () => {
    // `↑` at (0,1): reachable from below, refused from above.
    const up = grid(tilesOf(["3", "↑", "3"]));

    expect(up.exits({ x: 0, y: 0 })).toEqual([["up", { x: 0, y: 1 }]]);
    expect(up.exits({ x: 0, y: 2 })).toEqual([]);

    const down = grid(tilesOf(["3", "↓", "3"]));

    expect(down.exits({ x: 0, y: 2 })).toEqual([["down", { x: 0, y: 1 }]]);
    expect(down.exits({ x: 0, y: 0 })).toEqual([]);
  });

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
