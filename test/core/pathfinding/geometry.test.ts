import { describe, expect, it } from "vitest";
import {
  directionTo,
  manhattan,
  posKey,
  samePos,
} from "../../../src/core/pathfinding/index.js";

describe("manhattan", () => {
  it("computes L1 distance", () => {
    expect(manhattan({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(7);
    expect(manhattan({ x: 5, y: 1 }, { x: 1, y: 1 })).toBe(4);
  });

  it("is zero for the same tile", () => {
    expect(manhattan({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
  });
});

describe("samePos", () => {
  it("is true only for identical tiles", () => {
    expect(samePos({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
    expect(samePos({ x: 1, y: 2 }, { x: 2, y: 1 })).toBe(false);
  });
});

describe("directionTo (up=y+1, down=y-1)", () => {
  const from = { x: 3, y: 3 };

  it("maps each orthogonal neighbour to its direction", () => {
    expect(directionTo(from, { x: 4, y: 3 })).toBe("right");
    expect(directionTo(from, { x: 2, y: 3 })).toBe("left");
    expect(directionTo(from, { x: 3, y: 4 })).toBe("up");
    expect(directionTo(from, { x: 3, y: 2 })).toBe("down");
  });

  it("returns undefined for the same tile, diagonals, and non-adjacent tiles", () => {
    expect(directionTo(from, { x: 3, y: 3 })).toBeUndefined();
    expect(directionTo(from, { x: 4, y: 4 })).toBeUndefined();
    expect(directionTo(from, { x: 5, y: 3 })).toBeUndefined();
  });
});

describe("posKey", () => {
  it("distinguishes x from y and is stable", () => {
    expect(posKey(1, 2)).not.toBe(posKey(2, 1));
    expect(posKey(3, 5)).toBe(posKey(3, 5));
    expect(posKey(0, 0)).toBe(0);
  });
});
