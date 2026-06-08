import { describe, expect, it } from "vitest";
import type { Intention } from "../../../src/bdi/intentions/index.js";
import type { PlanContext } from "../../../src/bdi/plans/index.js";
import { Wander } from "../../../src/bdi/plans/index.js";
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

function makeCtx(map: GameMap, start: Pos): PlanContext {
  let pos = start;
  return {
    map,
    moveDurationMs: 10,
    myPosition: () => pos,
    isBlocked: () => false,
    emitMove: async (dir: Direction) => {
      pos = applyDir(pos, dir);
      return pos;
    },
    emitPickup: async () => [],
    emitPutdown: async () => [],
    wait: async () => {},
    carriedParcelIds: () => [],
    isParcelFree: () => true,
    freeParcelIdsAt: () => [],
    applyPickup: () => {},
    applyDelivered: () => {},
  } as unknown as PlanContext;
}

const exploreIntent = (target: Pos): Intention => ({ kind: "explore", target });

describe("Wander — applicability", () => {
  it("is applicable only for explore intentions", () => {
    const map = gridMap(3, 3);
    const ctx = makeCtx(map, { x: 0, y: 0 });
    const plan = new Wander(ctx);
    expect(plan.isApplicableTo(exploreIntent({ x: 2, y: 2 }))).toBe(true);
    expect(
      plan.isApplicableTo({ kind: "deliver", target: { x: 2, y: 2 } }),
    ).toBe(false);
    expect(
      plan.isApplicableTo({
        kind: "pickup",
        parcelId: "x",
        target: { x: 1, y: 1 },
      }),
    ).toBe(false);
  });
});

describe("Wander — navigation", () => {
  it("navigates to the explore target", async () => {
    const map = gridMap(4, 1);
    const ctx = makeCtx(map, { x: 0, y: 0 });
    const plan = new Wander(ctx);
    await plan.execute(exploreIntent({ x: 3, y: 0 }));
    expect((ctx as unknown as { myPosition(): Pos }).myPosition()).toEqual({
      x: 3,
      y: 0,
    });
  });

  it("throws PlanFailedError when executed with wrong intention kind", async () => {
    const map = gridMap(3, 1);
    const ctx = makeCtx(map, { x: 0, y: 0 });
    const plan = new Wander(ctx);
    await expect(
      plan.execute({ kind: "deliver", target: { x: 1, y: 0 } }),
    ).rejects.toBeInstanceOf(PlanFailedError);
  });
});

describe("Wander — reuse after stop", () => {
  it("navigates normally when called after a prior stop() (instance reuse in PlanLibrary)", async () => {
    const map = gridMap(5, 1);
    const ctx = makeCtx(map, { x: 0, y: 0 });
    const plan = new Wander(ctx);
    // Simulate a prior stop (as happens when the PlanLibrary singleton is
    // preempted and then re-selected for a new explore intention).
    plan.stop();
    // execute() creates a fresh inner GoTo — prior stop has no effect.
    await plan.execute(exploreIntent({ x: 4, y: 0 }));
    expect((ctx as unknown as { myPosition(): Pos }).myPosition()).toEqual({
      x: 4,
      y: 0,
    });
  });
});
