import { describe, expect, it } from "vitest";
import type { Intention } from "../../../src/bdi/intentions/index.js";
import type { PlanContext } from "../../../src/bdi/plans/index.js";
import { GoPickUp } from "../../../src/bdi/plans/index.js";
import {
  buildGameMap,
  type GameMap,
  type Pos,
} from "../../../src/core/beliefs/index.js";
import type { Direction, IOTile } from "../../../src/core/sdk/index.js";
import { PlanFailedError } from "../../../src/core/util/index.js";

function gridMap(w: number, h: number): GameMap {
  const tiles: IOTile[] = [];
  for (let x = 0; x < w; x++)
    for (let y = 0; y < h; y++) tiles.push({ x, y, type: "3" });
  return buildGameMap(w, h, tiles);
}

function applyDir(p: Pos, dir: Direction): Pos {
  switch (dir) {
    case "up":
      return { x: p.x, y: p.y + 1 };
    case "down":
      return { x: p.x, y: p.y - 1 };
    case "left":
      return { x: p.x - 1, y: p.y };
    case "right":
      return { x: p.x + 1, y: p.y };
  }
}

interface CtxOptions {
  start: Pos;
  parcelId?: string;
  parcelFree?: boolean;
  pickupResult?: { id: string }[];
}

function makeCtx(
  map: GameMap,
  opts: CtxOptions,
): PlanContext & { pickups: number } {
  let pos = opts.start;
  let pickups = 0;

  const ctx = {
    map,
    moveDurationMs: 10,
    myPosition: () => pos,
    isBlocked: () => false,
    emitMove: async (dir: Direction) => {
      pos = applyDir(pos, dir);
      return pos;
    },
    emitPickup: async () => {
      pickups++;
      return opts.pickupResult ?? [];
    },
    emitPutdown: async () => [],
    wait: async () => {},
    carriedParcelIds: () => [],
    isParcelFree: (_id: string) => opts.parcelFree ?? true,
    get pickups() {
      return pickups;
    },
  };

  return ctx as unknown as PlanContext & { pickups: number };
}

const pickupIntent = (id: string, target: Pos): Intention => ({
  kind: "pickup",
  parcelId: id,
  target,
});

describe("GoPickUp — phantom guard", () => {
  it("throws PlanFailedError immediately when parcel is already taken", async () => {
    const map = gridMap(3, 1);
    const ctx = makeCtx(map, { start: { x: 0, y: 0 }, parcelFree: false });
    const plan = new GoPickUp(ctx);
    await expect(
      plan.execute(pickupIntent("p1", { x: 2, y: 0 })),
    ).rejects.toBeInstanceOf(PlanFailedError);
    // Should not have moved at all
    expect(ctx.myPosition()).toEqual({ x: 0, y: 0 });
  });
});

describe("GoPickUp — success path", () => {
  it("navigates to the parcel tile and calls emitPickup", async () => {
    const map = gridMap(3, 1);
    const ctx = makeCtx(map, {
      start: { x: 0, y: 0 },
      parcelFree: true,
      pickupResult: [{ id: "p1" }],
    });
    const plan = new GoPickUp(ctx);
    await plan.execute(pickupIntent("p1", { x: 2, y: 0 }));
    expect(ctx.myPosition()).toEqual({ x: 2, y: 0 });
    expect(ctx.pickups).toBe(1);
  });
});

describe("GoPickUp — applicability", () => {
  it("is applicable when kind = pickup and target in bounds", () => {
    const map = gridMap(3, 3);
    const ctx = makeCtx(map, { start: { x: 0, y: 0 } });
    const plan = new GoPickUp(ctx);
    expect(plan.isApplicableTo(pickupIntent("p1", { x: 1, y: 1 }))).toBe(true);
    expect(plan.isApplicableTo(pickupIntent("p1", { x: 9, y: 9 }))).toBe(false);
    expect(
      plan.isApplicableTo({ kind: "deliver", target: { x: 1, y: 1 } }),
    ).toBe(false);
  });
});

describe("GoPickUp — reuse after stop", () => {
  it("executes normally when called after a prior stop() (instance reuse in PlanLibrary)", async () => {
    const map = gridMap(3, 1);
    const ctx = makeCtx(map, {
      start: { x: 0, y: 0 },
      parcelFree: true,
      pickupResult: [{ id: "p1" }],
    });
    const plan = new GoPickUp(ctx);
    // Simulate a prior stop (as happens when the PlanLibrary singleton is
    // preempted and then re-selected for a new intention).
    plan.stop();
    // execute() must reset abort state — plan should proceed normally.
    await plan.execute(pickupIntent("p1", { x: 2, y: 0 }));
    expect(ctx.myPosition()).toEqual({ x: 2, y: 0 });
    expect(ctx.pickups).toBe(1);
  });
});
