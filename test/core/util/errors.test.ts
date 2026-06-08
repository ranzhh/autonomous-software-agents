import { describe, expect, it } from "vitest";
import {
  AgentError,
  LlmError,
  PlanFailedError,
  PlannerError,
  SensingError,
} from "../../../src/core/util/index.js";

describe("AgentError hierarchy", () => {
  it("subclasses are instances of AgentError and Error", () => {
    for (const Subclass of [
      PlanFailedError,
      PlannerError,
      SensingError,
      LlmError,
    ]) {
      const error = new Subclass("msg");
      expect(error).toBeInstanceOf(AgentError);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it("sets name to the concrete subclass", () => {
    expect(new AgentError("x").name).toBe("AgentError");
    expect(new PlanFailedError("x").name).toBe("PlanFailedError");
    expect(new PlannerError("x").name).toBe("PlannerError");
    expect(new SensingError("x").name).toBe("SensingError");
    expect(new LlmError("x").name).toBe("LlmError");
  });

  it("carries the message and propagates cause", () => {
    const cause = new Error("root");
    const error = new PlannerError("wrap", { cause });
    expect(error.message).toBe("wrap");
    expect(error.cause).toBe(cause);
  });
});
