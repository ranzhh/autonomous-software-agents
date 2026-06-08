import { describe, expect, it } from "vitest";
import { createParcelBeliefs } from "../../../src/core/beliefs/index.js";

const MY_ID = "agent-me";
const DECAY_MS = 1000;

type Parcel = {
  id: string;
  x: number;
  y: number;
  carriedBy?: string;
  reward: number;
};

function visible(...coords: [number, number][]): ReadonlySet<string> {
  return new Set(coords.map(([x, y]) => `${x},${y}`));
}

function parcel(
  id: string,
  x: number,
  y: number,
  reward: number,
  carriedBy?: string,
): Parcel {
  return carriedBy !== undefined
    ? { id, x, y, reward, carriedBy }
    : { id, x, y, reward };
}

describe("createParcelBeliefs — upsert", () => {
  it("adds newly-sensed parcels to the store", () => {
    const pb = createParcelBeliefs(DECAY_MS);
    pb.revise([parcel("p1", 1, 2, 10)], visible([1, 2]), MY_ID, 0);
    expect(pb.all()).toHaveLength(1);
    expect(pb.all()[0]?.id).toBe("p1");
  });

  it("re-syncs reward on re-sense (server truth wins)", () => {
    const pb = createParcelBeliefs(DECAY_MS);
    pb.revise([parcel("p1", 1, 2, 10)], visible([1, 2]), MY_ID, 0);
    pb.revise([parcel("p1", 1, 2, 8)], visible([1, 2]), MY_ID, 500);
    expect(pb.all()[0]?.reward).toBe(8);
  });
});

describe("createParcelBeliefs — local decay", () => {
  it("computes remaining reward accounting for elapsed ticks", () => {
    const pb = createParcelBeliefs(DECAY_MS);
    pb.revise([parcel("p1", 1, 2, 10)], new Set(), MY_ID, 0);
    // 2500 ms elapsed → 2 complete ticks → reward = 10 - 2 = 8
    expect(pb.remainingReward("p1", 2500)).toBe(8);
  });

  it("floors partial ticks (does not decay mid-interval)", () => {
    const pb = createParcelBeliefs(DECAY_MS);
    pb.revise([parcel("p1", 1, 2, 5)], new Set(), MY_ID, 0);
    // 999ms < 1 tick
    expect(pb.remainingReward("p1", 999)).toBe(5);
  });

  it("clamps remaining reward to 0 (never negative)", () => {
    const pb = createParcelBeliefs(DECAY_MS);
    pb.revise([parcel("p1", 1, 2, 3)], new Set(), MY_ID, 0);
    expect(pb.remainingReward("p1", 10_000)).toBe(0);
  });

  it("returns undefined for an unknown parcel id", () => {
    const pb = createParcelBeliefs(DECAY_MS);
    expect(pb.remainingReward("ghost", 0)).toBeUndefined();
  });

  it("does not decay when decayMs is +Infinity", () => {
    const pb = createParcelBeliefs(Number.POSITIVE_INFINITY);
    pb.revise([parcel("p1", 1, 2, 10)], new Set(), MY_ID, 0);
    expect(pb.remainingReward("p1", 9_999_999)).toBe(10);
  });
});

describe("createParcelBeliefs — forget on visible-miss", () => {
  it("forgets a free parcel whose tile is visible but absent from sensing", () => {
    const pb = createParcelBeliefs(DECAY_MS);
    pb.revise([parcel("p1", 3, 4, 5)], visible([3, 4]), MY_ID, 0);
    // Next sensing sees tile (3,4) but p1 is gone
    pb.revise([], visible([3, 4]), MY_ID, 500);
    expect(pb.all()).toHaveLength(0);
  });

  it("keeps a parcel whose tile is NOT in the visible set (out of view)", () => {
    const pb = createParcelBeliefs(DECAY_MS);
    pb.revise([parcel("p1", 3, 4, 5)], visible([3, 4]), MY_ID, 0);
    // Next sensing does not cover (3,4)
    pb.revise([], new Set(), MY_ID, 500);
    expect(pb.all()).toHaveLength(1);
  });
});

describe("createParcelBeliefs — phantom-carry guard", () => {
  it("drops a carried-by-me parcel when delivery completes", () => {
    const pb = createParcelBeliefs(DECAY_MS);
    // I pick up p1: it appears at my position (5,5)
    pb.revise([parcel("p1", 5, 5, 8, MY_ID)], visible([5, 5]), MY_ID, 0);
    expect(pb.carriedByMe()).toHaveLength(1);

    // I deliver at (5,5): server no longer sends p1, but (5,5) is visible
    pb.revise([], visible([5, 5]), MY_ID, 500);
    expect(pb.carriedByMe()).toHaveLength(0);
    expect(pb.all()).toHaveLength(0);
  });

  it("drops a carried-by-me parcel even when its last-seen tile is now out of view", () => {
    const pb = createParcelBeliefs(DECAY_MS);
    // I pick up p1 at the spawner tile (7,14) — that is where it is last sensed.
    pb.revise([parcel("p1", 7, 14, 8, MY_ID)], visible([7, 14]), MY_ID, 0);
    expect(pb.carriedByMe()).toHaveLength(1);

    // I carry it across the map and deliver at (18,13). The server stops sending
    // p1, and the pickup tile (7,14) is far away — NOT in the visible set. I
    // still always perceive what I carry, so its absence means it was delivered.
    pb.revise([], visible([18, 13]), MY_ID, 500);
    expect(pb.carriedByMe()).toHaveLength(0);
    expect(pb.all()).toHaveLength(0);
  });
});

describe("createParcelBeliefs — optimistic action updates", () => {
  it("applyPickup marks a free parcel as carried-by-me immediately", () => {
    const pb = createParcelBeliefs(DECAY_MS);
    pb.revise([parcel("p1", 3, 4, 9)], visible([3, 4]), MY_ID, 0);
    expect(pb.free()).toHaveLength(1);
    expect(pb.carriedByMe()).toHaveLength(0);

    pb.applyPickup(["p1"], MY_ID, 10);
    expect(pb.free()).toHaveLength(0);
    expect(pb.carriedByMe()).toHaveLength(1);
    expect(pb.carriedByMe()[0]?.id).toBe("p1");
  });

  it("applyPickup ignores unknown ids", () => {
    const pb = createParcelBeliefs(DECAY_MS);
    pb.applyPickup(["ghost"], MY_ID, 0);
    expect(pb.all()).toHaveLength(0);
  });

  it("applyDelivered forgets the given parcels", () => {
    const pb = createParcelBeliefs(DECAY_MS);
    pb.revise([parcel("p1", 5, 5, 8, MY_ID)], visible([5, 5]), MY_ID, 0);
    expect(pb.carriedByMe()).toHaveLength(1);

    pb.applyDelivered(["p1"]);
    expect(pb.all()).toHaveLength(0);
    expect(pb.carriedByMe()).toHaveLength(0);
  });
});

describe("createParcelBeliefs — expire at 0", () => {
  it("removes an out-of-view parcel whose local reward reaches 0", () => {
    const pb = createParcelBeliefs(DECAY_MS);
    pb.revise([parcel("p1", 9, 9, 2)], new Set(), MY_ID, 0);
    // 3 ticks → reward would be -1 → clamped to 0 → expired
    pb.revise([], new Set(), MY_ID, 3000);
    expect(pb.all()).toHaveLength(0);
  });

  it("keeps a parcel with reward > 0 while out of view", () => {
    const pb = createParcelBeliefs(DECAY_MS);
    pb.revise([parcel("p1", 9, 9, 5)], new Set(), MY_ID, 0);
    pb.revise([], new Set(), MY_ID, 2000); // 2 ticks → reward = 3
    expect(pb.all()).toHaveLength(1);
  });
});

describe("createParcelBeliefs — accessors", () => {
  it("free() excludes carried parcels", () => {
    const pb = createParcelBeliefs(DECAY_MS);
    pb.revise(
      [parcel("p1", 1, 1, 5), parcel("p2", 2, 2, 5, MY_ID)],
      visible([1, 1], [2, 2]),
      MY_ID,
      0,
    );
    expect(pb.free()).toHaveLength(1);
    expect(pb.free()[0]?.id).toBe("p1");
  });

  it("carriedByMe() returns only parcels carried by my id", () => {
    const pb = createParcelBeliefs(DECAY_MS);
    pb.revise(
      [parcel("p1", 1, 1, 5, MY_ID), parcel("p2", 2, 2, 5, "other")],
      visible([1, 1], [2, 2]),
      MY_ID,
      0,
    );
    expect(pb.carriedByMe()).toHaveLength(1);
    expect(pb.carriedByMe()[0]?.id).toBe("p1");
  });

  it("carriedByOther() returns parcels carried by other agents", () => {
    const pb = createParcelBeliefs(DECAY_MS);
    pb.revise(
      [parcel("p1", 1, 1, 5, MY_ID), parcel("p2", 2, 2, 5, "rival")],
      visible([1, 1], [2, 2]),
      MY_ID,
      0,
    );
    expect(pb.carriedByOther()).toHaveLength(1);
    expect(pb.carriedByOther()[0]?.id).toBe("p2");
  });

  it("carriedByMe() returns empty before first revise", () => {
    const pb = createParcelBeliefs(DECAY_MS);
    expect(pb.carriedByMe()).toHaveLength(0);
  });
});
