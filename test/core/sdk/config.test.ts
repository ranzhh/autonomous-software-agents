import { describe, expect, it } from "vitest";
import { loadConfig } from "../../../src/core/sdk/index.js";

describe("loadConfig", () => {
  it("uses safe fallbacks for an empty environment", () => {
    const cfg = loadConfig({});
    expect(cfg.host).toBe("http://localhost:8080");
    expect(cfg.name).toBeUndefined();
    expect(cfg.tokenBdi).toBeUndefined();
    expect(cfg.tokenLlm).toBeUndefined();
    expect(cfg.logLevel).toBe("info");
    expect(cfg.planner).toBe("reactive");
    expect(cfg.pddlSolver).toBe("remote");
  });

  it("reads provided values", () => {
    const cfg = loadConfig({
      HOST: "http://example:9",
      NAME: "bot",
      TOKEN_BDI: "tb",
      TOKEN_LLM: "tl",
      LOG_LEVEL: "debug",
      PLANNER: "pddl",
      PDDL_SOLVER: "local",
    });
    expect(cfg.host).toBe("http://example:9");
    expect(cfg.name).toBe("bot");
    expect(cfg.tokenBdi).toBe("tb");
    expect(cfg.tokenLlm).toBe("tl");
    expect(cfg.logLevel).toBe("debug");
    expect(cfg.planner).toBe("pddl");
    expect(cfg.pddlSolver).toBe("local");
  });

  it("treats empty strings as unset", () => {
    const cfg = loadConfig({ HOST: "", TOKEN_BDI: "", NAME: "" });
    expect(cfg.host).toBe("http://localhost:8080");
    expect(cfg.tokenBdi).toBeUndefined();
    expect(cfg.name).toBeUndefined();
  });

  it("falls back on invalid enum values", () => {
    const cfg = loadConfig({
      PLANNER: "weird",
      PDDL_SOLVER: "weird",
      LOG_LEVEL: "loud",
    });
    expect(cfg.planner).toBe("reactive");
    expect(cfg.pddlSolver).toBe("remote");
    expect(cfg.logLevel).toBe("info");
  });
});
