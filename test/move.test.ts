import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { type Beliefs, believe } from "../src/beliefs.js";
import { type Grid, grid } from "../src/grid.js";
import { type Mover, mover } from "../src/move.js";
import type { Connection, Direction, Position } from "../src/sdk.js";
import { config, me, tilesOf } from "./world.js";

function harness(
  rows: string[],
  at: Position,
  answers: (Position | false | undefined)[],
): { move: Mover; asked: Direction[]; beliefs: Beliefs; board: Grid } {
  const tiles = tilesOf(rows);
  const board = grid(tiles);
  const beliefs = believe({ me: me(at.x, at.y), tiles, config });
  const asked: Direction[] = [];
  let self = me(at.x, at.y);
  const game = {
    me: () => self,
    move: async (direction: Direction) => {
      asked.push(direction);
      const landed = answers.shift();
      if (landed) self = me(landed.x, landed.y);
      return landed;
    },
  } as Connection;
  return { move: mover(game, beliefs, () => board, 0), asked, beliefs, board };
}

describe("moving", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("a lost ack is a step taken; only a refusal is a refusal", async () => {
    const { move, asked } = harness(["333"], { x: 1, y: 0 }, [
      undefined,
      undefined,
    ]);

    expect(await move.step("right")).toBe(true);
    // Nothing was blacked out, so the server is asked a second time.
    expect(await move.step("right")).toBe(true);
    expect(asked).toEqual(["right", "right"]);
  });

  test("takes the server's word for where it now stands", async () => {
    const { move, beliefs } = harness(["333"], { x: 0, y: 0 }, [
      { x: 1, y: 0 },
    ]);

    expect(await move.step("right")).toBe(true);
    expect(beliefs.me()).toMatchObject({ x: 1, y: 0 });
  });

  test("a refused tile is blacked out until the memo lapses", async () => {
    const { move, asked } = harness(["333"], { x: 1, y: 0 }, [
      false,
      { x: 2, y: 0 },
    ]);

    expect(await move.step("right")).toBe(false);
    expect(await move.step("right")).toBe(false);
    expect(asked).toEqual(["right"]);

    vi.advanceTimersByTime(3_001);
    expect(await move.step("right")).toBe(true);
    expect(asked).toEqual(["right", "right"]);
  });

  test("does not ask the server for a tile somebody is standing on", async () => {
    const { move, asked, beliefs } = harness(["333"], { x: 1, y: 0 }, [
      { x: 2, y: 0 },
    ]);
    beliefs.seen({
      positions: [{ x: 2, y: 0 }],
      agents: [{ ...me(2, 0), id: "them" }],
      parcels: [],
      crates: [],
    });

    expect(await move.step("right")).toBe(false);
    expect(move.open({ x: 1, y: 0 })).toEqual([["left", { x: 0, y: 0 }]]);
    expect(asked).toEqual([]);

    beliefs.seen({
      positions: [{ x: 2, y: 0 }],
      agents: [],
      parcels: [],
      crates: [],
    });
    expect(await move.step("right")).toBe(true);
    expect(asked).toEqual(["right"]);
  });

  test("a refusal lapses early once the tile is seen with nobody on it", async () => {
    const { move, asked, beliefs } = harness(["333"], { x: 1, y: 0 }, [
      false,
      { x: 2, y: 0 },
    ]);

    expect(await move.step("right")).toBe(false);
    expect(await move.step("right")).toBe(false);
    vi.advanceTimersByTime(1);
    beliefs.seen({
      positions: [{ x: 2, y: 0 }],
      agents: [],
      parcels: [],
      crates: [],
    });
    expect(await move.step("right")).toBe(true);
    expect(asked).toEqual(["right", "right"]);
  });

  test("what is open leaves out arrows and whatever just refused", async () => {
    const { move } = harness(["333", "3→3"], { x: 0, y: 0 }, [false]);

    expect(move.open({ x: 2, y: 0 })).toEqual([["up", { x: 2, y: 1 }]]);
    expect(await move.step("up")).toBe(false);
    expect(move.open({ x: 0, y: 0 })).toEqual([["right", { x: 1, y: 0 }]]);
  });

  test("sidesteps to a tile no further from the route", async () => {
    const { move, asked, board } = harness(["333", "233"], { x: 1, y: 1 }, [
      { x: 1, y: 0 },
    ]);

    expect(await move.sidestep("left", board.route({ x: 0, y: 0 }))).toBe(true);
    expect(asked).toEqual(["down"]);
  });

  test("waits rather than step backwards out of a corridor", async () => {
    const { move, asked, board } = harness(["23333"], { x: 2, y: 0 }, []);

    expect(await move.sidestep("left", board.route({ x: 0, y: 0 }))).toBe(
      false,
    );
    expect(asked).toEqual([]);
  });

  test("gives way by the one step there is, backwards though it is", async () => {
    const { move, asked, board } = harness(["23333"], { x: 2, y: 0 }, [
      { x: 3, y: 0 },
    ]);

    expect(await move.sidestep("left", board.route({ x: 0, y: 0 }), true)).toBe(
      true,
    );
    expect(asked).toEqual(["right"]);
  });
});
