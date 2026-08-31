import { describe, expect, test } from "vitest";
import { grid } from "../src/grid.js";
import { nearest } from "../src/tour.js";
import { parcelOf, tilesOf } from "./world.js";

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
