import { describe, expect, it } from "vitest";

/**
 * Scaffold smoke test (task 0.1): proves the vitest + tsx + strict-TS pipeline
 * runs and that the src/ module graph resolves end-to-end. Real unit and
 * offline-integration suites arrive alongside the modules they cover (0.2+).
 */
describe("scaffold", () => {
  it("runs the vitest + tsx pipeline", () => {
    expect(1 + 1).toBe(2);
  });

  it("resolves a core barrel module", async () => {
    const util = await import("../src/core/util/index.js");
    expect(util).toBeDefined();
  });
});
