import { describe, expect, it } from "vitest";
import {
  AgentError,
  err,
  isErr,
  isOk,
  ok,
  type Result,
  unwrapOr,
} from "../../../src/core/util/index.js";

describe("Result", () => {
  it("constructs ok values", () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
    if (isOk(result)) {
      expect(result.value).toBe(42);
    }
  });

  it("constructs err values", () => {
    const result = err(new AgentError("boom"));
    expect(result.ok).toBe(false);
    expect(isErr(result)).toBe(true);
    expect(isOk(result)).toBe(false);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(AgentError);
    }
  });

  it("narrows the value type through isOk", () => {
    const result: Result<number> = ok(1);
    // The guard narrows `result` to Ok<number>, so `.value` is reachable.
    expect(isOk(result) && result.value === 1).toBe(true);
  });

  it("unwrapOr returns the value when ok and the fallback when err", () => {
    expect(unwrapOr(ok(5), 0)).toBe(5);
    expect(unwrapOr(err(new AgentError("x")), 0)).toBe(0);
  });
});
