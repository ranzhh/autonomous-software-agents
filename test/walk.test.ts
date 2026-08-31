import { describe, expect, test } from "vitest";
import { grid } from "../src/grid.js";
import { MOVES } from "../src/position.js";
import type { Direction, Position } from "../src/sdk.js";
import { type Mover, walker } from "../src/walk.js";
import { tilesOf } from "./world.js";

function fake(
  start: Position,
  refuses: (to: Position) => boolean = () => false,
) {
  let at = { ...start };
  const tried: Direction[] = [];
  let paced = 0;
  const mover: Mover = {
    here: () => at,
    move: async (direction) => {
      tried.push(direction);
      const to = {
        x: at.x + MOVES[direction].dx,
        y: at.y + MOVES[direction].dy,
      };
      if (refuses(to)) return false;
      at = to;
      return to;
    },
    pace: async () => {
      paced += 1;
    },
  };
  return { mover, tried, here: () => at, paced: () => paced };
}

describe("walking", () => {
  test("walks the route to the target", async () => {
    const board = grid(tilesOf(["3333"]));
    const { mover, tried, here } = fake({ x: 0, y: 0 });
    const { walk } = walker(mover, () => 1_000_000);

    expect(await walk({ x: 3, y: 0 }, board)).toBe(true);
    expect(here()).toEqual({ x: 3, y: 0 });
    expect(tried).toEqual(["right", "right", "right"]);
  });

  test("gives up on an unreachable target without moving", async () => {
    const board = grid(tilesOf(["3303"]));
    const { mover, tried } = fake({ x: 0, y: 0 });
    const { walk } = walker(mover, () => 1_000_000);

    expect(await walk({ x: 3, y: 0 }, board)).toBe(false);
    expect(tried).toEqual([]);
  });

  test("sidesteps a refusal toward the target, not backward", async () => {
    const board = grid(tilesOf(["333", "333"]));
    const { mover, tried, here } = fake(
      { x: 1, y: 0 },
      (to) => to.x === 1 && to.y === 1,
    );
    const { walk } = walker(mover, () => 1_000_000);

    expect(await walk({ x: 2, y: 1 }, board)).toBe(true);
    expect(tried).toEqual(["up", "right", "up"]);
    expect(here()).toEqual({ x: 2, y: 1 });
  });

  test("gives up a blocked walk after one ask of the refusing tile", async () => {
    const board = grid(tilesOf(["333"]));
    const { mover, tried } = fake({ x: 0, y: 0 }, (to) => to.x === 1);
    const { walk } = walker(mover, () => 1_000_000);

    expect(await walk({ x: 2, y: 0 }, board)).toBe(false);
    expect(await walk({ x: 2, y: 0 }, board)).toBe(false);
    expect(tried).toEqual(["right"]);
  });

  test("asks a refused tile again once the block expires", async () => {
    const board = grid(tilesOf(["333"]));
    let obstacle = true;
    let clock = 1_000_000;
    const { mover, tried, here } = fake(
      { x: 0, y: 0 },
      (to) => obstacle && to.x === 1,
    );
    const { walk } = walker(mover, () => clock);

    expect(await walk({ x: 2, y: 0 }, board)).toBe(false);
    obstacle = false;
    expect(await walk({ x: 2, y: 0 }, board)).toBe(false);
    expect(tried).toEqual(["right"]);

    clock += 3_001;
    expect(await walk({ x: 2, y: 0 }, board)).toBe(true);
    expect(here()).toEqual({ x: 2, y: 0 });
  });
});

describe("exploring", () => {
  test("walks off its own spawner toward the one unseen the longest", async () => {
    const board = grid(tilesOf(["1331"]));
    const { mover, tried, here } = fake({ x: 0, y: 0 });
    const { explore } = walker(mover, () => 1_000_000);

    await explore(board);
    await explore(board);
    await explore(board);
    expect(here()).toEqual({ x: 3, y: 0 });
    expect(tried).toEqual(["right", "right", "right"]);
  });

  test("sweeps on to the next spawner instead of oscillating", async () => {
    const board = grid(tilesOf(["131"]));
    const { mover, tried, here } = fake({ x: 1, y: 0 });
    const { explore } = walker(mover, () => 1_000_000);

    await explore(board);
    await explore(board);
    await explore(board);
    expect(tried).toEqual(["right", "left", "left"]);
    expect(here()).toEqual({ x: 0, y: 0 });
  });

  test("writes off a spawner someone blocks the way to", async () => {
    const board = grid(tilesOf(["331"]));
    const { mover, tried, paced } = fake({ x: 0, y: 0 }, (to) => to.x === 1);
    const { explore } = walker(mover, () => 1_000_000);

    await explore(board);
    await explore(board);
    expect(tried).toEqual(["right"]);
    expect(paced()).toBe(2);
  });
});
