import { describe, expect, it } from "vitest";
import type { Intention } from "../../../src/bdi/intentions/index.js";
import { GoPickUp } from "../../../src/bdi/plans/index.js";
import type { Pos } from "../../../src/core/beliefs/index.js";
import { PlanFailedError } from "../../../src/core/util/index.js";
import {
  applyDir,
  gridMap,
  stubPlanContext,
} from "../../helpers/plan-context.js";

interface CtxOptions {
  readonly start: Pos;
  /** Is the target parcel still believed free at execution start? */
  readonly parcelFree?: boolean;
  /** Ids `pickUpHere` yields when the agent stands on the parcel tile. */
  readonly onTile?: readonly string[];
  /** Parcels already in hand — e.g. grabbed by `GoTo` on arrival. */
  readonly carriedIds?: readonly string[];
}

function makeCtx(w: number, h: number, opts: CtxOptions) {
  let pos = opts.start;
  let available = [...(opts.onTile ?? [])];
  const carried = [...(opts.carriedIds ?? [])];
  let pickups = 0;

  const ctx = stubPlanContext({
    map: gridMap(w, h),
    myPosition: () => pos,
    myExactPosition: () => pos,
    emitMove: async (dir) => {
      pos = applyDir(pos, dir);
      return pos;
    },
    isParcelFree: () => opts.parcelFree ?? true,
    carriedParcelIds: () => carried,
    pickUpHere: async () => {
      pickups += 1;
      const taken = available;
      available = [];
      carried.push(...taken);
      return taken;
    },
  });

  return { ctx, pos: () => pos, pickups: () => pickups, carried };
}

const pickupIntent = (id: string, target: Pos): Intention => ({
  kind: "pickup",
  parcelId: id,
  target,
});

describe("GoPickUp — phantom guard", () => {
  it("throws immediately when the parcel is already taken", async () => {
    const { ctx, pos } = makeCtx(3, 1, {
      start: { x: 0, y: 0 },
      parcelFree: false,
    });

    await expect(
      new GoPickUp(ctx).execute(pickupIntent("p1", { x: 2, y: 0 })),
    ).rejects.toBeInstanceOf(PlanFailedError);
    expect(pos()).toEqual({ x: 0, y: 0 }); // never moved
  });
});

describe("GoPickUp — success paths", () => {
  it("navigates to the parcel tile and picks it up", async () => {
    const { ctx, pos, carried } = makeCtx(3, 1, {
      start: { x: 0, y: 0 },
      onTile: ["p1"],
    });

    await new GoPickUp(ctx).execute(pickupIntent("p1", { x: 2, y: 0 }));

    expect(pos()).toEqual({ x: 2, y: 0 });
    expect(carried).toEqual(["p1"]);
  });

  /**
   * `GoTo` grabs opportunistically on the arrival step, so by the time
   * `GoPickUp` resumes the parcel is normally already ours and there is nothing
   * left to take. That is success — and issuing a second pickup anyway costs a
   * full round-trip, now serialized ahead of the next plan's first move.
   */
  it("succeeds without a second pickup when GoTo already grabbed it", async () => {
    const { ctx, pickups } = makeCtx(3, 1, {
      start: { x: 0, y: 0 },
      onTile: [], // GoTo's grab already emptied the tile
      carriedIds: ["p1"],
    });

    await expect(
      new GoPickUp(ctx).execute(pickupIntent("p1", { x: 2, y: 0 })),
    ).resolves.toBeUndefined();
    expect(pickups()).toBeGreaterThan(0); // GoTo probes each tile it steps on
  });
});

describe("GoPickUp — failure paths", () => {
  it("fails when the parcel was not on the tile after all", async () => {
    const { ctx } = makeCtx(3, 1, {
      start: { x: 0, y: 0 },
      onTile: [],
      carriedIds: [],
    });

    await expect(
      new GoPickUp(ctx).execute(pickupIntent("p1", { x: 2, y: 0 })),
    ).rejects.toBeInstanceOf(PlanFailedError);
  });

  it("throws PlanFailedError when executed with wrong kind", async () => {
    const { ctx } = makeCtx(3, 1, { start: { x: 0, y: 0 } });
    await expect(
      new GoPickUp(ctx).execute({ kind: "explore", target: { x: 1, y: 0 } }),
    ).rejects.toBeInstanceOf(PlanFailedError);
  });
});

describe("GoPickUp — stop() is terminal", () => {
  it("does not pick up after stop(); a retry needs a fresh instance", async () => {
    const { ctx, carried } = makeCtx(3, 1, {
      start: { x: 0, y: 0 },
      onTile: ["p1"],
    });
    const plan = new GoPickUp(ctx);
    plan.stop();

    await plan.execute(pickupIntent("p1", { x: 2, y: 0 }));
    expect(carried).toEqual([]);

    await new GoPickUp(ctx).execute(pickupIntent("p1", { x: 2, y: 0 }));
    expect(carried).toEqual(["p1"]);
  });
});
