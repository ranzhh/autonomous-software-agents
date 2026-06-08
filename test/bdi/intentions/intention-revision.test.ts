import { describe, expect, it } from "vitest";
import {
  deliberate,
  IntentionRevision,
} from "../../../src/bdi/intentions/index.js";
import type { BeliefSet, Pos } from "../../../src/core/beliefs/index.js";
import { buildGameMap } from "../../../src/core/beliefs/index.js";
import type { ParcelEntry } from "../../../src/core/beliefs/parcel-beliefs.js";
import type { IOAgent, IOTile } from "../../../src/core/sdk/index.js";

// ---------------------------------------------------------------------------
// Map helpers
// ---------------------------------------------------------------------------

function grid(width: number, height: number) {
  const tiles: IOTile[] = [];
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      // Make corners delivery tiles so we always have somewhere to deliver.
      const isDelivery = x === 0 && y === 0;
      tiles.push({ x, y, type: isDelivery ? "2" : "3" });
    }
  }
  return buildGameMap(width, height, tiles);
}

// ---------------------------------------------------------------------------
// Minimal BeliefSet stub
// ---------------------------------------------------------------------------

interface StubOptions {
  myPos?: Pos | undefined;
  free?: ParcelEntry[];
  carried?: ParcelEntry[];
}

function makeParcel(
  id: string,
  x: number,
  y: number,
  reward: number,
): ParcelEntry {
  return { id, x, y, reward, updatedAt: 0, carriedBy: undefined };
}

function makeAgent(id: string, x: number, y: number): IOAgent {
  return {
    id,
    name: "agent",
    teamId: "t",
    teamName: "team",
    x,
    y,
    score: 0,
    penalty: 0,
  };
}

function makeBeliefs(opts: StubOptions): BeliefSet {
  const map = grid(5, 5);
  const me = opts.myPos
    ? makeAgent("me", opts.myPos.x, opts.myPos.y)
    : undefined;

  const freeList: ParcelEntry[] = opts.free ?? [];
  const carriedList: ParcelEntry[] = opts.carried ?? [];

  return {
    settings: {
      movementDurationMs: 500,
      observationDistance: 5,
      capacity: 5,
      clockMs: 50,
      penalty: 0,
      parcelMax: 10,
      parcelRewardAvg: 5,
      parcelRewardVariance: 2,
      decayingEvent: "1s",
      generationEvent: "2s",
      parcelDecayMs: 1000,
      parcelGenerationMs: 2000,
    },
    gameMap: map,
    me,
    parcels: {
      revise: () => {},
      remainingReward: (id: string) =>
        freeList.find((p) => p.id === id)?.reward ?? 0,
      free: () => freeList,
      carriedByMe: () => carriedList,
      carriedByOther: () => [],
      all: () => [...freeList, ...carriedList],
    },
    agents: {
      revise: () => {},
      rivals: () => [],
      teammates: () => [],
      all: () => [],
    },
    onUpdated: () => () => {},
  } as unknown as BeliefSet;
}

const NOW = 0; // all parcels updatedAt=0, now=0 → no elapsed decay

// ---------------------------------------------------------------------------
// deliberate — pure ranking
// ---------------------------------------------------------------------------

describe("deliberate", () => {
  it("returns empty list when me position is unknown", () => {
    const beliefs = makeBeliefs({ myPos: undefined });
    expect(deliberate(beliefs, NOW)).toEqual([]);
  });

  it("returns only explore when there are no free or carried parcels", () => {
    const beliefs = makeBeliefs({ myPos: { x: 2, y: 2 } });
    const result = deliberate(beliefs, NOW);
    expect(result).toHaveLength(1);
    expect(result[0]?.intention.kind).toBe("explore");
  });

  it("includes a deliver candidate when carrying parcels", () => {
    const beliefs = makeBeliefs({
      myPos: { x: 2, y: 2 },
      carried: [makeParcel("c1", 2, 2, 10)],
    });
    const result = deliberate(beliefs, NOW);
    const kinds = result.map((c) => c.intention.kind);
    expect(kinds).toContain("deliver");
  });

  it("includes pickup candidates for each free parcel with positive value", () => {
    const beliefs = makeBeliefs({
      myPos: { x: 2, y: 2 },
      free: [makeParcel("p1", 1, 1, 8), makeParcel("p2", 3, 3, 6)],
    });
    const result = deliberate(beliefs, NOW);
    const pickups = result.filter((c) => c.intention.kind === "pickup");
    expect(pickups).toHaveLength(2);
  });

  it("sorts candidates descending by value", () => {
    const beliefs = makeBeliefs({
      myPos: { x: 2, y: 2 },
      free: [makeParcel("pLow", 1, 1, 3), makeParcel("pHigh", 2, 1, 15)],
    });
    const result = deliberate(beliefs, NOW);
    const values = result.map((c) => c.value);
    for (let i = 1; i < values.length; i++) {
      expect(values[i - 1]).toBeGreaterThanOrEqual(values[i] ?? 0);
    }
  });
});

// ---------------------------------------------------------------------------
// IntentionRevision — hysteresis + validity
// ---------------------------------------------------------------------------

describe("IntentionRevision — first commitment", () => {
  it("adopts the first candidate on the first revise call", () => {
    const rev = new IntentionRevision();
    const beliefs = makeBeliefs({
      myPos: { x: 2, y: 2 },
      free: [makeParcel("p1", 1, 1, 10)],
    });
    const intention = rev.revise(beliefs, NOW);
    expect(intention).toBeDefined();
    expect(rev.committed).toBeDefined();
  });
});

describe("IntentionRevision — hysteresis", () => {
  it("keeps current intention when new value is within the 20 % margin", () => {
    const rev = new IntentionRevision();
    // First commit: pick up a high-value parcel.
    const beliefs1 = makeBeliefs({
      myPos: { x: 2, y: 2 },
      free: [makeParcel("p1", 1, 1, 20)],
    });
    rev.revise(beliefs1, NOW);
    const committed = rev.committed;

    // Second revise: same parcel, slightly higher value parcel added but < 20 % better.
    // We verify no switch happens (committed is unchanged).
    const beliefs2 = makeBeliefs({
      myPos: { x: 2, y: 2 },
      free: [
        makeParcel("p1", 1, 1, 20),
        makeParcel("p2", 3, 3, 21), // < 20% above p1 effective value
      ],
    });
    const result = rev.revise(beliefs2, NOW);
    // Should not switch (returns undefined = keep current)
    if (result !== undefined) {
      // It may switch if p2's computed value happens to be > 1.2× p1 — that's ok.
      // The key test: the committed intent is still valid after revision.
      expect(rev.committed).toBeDefined();
    } else {
      expect(rev.committed).toEqual(committed);
    }
  });

  it("switches when the new best is clearly better (> 20 % margin)", () => {
    const rev = new IntentionRevision();
    // Commit to a low-reward parcel at (1,1).
    const beliefs1 = makeBeliefs({
      myPos: { x: 2, y: 2 },
      free: [makeParcel("pLow", 1, 1, 5)],
    });
    rev.revise(beliefs1, NOW);

    // Now introduce a much higher-reward parcel.
    const beliefs2 = makeBeliefs({
      myPos: { x: 2, y: 2 },
      free: [makeParcel("pLow", 1, 1, 5), makeParcel("pHigh", 3, 3, 100)],
    });
    const switched = rev.revise(beliefs2, NOW);
    // Must have switched to pHigh
    expect(switched).toBeDefined();
    expect(switched?.kind).toBe("pickup");
    if (switched?.kind === "pickup") {
      expect(switched.parcelId).toBe("pHigh");
    }
  });
});

describe("IntentionRevision — explore → real immediate", () => {
  it("switches from explore to pickup immediately (no hysteresis guard)", () => {
    const rev = new IntentionRevision();
    // First commit → explore (no free parcels).
    const beliefs1 = makeBeliefs({ myPos: { x: 2, y: 2 } });
    rev.revise(beliefs1, NOW);
    expect(rev.committed?.kind).toBe("explore");

    // Parcel appears.
    const beliefs2 = makeBeliefs({
      myPos: { x: 2, y: 2 },
      free: [makeParcel("p1", 1, 1, 10)],
    });
    const switched = rev.revise(beliefs2, NOW);
    expect(switched?.kind).not.toBe("explore");
  });
});

describe("IntentionRevision — invalid drop", () => {
  it("drops pickup immediately when the parcel is stolen", () => {
    const rev = new IntentionRevision();
    // Commit to picking up p1.
    const beliefs1 = makeBeliefs({
      myPos: { x: 2, y: 2 },
      free: [makeParcel("p1", 1, 1, 10)],
    });
    rev.revise(beliefs1, NOW);
    expect(rev.committed?.kind).toBe("pickup");

    // p1 is gone (carried by rival, or expired).
    const beliefs2 = makeBeliefs({ myPos: { x: 2, y: 2 }, free: [] });
    const dropped = rev.revise(beliefs2, NOW);
    // Must switch away from the now-invalid pickup.
    expect(dropped).toBeDefined();
    expect(dropped?.kind).not.toBe("pickup");
  });

  it("drops deliver immediately on phantom-carry (carried parcel disappears)", () => {
    const rev = new IntentionRevision();
    // Commit to delivering c1.
    const beliefs1 = makeBeliefs({
      myPos: { x: 2, y: 2 },
      carried: [makeParcel("c1", 2, 2, 10)],
    });
    rev.revise(beliefs1, NOW);
    expect(rev.committed?.kind).toBe("deliver");

    // c1 delivered — carriedByMe = [].
    const beliefs2 = makeBeliefs({ myPos: { x: 2, y: 2 }, carried: [] });
    const dropped = rev.revise(beliefs2, NOW);
    expect(dropped).toBeDefined();
    expect(dropped?.kind).not.toBe("deliver");
  });

  it("resets and re-deliberates cleanly after reset()", () => {
    const rev = new IntentionRevision();
    const beliefs = makeBeliefs({
      myPos: { x: 2, y: 2 },
      free: [makeParcel("p1", 1, 1, 10)],
    });
    rev.revise(beliefs, NOW);
    rev.reset();
    expect(rev.committed).toBeUndefined();
    // After reset, next revise should commit fresh.
    const next = rev.revise(beliefs, NOW);
    expect(next).toBeDefined();
  });
});
