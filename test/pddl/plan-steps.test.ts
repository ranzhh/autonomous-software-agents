import { describe, expect, it } from "vitest";
import type { Pos } from "../../src/core/beliefs/index.js";
import { PlannerError } from "../../src/core/util/index.js";
import { mapSolvedPlan, type TourProblem } from "../../src/pddl/index.js";

function tour(
  locations: Record<string, Pos>,
  parcels: Record<string, string>,
): TourProblem {
  return {
    problemText: "",
    locationAt: new Map(Object.entries(locations)),
    parcelIdOf: new Map(Object.entries(parcels)),
    candidateParcelIds: Object.values(parcels),
  };
}

const T = tour(
  { l_0_0: { x: 0, y: 0 }, l_2_0: { x: 2, y: 0 }, l_5_0: { x: 5, y: 0 } },
  { p_a: "a", p_b: "b" },
);

describe("mapSolvedPlan", () => {
  it("maps move/pickup/deliver to goto/pickup/putdown with resolved names", () => {
    const steps = mapSolvedPlan(
      [
        { action: "move", args: ["l_0_0", "l_2_0"] },
        { action: "pickup", args: ["p_a", "l_2_0"] },
        { action: "move", args: ["l_2_0", "l_5_0"] },
        { action: "deliver", args: ["p_a", "l_5_0"] },
      ],
      T,
    );
    expect(steps).toEqual([
      { kind: "goto", target: { x: 2, y: 0 } },
      { kind: "pickup", parcelIds: ["a"] },
      { kind: "goto", target: { x: 5, y: 0 } },
      { kind: "putdown" },
    ]);
  });

  it("collapses consecutive same-tile pickups into one action (pickup grabs all)", () => {
    const steps = mapSolvedPlan(
      [
        { action: "pickup", args: ["p_a", "l_0_0"] },
        { action: "pickup", args: ["p_b", "l_0_0"] },
      ],
      T,
    );
    expect(steps).toEqual([{ kind: "pickup", parcelIds: ["a", "b"] }]);
  });

  it("collapses consecutive delivers into one putdown (putdown drops all)", () => {
    const steps = mapSolvedPlan(
      [
        { action: "deliver", args: ["p_a", "l_5_0"] },
        { action: "deliver", args: ["p_b", "l_5_0"] },
      ],
      T,
    );
    expect(steps).toEqual([{ kind: "putdown" }]);
  });

  it("does not collapse across an intervening move", () => {
    const steps = mapSolvedPlan(
      [
        { action: "pickup", args: ["p_a", "l_0_0"] },
        { action: "move", args: ["l_0_0", "l_2_0"] },
        { action: "pickup", args: ["p_b", "l_2_0"] },
      ],
      T,
    );
    expect(steps).toHaveLength(3);
  });

  it("throws PlannerError on unknown locations, parcels, or actions", () => {
    expect(() =>
      mapSolvedPlan([{ action: "move", args: ["l_0_0", "l_9_9"] }], T),
    ).toThrow(PlannerError);
    expect(() =>
      mapSolvedPlan([{ action: "pickup", args: ["p_zz", "l_0_0"] }], T),
    ).toThrow(PlannerError);
    expect(() => mapSolvedPlan([{ action: "teleport", args: [] }], T)).toThrow(
      PlannerError,
    );
  });

  it("maps an empty plan (goal already satisfied) to no steps", () => {
    expect(mapSolvedPlan([], T)).toEqual([]);
  });
});
