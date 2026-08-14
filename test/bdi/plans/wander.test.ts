import { describe, expect, it } from "vitest";
import type { Intention } from "../../../src/bdi/intentions/index.js";
import { Wander } from "../../../src/bdi/plans/index.js";
import type { Pos } from "../../../src/core/beliefs/index.js";
import { PlanFailedError } from "../../../src/core/util/index.js";
import {
  applyDir,
  gridMap,
  stubPlanContext,
} from "../../helpers/plan-context.js";

function makeCtx(w: number, h: number, start: Pos) {
  let pos = start;
  const ctx = stubPlanContext({
    map: gridMap(w, h),
    myPosition: () => pos,
    myExactPosition: () => pos,
    emitMove: async (dir) => {
      pos = applyDir(pos, dir);
      return pos;
    },
  });
  return { ctx, pos: () => pos };
}

const exploreIntent = (target: Pos): Intention => ({ kind: "explore", target });

describe("Wander — applicability", () => {
  it("is applicable only for explore intentions", () => {
    const { ctx } = makeCtx(3, 3, { x: 0, y: 0 });
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
    const { ctx, pos } = makeCtx(4, 1, { x: 0, y: 0 });

    await new Wander(ctx).execute(exploreIntent({ x: 3, y: 0 }));

    expect(pos()).toEqual({ x: 3, y: 0 });
  });

  it("throws PlanFailedError when executed with wrong intention kind", async () => {
    const { ctx } = makeCtx(3, 1, { x: 0, y: 0 });
    await expect(
      new Wander(ctx).execute({ kind: "deliver", target: { x: 1, y: 0 } }),
    ).rejects.toBeInstanceOf(PlanFailedError);
  });
});

describe("Wander — stop() is terminal", () => {
  it("does not move after stop(); a retry needs a fresh instance", async () => {
    const { ctx, pos } = makeCtx(5, 1, { x: 0, y: 0 });
    const plan = new Wander(ctx);
    plan.stop();

    await plan.execute(exploreIntent({ x: 4, y: 0 }));
    expect(pos()).toEqual({ x: 0, y: 0 });

    await new Wander(ctx).execute(exploreIntent({ x: 4, y: 0 }));
    expect(pos()).toEqual({ x: 4, y: 0 });
  });
});
