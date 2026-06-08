import { describe, expect, it } from "vitest";
import type { Intention } from "../../../src/bdi/intentions/index.js";
import type { PlanContext } from "../../../src/bdi/plans/index.js";
import { Deliver } from "../../../src/bdi/plans/index.js";
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

function makeCtx(
  map: GameMap,
  start: Pos,
  carried: string[],
): PlanContext & { putdowns: number } {
  let pos = start;
  let putdowns = 0;

  const ctx = {
    map,
    moveDurationMs: 10,
    myPosition: () => pos,
    isBlocked: () => false,
    emitMove: async (dir: Direction) => {
      pos = applyDir(pos, dir);
      return pos;
    },
    emitPickup: async () => [],
    emitPutdown: async () => {
      putdowns++;
      return [];
    },
    wait: async () => {},
    carriedParcelIds: () => carried,
    isParcelFree: () => false,
    get putdowns() {
      return putdowns;
    },
  };

  return ctx as unknown as PlanContext & { putdowns: number };
}

const deliverIntent = (target: Pos): Intention => ({ kind: "deliver", target });

describe("Deliver — applicability", () => {
  it("is applicable when carrying parcels and target in bounds", () => {
    const map = gridMap(3, 3);
    const ctx = makeCtx(map, { x: 0, y: 0 }, ["c1"]);
    const plan = new Deliver(ctx);
    expect(plan.isApplicableTo(deliverIntent({ x: 2, y: 2 }))).toBe(true);
  });

  it("is NOT applicable when carrying nothing", () => {
    const map = gridMap(3, 3);
    const ctx = makeCtx(map, { x: 0, y: 0 }, []);
    const plan = new Deliver(ctx);
    expect(plan.isApplicableTo(deliverIntent({ x: 2, y: 2 }))).toBe(false);
  });

  it("is NOT applicable for out-of-bounds target", () => {
    const map = gridMap(3, 3);
    const ctx = makeCtx(map, { x: 0, y: 0 }, ["c1"]);
    const plan = new Deliver(ctx);
    expect(plan.isApplicableTo(deliverIntent({ x: 9, y: 9 }))).toBe(false);
  });

  it("is NOT applicable for wrong intention kind", () => {
    const map = gridMap(3, 3);
    const ctx = makeCtx(map, { x: 0, y: 0 }, ["c1"]);
    const plan = new Deliver(ctx);
    expect(
      plan.isApplicableTo({
        kind: "pickup",
        parcelId: "x",
        target: { x: 1, y: 1 },
      }),
    ).toBe(false);
  });
});

describe("Deliver — success path", () => {
  it("navigates to the delivery tile and calls emitPutdown", async () => {
    const map = gridMap(3, 1);
    const ctx = makeCtx(map, { x: 0, y: 0 }, ["c1"]);
    const plan = new Deliver(ctx);
    await plan.execute(deliverIntent({ x: 2, y: 0 }));
    expect(ctx.myPosition()).toEqual({ x: 2, y: 0 });
    expect(ctx.putdowns).toBe(1);
  });
});

describe("Deliver — wrong intention kind", () => {
  it("throws PlanFailedError when executed with wrong kind", async () => {
    const map = gridMap(3, 1);
    const ctx = makeCtx(map, { x: 0, y: 0 }, ["c1"]);
    const plan = new Deliver(ctx);
    await expect(
      plan.execute({ kind: "explore", target: { x: 1, y: 0 } }),
    ).rejects.toBeInstanceOf(PlanFailedError);
  });
});
