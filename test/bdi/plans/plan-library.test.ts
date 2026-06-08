import { describe, expect, it } from "vitest";
import type { Intention } from "../../../src/bdi/intentions/index.js";
import { BasePlan, PlanLibrary } from "../../../src/bdi/plans/index.js";

/** A test plan that declares applicability for a fixed intention kind. */
class StubPlan extends BasePlan {
  override readonly name: string;
  private readonly applicable: boolean;

  constructor(name: string, applicable: boolean) {
    // The PlanContext is irrelevant to selection, so pass a bare cast.
    super({} as never);
    this.name = name;
    this.applicable = applicable;
  }

  override isApplicableTo(_intention: Intention): boolean {
    return this.applicable;
  }
  override async execute(): Promise<void> {}
  override stop(): void {}
}

const goto = (): Intention => ({ kind: "goto", target: { x: 0, y: 0 } });

describe("PlanLibrary.select", () => {
  it("returns the first applicable plan", () => {
    const a = new StubPlan("A", false);
    const b = new StubPlan("B", true);
    const c = new StubPlan("C", true);
    const lib = new PlanLibrary([a, b, c]);
    expect(lib.select(goto())?.name).toBe("B");
  });

  it("returns undefined when no plan applies", () => {
    const lib = new PlanLibrary([new StubPlan("A", false)]);
    expect(lib.select(goto())).toBeUndefined();
  });

  it("returns undefined for an empty library", () => {
    const lib = new PlanLibrary([]);
    expect(lib.select(goto())).toBeUndefined();
  });
});
