import { describe, expect, it } from "vitest";
import {
  currentReward,
  deliverValue,
  detourCost,
  enRouteTourValue,
  enRouteValue,
  pickupValue,
} from "../../../src/bdi/reward/value.js";
import {
  buildGameMap,
  type GameMap,
  type Pos,
} from "../../../src/core/beliefs/index.js";
import type { IOTile } from "../../../src/core/sdk/index.js";

/** Build a plain walkable grid of given dimensions. */
function grid(width: number, height: number, walls: Pos[] = []): GameMap {
  const wallSet = new Set(walls.map((p) => `${p.x},${p.y}`));
  const tiles: IOTile[] = [];
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      tiles.push({ x, y, type: wallSet.has(`${x},${y}`) ? "0" : "3" });
    }
  }
  return buildGameMap(width, height, tiles);
}

const noDecay = {
  parcelDecayMs: Number.POSITIVE_INFINITY,
  movementDurationMs: 50,
};
const fastDecay = { parcelDecayMs: 1000, movementDurationMs: 500 }; // 0.5 ticks/step

// ---------------------------------------------------------------------------
// currentReward
// ---------------------------------------------------------------------------

describe("currentReward", () => {
  it("returns lastReward unchanged when no time has passed", () => {
    expect(currentReward(10, 1000, 1000, 1000)).toBe(10);
  });

  it("decrements by one tick per decayMs elapsed", () => {
    expect(currentReward(10, 0, 2000, 1000)).toBe(8); // 2 ticks
  });

  it("returns 0 when fully expired", () => {
    expect(currentReward(5, 0, 10_000, 1000)).toBe(0);
  });

  it("returns lastReward unchanged when decayMs is infinite", () => {
    expect(currentReward(10, 0, 99_000, Number.POSITIVE_INFINITY)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// pickupValue
// ---------------------------------------------------------------------------

describe("pickupValue", () => {
  it("returns full reward when no decay and adjacent parcel + delivery", () => {
    // 3-tile corridor: me(0,0) → parcel(1,0) → delivery(2,0)
    const map = grid(3, 1);
    // parcel at (1,0), updatedAt = now so current reward = 10
    const parcel = { reward: 10, updatedAt: 100, x: 1, y: 0 };
    const val = pickupValue(
      parcel,
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      100,
      noDecay,
      map,
    );
    expect(val).toBe(10);
  });

  it("reduces reward by decay during travel (2 steps × 0.5 ticks = 1 tick)", () => {
    // me(0,0) → parcel(1,0) → delivery(2,0): 2 steps total
    // fastDecay: 0.5 ticks/step → floor(2 × 0.5) = 1 tick lost
    const map = grid(3, 1);
    const parcel = { reward: 10, updatedAt: 0, x: 1, y: 0 };
    const val = pickupValue(
      parcel,
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      0,
      fastDecay,
      map,
    );
    expect(val).toBe(9); // 10 - 1
  });

  it("returns 0 when parcel is unreachable", () => {
    const map = grid(3, 1, [{ x: 1, y: 0 }]); // wall between me and parcel
    const parcel = { reward: 10, updatedAt: 0, x: 2, y: 0 };
    const val = pickupValue(
      parcel,
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      0,
      noDecay,
      map,
    );
    expect(val).toBe(0);
  });

  it("returns 0 when reward would fully decay before delivery", () => {
    // 4 steps × 500ms / 1000ms/tick = 2 ticks, but reward = 1 → 0
    const map = grid(5, 1);
    const parcel = { reward: 1, updatedAt: 0, x: 2, y: 0 };
    const val = pickupValue(
      parcel,
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      0,
      fastDecay,
      map,
    );
    expect(val).toBe(0); // 1 - 2 = negative → clamped to 0
  });
});

// ---------------------------------------------------------------------------
// deliverValue
// ---------------------------------------------------------------------------

describe("deliverValue", () => {
  it("sums carried parcel rewards with no decay", () => {
    const map = grid(3, 1);
    const carried = [
      { reward: 5, updatedAt: 0 },
      { reward: 3, updatedAt: 0 },
    ];
    const val = deliverValue(
      carried,
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      0,
      noDecay,
      map,
    );
    expect(val).toBe(8);
  });

  it("returns 0 when carried is empty", () => {
    const map = grid(3, 1);
    const val = deliverValue(
      [],
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      0,
      noDecay,
      map,
    );
    expect(val).toBe(0);
  });

  it("decreases with distance under decay", () => {
    const map = grid(5, 1);
    const carried = [{ reward: 10, updatedAt: 0 }];
    const near = deliverValue(
      carried,
      { x: 3, y: 0 },
      { x: 4, y: 0 },
      0,
      fastDecay,
      map,
    );
    const far = deliverValue(
      carried,
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      0,
      fastDecay,
      map,
    );
    expect(near).toBeGreaterThan(far);
  });

  it("returns 0 when delivery is unreachable", () => {
    const map = grid(3, 1, [{ x: 1, y: 0 }]);
    const carried = [{ reward: 10, updatedAt: 0 }];
    const val = deliverValue(
      carried,
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      0,
      noDecay,
      map,
    );
    expect(val).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// detourCost
// ---------------------------------------------------------------------------

describe("detourCost", () => {
  it("returns 0 when parcel lies exactly on the direct path", () => {
    // me(0,0) → delivery(4,0): direct = 4 steps
    // via parcel(2,0): 2 + 2 = 4 steps → detour = 0
    const map = grid(5, 1);
    const cost = detourCost(
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 0 },
      map,
    );
    expect(cost).toBe(0);
  });

  it("counts extra steps when parcel is off the direct path", () => {
    // 5×1 corridor: me(0,0) → delivery(4,0) = 4 steps
    // parcel at (2,0) is on path (0 detour) but parcel at (0,1) would need going up
    // Use a 3×3 grid: me(0,0) → delivery(2,0) direct=2
    // parcel(0,2): leg1=2 (0,0→0,2), leg2=4 (0,2→2,0 via (2,2)) = 6, detour = 6-2 = 4
    const map = grid(3, 3);
    const cost = detourCost(
      { x: 0, y: 0 },
      { x: 0, y: 2 },
      { x: 2, y: 0 },
      map,
    );
    expect(cost).toBeGreaterThan(0); // definitely not on the direct path
  });

  it("returns +Infinity when parcel is unreachable", () => {
    const map = grid(3, 1, [{ x: 1, y: 0 }]); // severs corridor
    const cost = detourCost(
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 0 },
      map,
    );
    expect(cost).toBe(Number.POSITIVE_INFINITY);
  });
});

// ---------------------------------------------------------------------------
// enRouteValue
// ---------------------------------------------------------------------------

describe("enRouteValue", () => {
  it("equals currentReward for a parcel exactly on the path (detour = 0)", () => {
    // me(0,0) → delivery(4,0): parcel at (2,0) is on path
    const map = grid(5, 1);
    const parcel = { reward: 8, updatedAt: 0, x: 2, y: 0 };
    // fastDecay, detour = 0 → 0 ticks lost
    const val = enRouteValue(
      parcel,
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      0,
      fastDecay,
      map,
    );
    expect(val).toBe(8);
  });

  it("is higher than pickupValue for an off-path parcel (uses detourCost, not full path)", () => {
    // 5×5 map; standalone pickupValue uses full me→parcel→delivery path,
    // enRouteValue uses only the detour extra steps
    const map = grid(5, 5);
    const parcel = { reward: 20, updatedAt: 0, x: 0, y: 4 };
    const me: Pos = { x: 0, y: 0 };
    const delivery: Pos = { x: 4, y: 0 };
    const en = enRouteValue(parcel, me, delivery, 0, fastDecay, map);
    const standalone = pickupValue(parcel, me, delivery, 0, fastDecay, map);
    // enRoute is better or equal because detourCost ≤ full travel
    expect(en).toBeGreaterThanOrEqual(standalone);
  });

  it("returns 0 when parcel is unreachable", () => {
    const map = grid(3, 1, [{ x: 1, y: 0 }]);
    const parcel = { reward: 10, updatedAt: 0, x: 2, y: 0 };
    const val = enRouteValue(
      parcel,
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      0,
      noDecay,
      map,
    );
    expect(val).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// enRouteTourValue
// ---------------------------------------------------------------------------

describe("enRouteTourValue", () => {
  it("reduces to pickupValue when carrying nothing", () => {
    const map = grid(5, 5);
    const parcel = { reward: 12, updatedAt: 0, x: 4, y: 4 };
    const me: Pos = { x: 0, y: 4 };
    const delivery: Pos = { x: 0, y: 0 };
    const tour = enRouteTourValue(parcel, [], me, delivery, 0, fastDecay, map);
    const standalone = pickupValue(parcel, me, delivery, 0, fastDecay, map);
    expect(tour).toBe(standalone);
  });

  it("sums carried + new parcel rewards when no decay", () => {
    const map = grid(5, 5);
    const parcel = { reward: 7, updatedAt: 0, x: 4, y: 4 };
    const carried = [
      { reward: 5, updatedAt: 0 },
      { reward: 3, updatedAt: 0 },
    ];
    const val = enRouteTourValue(
      parcel,
      carried,
      { x: 0, y: 4 },
      { x: 0, y: 0 },
      0,
      noDecay,
      map,
    );
    expect(val).toBe(15); // 5 + 3 + 7
  });

  it("falls as the carried stack grows (detour decay scales with stack size)", () => {
    const map = grid(5, 5);
    const parcel = { reward: 14, updatedAt: 0, x: 4, y: 4 };
    const me: Pos = { x: 0, y: 4 };
    const delivery: Pos = { x: 0, y: 0 };
    const one = enRouteTourValue(
      parcel,
      [{ reward: 20, updatedAt: 0 }],
      me,
      delivery,
      0,
      fastDecay,
      map,
    );
    const three = enRouteTourValue(
      parcel,
      [
        { reward: 20, updatedAt: 0 },
        { reward: 20, updatedAt: 0 },
        { reward: 20, updatedAt: 0 },
      ],
      me,
      delivery,
      0,
      fastDecay,
      map,
    );
    // More carried parcels each lose extra reward over the longer detour route,
    // so the *per-parcel* tour value is lower — verify via the average.
    expect(three / 3).toBeLessThan(one / 1);
  });

  it("returns 0 when the parcel (or its delivery) is unreachable", () => {
    const map = grid(3, 1, [{ x: 1, y: 0 }]);
    const parcel = { reward: 10, updatedAt: 0, x: 2, y: 0 };
    const val = enRouteTourValue(
      parcel,
      [{ reward: 5, updatedAt: 0 }],
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      0,
      noDecay,
      map,
    );
    expect(val).toBe(0);
  });
});
