import { describe, expect, it } from "vitest";
import { extractToken, parseTokenArgs } from "../../../src/core/sdk/index.js";
import { AgentError } from "../../../src/core/util/index.js";

describe("parseTokenArgs", () => {
  it("parses name from argv[2]", () => {
    const result = parseTokenArgs(["node", "script.ts", "AgentA"]);
    expect(result.name).toBe("AgentA");
  });

  it("defaults team to name when argv[3] is absent", () => {
    const result = parseTokenArgs(["node", "script.ts", "AgentA"]);
    expect(result.team).toBe("AgentA");
  });

  it("uses explicit team from argv[3]", () => {
    const result = parseTokenArgs(["node", "script.ts", "AgentA", "MyTeam"]);
    expect(result.name).toBe("AgentA");
    expect(result.team).toBe("MyTeam");
  });

  it("trims whitespace from name and team", () => {
    const result = parseTokenArgs([
      "node",
      "script.ts",
      "  AgentA  ",
      "  MyTeam  ",
    ]);
    expect(result.name).toBe("AgentA");
    expect(result.team).toBe("MyTeam");
  });

  it("throws AgentError when name is absent", () => {
    expect(() => parseTokenArgs(["node", "script.ts"])).toThrow(AgentError);
  });

  it("throws AgentError when name is blank whitespace", () => {
    expect(() => parseTokenArgs(["node", "script.ts", "   "])).toThrow(
      AgentError,
    );
  });

  it("defaults team to name when argv[3] is blank whitespace", () => {
    const result = parseTokenArgs(["node", "script.ts", "AgentA", "   "]);
    expect(result.team).toBe("AgentA");
  });
});

describe("extractToken", () => {
  it("returns the token string from a well-formed response", () => {
    expect(extractToken({ token: "abc123" })).toBe("abc123");
  });

  it("throws AgentError for null", () => {
    expect(() => extractToken(null)).toThrow(AgentError);
  });

  it("throws AgentError when token field is missing", () => {
    expect(() => extractToken({ other: "value" })).toThrow(AgentError);
  });

  it("throws AgentError when token field is not a string", () => {
    expect(() => extractToken({ token: 42 })).toThrow(AgentError);
  });

  it("throws AgentError for a plain string", () => {
    expect(() => extractToken("abc123")).toThrow(AgentError);
  });
});
