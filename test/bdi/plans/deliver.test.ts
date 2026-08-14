import { describe, expect, it } from "vitest";
import type { Intention } from "../../../src/bdi/intentions/index.js";
import { Deliver } from "../../../src/bdi/plans/index.js";
import type { Pos } from "../../../src/core/beliefs/index.js";
import { PlanFailedError } from "../../../src/core/util/index.js";
import {
  applyDir,
  gridMap,
  stubPlanContext,
} from "../../helpers/plan-context.js";

/** A context that walks a grid and drops whatever `carried` holds. */
function makeCtx(w: number, h: number, start: Pos, carried: string[]) {
  let pos = start;
  let stack = [...carried];
  const dropped: string[] = [];

  const ctx = stubPlanContext({
    map: gridMap(w, h),
    myPosition: () => pos,
    myExactPosition: () => pos,
    emitMove: async (dir) => {
      pos = applyDir(pos, dir);
      return pos;
    },
    carriedParcelIds: () => stack,
    putDownAll: async () => {
      const out = stack;
      stack = [];
      dropped.push(...out);
      return out;
    },
  });

  return { ctx, dropped, pos: () => pos };
}

const deliverIntent = (target: Pos): Intention => ({ kind: "deliver", target });

describe("Deliver — applicability", () => {
  it("is applicable when carrying parcels and target in bounds", () => {
    const { ctx } = makeCtx(3, 3, { x: 0, y: 0 }, ["c1"]);
    expect(new Deliver(ctx).isApplicableTo(deliverIntent({ x: 2, y: 2 }))).toBe(
      true,
    );
  });

  it("is NOT applicable when carrying nothing", () => {
    const { ctx } = makeCtx(3, 3, { x: 0, y: 0 }, []);
    expect(new Deliver(ctx).isApplicableTo(deliverIntent({ x: 2, y: 2 }))).toBe(
      false,
    );
  });

  it("is NOT applicable for out-of-bounds target", () => {
    const { ctx } = makeCtx(3, 3, { x: 0, y: 0 }, ["c1"]);
    expect(new Deliver(ctx).isApplicableTo(deliverIntent({ x: 9, y: 9 }))).toBe(
      false,
    );
  });

  it("is NOT applicable for wrong intention kind", () => {
    const { ctx } = makeCtx(3, 3, { x: 0, y: 0 }, ["c1"]);
    expect(
      new Deliver(ctx).isApplicableTo({
        kind: "pickup",
        parcelId: "x",
        target: { x: 1, y: 1 },
      }),
    ).toBe(false);
  });
});

describe("Deliver — success path", () => {
  it("navigates to the delivery tile and drops the whole stack", async () => {
    const { ctx, dropped, pos } = makeCtx(3, 1, { x: 0, y: 0 }, ["c1", "c2"]);

    await new Deliver(ctx).execute(deliverIntent({ x: 2, y: 0 }));

    expect(pos()).toEqual({ x: 2, y: 0 });
    expect(dropped).toEqual(["c1", "c2"]);
  });
});

describe("Deliver — failure paths", () => {
  it("throws PlanFailedError when executed with wrong kind", async () => {
    const { ctx } = makeCtx(3, 1, { x: 0, y: 0 }, ["c1"]);
    await expect(
      new Deliver(ctx).execute({ kind: "explore", target: { x: 1, y: 0 } }),
    ).rejects.toBeInstanceOf(PlanFailedError);
  });

  it("throws when the stack turned out to be empty on arrival (stale beliefs)", async () => {
    const { ctx } = makeCtx(3, 1, { x: 0, y: 0 }, []);
    await expect(
      new Deliver(ctx).execute(deliverIntent({ x: 2, y: 0 })),
    ).rejects.toBeInstanceOf(PlanFailedError);
  });
});

describe("Deliver — stop() is terminal", () => {
  it("does not put down after stop(); a retry needs a fresh instance", async () => {
    const { ctx, dropped } = makeCtx(3, 1, { x: 0, y: 0 }, ["c1"]);
    const plan = new Deliver(ctx);
    plan.stop();

    await plan.execute(deliverIntent({ x: 2, y: 0 }));
    expect(dropped).toEqual([]);

    await new Deliver(ctx).execute(deliverIntent({ x: 2, y: 0 }));
    expect(dropped).toEqual(["c1"]);
  });
});
