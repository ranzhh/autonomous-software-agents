import { describe, expect, it } from "vitest";
import { buildGameMap, type GameMap } from "../../src/core/beliefs/index.js";
import type { IOTile, IOTileType } from "../../src/core/sdk/index.js";
import { buildTourProblem, type TourInput } from "../../src/pddl/index.js";

/** 1-row map from a type string per x: "3" walkable, "2" delivery, "0" wall. */
function lineMap(types: readonly IOTileType[]): GameMap {
  const tiles: IOTile[] = types.map((type, x) => ({ x, y: 0, type }));
  return buildGameMap(types.length, 1, tiles);
}

const NO_DECAY = {
  parcelDecayMs: Number.POSITIVE_INFINITY,
  movementDurationMs: 100,
};

function freeParcel(id: string, x: number, reward = 10) {
  return { id, x, y: 0, reward, updatedAt: 0 };
}

function baseInput(
  map: GameMap,
  overrides: Partial<TourInput> = {},
): TourInput {
  return {
    myPos: { x: 0, y: 0 },
    carried: [],
    freeParcels: [],
    map,
    now: 0,
    settings: NO_DECAY,
    ...overrides,
  };
}

describe("buildTourProblem — objects/init/goal from a known belief state", () => {
  //  x:  0(me) 1  2(p1) 3  4(p2) 5(delivery)
  const map = lineMap(["3", "3", "3", "3", "3", "2"]);
  const input = baseInput(map, {
    freeParcels: [freeParcel("p1", 2), freeParcel("p2", 4)],
  });

  it("declares the waypoint locations and parcels as objects", () => {
    const tour = buildTourProblem(input);
    expect(tour).not.toBeNull();
    const text = tour?.problemText ?? "";
    for (const loc of ["l_0_0", "l_2_0", "l_4_0", "l_5_0"]) {
      expect(text).toContain(loc);
    }
    expect(text).toContain("p_p1 p_p2 - parcel");
  });

  it("inits my position, the delivery, parcel positions, and complete-graph edges", () => {
    const text = buildTourProblem(input)?.problemText ?? "";
    expect(text).toContain("(at l_0_0)");
    expect(text).toContain("(delivery l_5_0)");
    expect(text).toContain("(parcel-at p_p1 l_2_0)");
    expect(text).toContain("(parcel-at p_p2 l_4_0)");
    // complete graph: both directions between distinct waypoints
    expect(text).toContain("(connected l_0_0 l_4_0)");
    expect(text).toContain("(connected l_4_0 l_0_0)");
    expect(text).not.toContain("(connected l_0_0 l_0_0)");
  });

  it("goals delivery of every candidate parcel", () => {
    const text = buildTourProblem(input)?.problemText ?? "";
    expect(text).toContain("(delivered p_p1)");
    expect(text).toContain("(delivered p_p2)");
  });

  it("targets the deliveroo domain and emits no comment/semicolon lines (solver gotcha)", () => {
    const text = buildTourProblem(input)?.problemText ?? "";
    expect(text).toContain("(:domain deliveroo)");
    expect(text).not.toContain(";");
  });

  it("maps location names back to tiles and parcel names back to ids", () => {
    const tour = buildTourProblem(input);
    expect(tour?.locationAt.get("l_5_0")).toEqual({ x: 5, y: 0 });
    expect(tour?.parcelIdOf.get("p_p1")).toBe("p1");
    expect(tour?.candidateParcelIds).toEqual(
      expect.arrayContaining(["p1", "p2"]),
    );
  });
});

describe("buildTourProblem — carried parcels", () => {
  it("with only carried parcels, goals exactly those and inits (carrying …)", () => {
    const map = lineMap(["3", "3", "2"]);
    const tour = buildTourProblem(
      baseInput(map, { carried: [{ id: "c1", reward: 8, updatedAt: 0 }] }),
    );
    expect(tour).not.toBeNull();
    const text = tour?.problemText ?? "";
    expect(text).toContain("(carrying p_c1)");
    expect(text).toContain("(:goal (and (delivered p_c1)))");
    expect(text).not.toContain("parcel-at");
  });
});

describe("buildTourProblem — null (reactive fallback) cases", () => {
  it("returns null when my position is fractional (move in flight)", () => {
    const map = lineMap(["3", "3", "2"]);
    const tour = buildTourProblem(
      baseInput(map, {
        myPos: { x: 0.6, y: 0 },
        freeParcels: [freeParcel("p1", 1)],
      }),
    );
    expect(tour).toBeNull();
  });

  it("returns null when there is nothing to plan", () => {
    const map = lineMap(["3", "3", "2"]);
    expect(buildTourProblem(baseInput(map))).toBeNull();
  });

  it("returns null when no delivery tile is reachable", () => {
    const map = lineMap(["3", "3", "0", "2"]); // wall cuts off the delivery
    const tour = buildTourProblem(
      baseInput(map, { carried: [{ id: "c1", reward: 8, updatedAt: 0 }] }),
    );
    expect(tour).toBeNull();
  });
});

describe("buildTourProblem — candidate selection", () => {
  it("excludes unreachable parcels", () => {
    //  me(0) 1(delivery) wall(2) p1(3) — p1 is cut off
    const map = lineMap(["3", "2", "0", "3"]);
    const tour = buildTourProblem(
      baseInput(map, {
        carried: [{ id: "c1", reward: 8, updatedAt: 0 }],
        freeParcels: [freeParcel("p1", 3)],
      }),
    );
    expect(tour).not.toBeNull();
    expect(tour?.candidateParcelIds).toEqual([]);
    expect(tour?.problemText).not.toContain("p_p1");
  });

  it("excludes zero-value parcels (would expire before delivery)", () => {
    // decay every 100 ms, move 100 ms → the far parcel's 2 reward dies en route
    const map = lineMap(["3", "3", "3", "3", "3", "3", "3", "2"]);
    const tour = buildTourProblem(
      baseInput(map, {
        settings: { parcelDecayMs: 100, movementDurationMs: 100 },
        carried: [{ id: "c1", reward: 50, updatedAt: 0 }],
        freeParcels: [freeParcel("far", 6, 2)],
      }),
    );
    expect(tour?.candidateParcelIds).toEqual([]);
  });

  it("caps candidates at maxCandidates, keeping the highest values", () => {
    const map = lineMap(["3", "3", "3", "3", "3", "3", "2"]);
    const tour = buildTourProblem(
      baseInput(map, {
        freeParcels: [
          freeParcel("a", 1, 5),
          freeParcel("b", 2, 30),
          freeParcel("c", 3, 20),
          freeParcel("d", 4, 40),
          freeParcel("e", 5, 10),
        ],
        maxCandidates: 3,
      }),
    );
    expect(tour?.candidateParcelIds).toEqual(
      expect.arrayContaining(["d", "b", "c"]),
    );
    expect(tour?.candidateParcelIds).toHaveLength(3);
  });

  it("forces mustIncludeParcelId in even when the cap would cut it", () => {
    const map = lineMap(["3", "3", "3", "3", "3", "3", "2"]);
    const tour = buildTourProblem(
      baseInput(map, {
        freeParcels: [
          freeParcel("a", 1, 50),
          freeParcel("b", 2, 40),
          freeParcel("c", 3, 30),
          freeParcel("weak", 5, 1),
        ],
        maxCandidates: 3,
        mustIncludeParcelId: "weak",
      }),
    );
    expect(tour?.candidateParcelIds).toContain("weak");
    expect(tour?.candidateParcelIds).toHaveLength(3);
  });
});

describe("buildTourProblem — name sanitization", () => {
  it("sanitizes hostile parcel ids into PDDL-safe names and maps them back", () => {
    const map = lineMap(["3", "3", "2"]);
    const tour = buildTourProblem(
      baseInput(map, { freeParcels: [freeParcel("P-1$X", 1)] }),
    );
    const text = tour?.problemText ?? "";
    expect(text).toContain("p_p_1_x");
    expect(tour?.parcelIdOf.get("p_p_1_x")).toBe("P-1$X");
  });

  it("disambiguates distinct ids that sanitize identically", () => {
    const map = lineMap(["3", "3", "3", "2"]);
    const tour = buildTourProblem(
      baseInput(map, {
        freeParcels: [freeParcel("a-1", 1), freeParcel("a.1", 2)],
      }),
    );
    expect(tour?.parcelIdOf.size).toBe(2);
    const ids = new Set(tour?.parcelIdOf.values());
    expect(ids).toEqual(new Set(["a-1", "a.1"]));
  });
});

describe("buildTourProblem — waypoint edge cases", () => {
  it("handles a parcel sitting on my own tile (single shared waypoint)", () => {
    const map = lineMap(["3", "3", "2"]);
    const tour = buildTourProblem(
      baseInput(map, { freeParcels: [freeParcel("here", 0)] }),
    );
    expect(tour).not.toBeNull();
    expect(tour?.problemText).toContain("(parcel-at p_here l_0_0)");
    expect(tour?.problemText).toContain("(at l_0_0)");
  });

  it("handles a delivery tile that is also a parcel tile", () => {
    const map = lineMap(["3", "3", "2"]);
    const tour = buildTourProblem(
      baseInput(map, { freeParcels: [freeParcel("ondelivery", 2)] }),
    );
    expect(tour).not.toBeNull();
    const text = tour?.problemText ?? "";
    expect(text).toContain("(parcel-at p_ondelivery l_2_0)");
    expect(text).toContain("(delivery l_2_0)");
  });
});
