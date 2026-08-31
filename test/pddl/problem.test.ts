import { describe, expect, test } from "vitest";
import { type Distance, positionOf, problem } from "../../src/pddl/problem.js";
import { parcelOf } from "../world.js";

const manhattan: Distance = (from, to) =>
  Math.abs(from.x - to.x) + Math.abs(from.y - to.y);

describe("the PDDL problem", () => {
  test("writes one tile per location and one goal per parcel", () => {
    expect(
      problem({ x: 0, y: 0 }, [parcelOf("p0", 2)], [{ x: 0, y: 0 }], manhattan),
    ).toBe(
      [
        "(define (problem tour)",
        "  (:domain deliveroo-tour)",
        "  (:objects",
        "    t0-0 t2-0 - location",
        "    p0 - parcel",
        "  )",
        "  (:init",
        "    (at t0-0)",
        "    (= (total-cost) 0)",
        "    (delivery t0-0)",
        "    (parcel-at p0 t2-0)",
        "    (reachable t0-0 t2-0)",
        "    (= (dist t0-0 t2-0) 2)",
        "    (reachable t2-0 t0-0)",
        "    (= (dist t2-0 t0-0) 2)",
        "  )",
        "  (:goal (and (delivered p0)))",
        "  (:metric minimize (total-cost)))",
        "",
      ].join("\n"),
    );
  });

  test("keeps the two directions of a pair apart", () => {
    const uphill: Distance = (from, to) => (from.x < to.x ? 1 : 9);
    const text = problem({ x: 0, y: 0 }, [parcelOf("p0", 1)], [], uphill);
    expect(text).toContain("(= (dist t0-0 t1-0) 1)");
    expect(text).toContain("(= (dist t1-0 t0-0) 9)");
  });

  test("leaves out a pair with no route between it", () => {
    const walled: Distance = (from, to) =>
      from.x < to.x ? Infinity : manhattan(from, to);
    const text = problem(
      { x: 0, y: 0 },
      [parcelOf("p0", 1)],
      [{ x: 0, y: 0 }],
      walled,
    );
    expect(text).not.toContain("(reachable t0-0 t1-0)");
    expect(text).not.toContain("(dist t0-0 t1-0)");
    expect(text).toContain("(reachable t1-0 t0-0)");
  });

  test("names a tile once however many things stand on it", () => {
    const text = problem(
      { x: 1, y: 1 },
      [parcelOf("p0", 1, 1), parcelOf("p1", 1, 1)],
      [{ x: 1, y: 1 }],
      manhattan,
    );
    expect(text).toContain("    t1-1 - location\n");
    expect(text).toContain("    p0 p1 - parcel\n");
    expect(text).toContain("(parcel-at p1 t1-1)");
  });

  test("carries a parcel that is already in hand", () => {
    const text = problem(
      { x: 1, y: 0 },
      [{ ...parcelOf("p0", 1), carriedBy: "me" }, parcelOf("p1", 3)],
      [{ x: 0, y: 0 }],
      manhattan,
    );
    expect(text).toContain("(carrying p0)");
    expect(text).not.toContain("(parcel-at p0");
    expect(text).toContain("(parcel-at p1 t3-0)");
    expect(text).toContain("(delivered p0)");
  });

  test("reads a tile name back as the tile it came from", () => {
    expect(positionOf("t3-7")).toEqual({ x: 3, y: 7 });
    expect(positionOf("p12")).toBeUndefined();
  });

  test("rounds a carrier's fractional coordinates onto its tile", () => {
    const text = problem({ x: 3.4, y: 2 }, [parcelOf("p0", 5)], [], manhattan);
    expect(text).toContain("(at t3-2)");
  });
});
