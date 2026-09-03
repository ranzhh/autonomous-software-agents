import { describe, expect, test } from "vitest";
import { grid } from "../src/grid.js";
import { nearest, place, pricedTour, type Tour, touring } from "../src/tour.js";
import { value } from "../src/value.js";
import { config, parcelOf, tilesOf } from "./world.js";

describe("the nearest-neighbour tour", () => {
  test("has nothing to plan without parcels", async () => {
    const board = grid(tilesOf(["2333"]));
    expect(await nearest.plan({ x: 1, y: 0 }, [], board)).toBeUndefined();
  });

  test("collects a parcel and brings it to a delivery", async () => {
    const board = grid(tilesOf(["2333"]));
    expect(
      await nearest.plan({ x: 1, y: 0 }, [parcelOf("p", 3)], board),
    ).toEqual([
      { action: "pickup", at: { x: 3, y: 0 }, parcel: "p" },
      { action: "deliver", at: { x: 0, y: 0 } },
    ]);
  });

  test("delivers what is already in hand without taking it again", async () => {
    const board = grid(tilesOf(["2333"]));
    const tour = await nearest.plan(
      { x: 3, y: 0 },
      [{ ...parcelOf("p", 3), carriedBy: "me" }],
      board,
    );
    expect(tour).toEqual([{ action: "deliver", at: { x: 0, y: 0 } }]);
  });

  test("reorders around whatever is closest to the last pickup", async () => {
    const board = grid(tilesOf(["2333333333"]));
    const tour = await nearest.plan(
      { x: 5, y: 0 },
      [parcelOf("far", 1), parcelOf("near", 6), parcelOf("behind", 9)],
      board,
    );
    expect(tour?.map((stop) => stop.at.x)).toEqual([6, 9, 1, 0]);
  });

  test("delivers where the tour ends, not where it started", async () => {
    const board = grid(tilesOf(["2333332"]));
    const tour = await nearest.plan({ x: 1, y: 0 }, [parcelOf("p", 5)], board);
    expect(tour?.at(-1)).toEqual({ action: "deliver", at: { x: 6, y: 0 } });
  });

  test("leaves out a parcel it cannot reach", async () => {
    const board = grid(tilesOf(["23033"]));
    const tour = await nearest.plan(
      { x: 1, y: 0 },
      [parcelOf("here", 1), parcelOf("walled off", 4)],
      board,
    );
    expect(tour).toEqual([
      { action: "pickup", at: { x: 1, y: 0 }, parcel: "here" },
      { action: "deliver", at: { x: 0, y: 0 } },
    ]);
  });

  test("refuses a tour it cannot deliver", async () => {
    const board = grid(tilesOf(["23033"]));
    expect(
      await nearest.plan({ x: 3, y: 0 }, [parcelOf("p", 4)], board),
    ).toBeUndefined();
  });
});

const worth = value(config);

describe("pricing the tour that will be walked", () => {
  test("decays each parcel to the stop that banks it, not to the last one", () => {
    const board = grid(tilesOf(["2333233333"]));
    const banked: Tour = [
      { action: "pickup", at: { x: 3, y: 0 }, parcel: "a" },
      { action: "deliver", at: { x: 4, y: 0 } },
      { action: "pickup", at: { x: 9, y: 0 }, parcel: "b" },
      { action: "deliver", at: { x: 4, y: 0 } },
    ];
    const carried: Tour = [
      { action: "pickup", at: { x: 3, y: 0 }, parcel: "a" },
      { action: "pickup", at: { x: 9, y: 0 }, parcel: "b" },
      { action: "deliver", at: { x: 4, y: 0 } },
    ];
    const loose = [parcelOf("a", 3), parcelOf("b", 9)];
    const price = (tour: Tour): number =>
      pricedTour({ x: 0, y: 0 }, tour, [], loose, board, worth);

    // Both walks are fourteen steps; banking on the way past drops `a` ten
    // steps earlier, which is the whole difference between the two numbers.
    expect(price(banked)).toBe(26 + 16);
    expect(price(carried)).toBe(16 + 16);
  });

  test("prices what is already in hand from the first delivery", () => {
    const board = grid(tilesOf(["2333"]));
    const price = pricedTour(
      { x: 3, y: 0 },
      [{ action: "deliver", at: { x: 0, y: 0 } }],
      [{ ...parcelOf("p", 3), carriedBy: "me" }],
      [],
      board,
      worth,
    );
    expect(price).toBe(27);
  });

  test("a stop it cannot reach voids the tour, banked value included", () => {
    const board = grid(tilesOf(["23033"]));
    const price = pricedTour(
      { x: 1, y: 0 },
      [
        { action: "deliver", at: { x: 0, y: 0 } },
        { action: "pickup", at: { x: 4, y: 0 }, parcel: "p" },
        { action: "deliver", at: { x: 0, y: 0 } },
      ],
      [{ ...parcelOf("c", 1), carriedBy: "me" }],
      [parcelOf("p", 4)],
      board,
      worth,
    );
    expect(price).toBe(0);
  });
});

describe("a tour under orders", () => {
  const board = grid(tilesOf(["2333333"]));
  const worth = value(config);
  const loose = [parcelOf("p", 3)];
  const price = (walk: Tour) =>
    pricedTour({ x: 1, y: 0 }, walk, [], loose, board, worth);

  test("banks where it is told to, and counts the bonus for it", () => {
    const walk = touring({ x: 1, y: 0 }, loose, board, [{ x: 6, y: 0 }], 1000);
    expect(walk?.at(-1)).toEqual({
      action: "deliver",
      at: { x: 6, y: 0 },
      bonus: 1000,
    });
    // Two steps out, three back to the end, 30 - 5, plus the bonus.
    expect(price(walk ?? [])).toBe(1000 + 25);
  });

  test("a visit is worth its bonus wherever it falls", () => {
    const walk: Tour = [
      { action: "visit", at: { x: 4, y: 0 }, bonus: 100, together: false },
      { action: "pickup", at: { x: 3, y: 0 }, parcel: "p" },
      { action: "deliver", at: { x: 0, y: 0 } },
    ];
    // 3 steps to the visit, 1 back to the parcel, 3 home: 30 - 7.
    expect(price(walk)).toBe(100 + 23);
  });

  test("places a stop where the parcel decays least on the way", () => {
    const walk = touring({ x: 1, y: 0 }, loose, board) ?? [];
    const visit = (from: { x: number; y: number }) => ({
      action: "visit" as const,
      at: { x: 4, y: 0 },
      bonus: 100,
      together: false,
      from,
    });
    const placed = place({ x: 1, y: 0 }, walk, (from) => visit(from), price);
    // Banking first costs four extra steps afterwards, but none while the parcel is in hand.
    expect(placed.map((s) => s.action)).toEqual(["pickup", "deliver", "visit"]);
    expect(placed[2]).toMatchObject({ from: { x: 0, y: 0 } });
  });

  test("leaves a stop out when no place for it pays", () => {
    const walk = touring({ x: 1, y: 0 }, loose, board) ?? [];
    const trap = () => ({
      action: "visit" as const,
      at: { x: 6, y: 0 },
      bonus: -10,
      together: false,
    });
    expect(place({ x: 1, y: 0 }, walk, trap, price)).toBe(walk);
    expect(place({ x: 1, y: 0 }, walk, () => undefined, price)).toBe(walk);
  });
});
