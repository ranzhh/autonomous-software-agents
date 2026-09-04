import { describe, expect, test } from "vitest";
import { randomStream } from "../src/random.js";

const draw = (name: string, seed: string | undefined, n = 5) =>
  Array.from({ length: n }, randomStream(name, seed));

describe("randomStream", () => {
  test("repeats the same sequence for the same seed and name", () => {
    expect(draw("wander", "1")).toEqual(draw("wander", "1"));
  });

  test("differs across seeds and across names", () => {
    expect(draw("wander", "1")).not.toEqual(draw("wander", "2"));
    expect(draw("wander", "1")).not.toEqual(draw("walk", "1"));
  });

  test("falls back to Math.random without a seed", () => {
    expect(randomStream("wander", undefined)).toBe(Math.random);
  });
});
