import { describe, expect, it } from "vitest";
import {
  clockEventToMs,
  parseSettings,
} from "../../../src/core/beliefs/index.js";
import type { IOConfig } from "../../../src/core/sdk/index.js";
import { createLogger } from "../../../src/core/util/index.js";

/** A logger with no sinks — keeps the defensive-default warnings out of test output. */
const silent = createLogger({ sinks: [] });

/** Build an IOConfig from partial overrides (cast to the SDK type for tests). */
const config = (over: {
  clock?: number;
  penalty?: number;
  movement?: number;
  observation?: number;
  capacity?: number;
  max?: number;
  rewardAvg?: number;
  rewardVariance?: number;
  decaying?: string;
  generation?: string;
}): IOConfig =>
  ({
    CLOCK: over.clock,
    PENALTY: over.penalty,
    GAME: {
      player: {
        movement_duration: over.movement,
        observation_distance: over.observation,
        capacity: over.capacity,
      },
      parcels: {
        max: over.max,
        reward_avg: over.rewardAvg,
        reward_variance: over.rewardVariance,
        decaying_event: over.decaying,
        generation_event: over.generation,
      },
    },
  }) as unknown as IOConfig;

describe("clockEventToMs", () => {
  it("maps 'frame' to the clock period", () => {
    expect(clockEventToMs("frame", 250, silent)).toBe(250);
  });

  it("maps the named second/minute/hour events", () => {
    expect(clockEventToMs("1s", 99, silent)).toBe(1000);
    expect(clockEventToMs("2s", 99, silent)).toBe(2000);
    expect(clockEventToMs("5s", 99, silent)).toBe(5000);
    expect(clockEventToMs("10s", 99, silent)).toBe(10000);
    expect(clockEventToMs("1m", 99, silent)).toBe(60000);
    expect(clockEventToMs("1h", 99, silent)).toBe(3600000);
  });

  it("maps 'infinite' to +Infinity (never decays)", () => {
    expect(clockEventToMs("infinite", 99, silent)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("falls back to 1s for an unrecognized event", () => {
    expect(clockEventToMs("banana", 99, silent)).toBe(1000);
  });
});

describe("parseSettings", () => {
  it("parses a well-formed config", () => {
    const s = parseSettings(
      config({
        clock: 250,
        penalty: 1,
        movement: 100,
        observation: 5,
        capacity: 5,
        max: 30,
        rewardAvg: 50,
        rewardVariance: 10,
        decaying: "2s",
        generation: "1s",
      }),
      silent,
    );
    expect(s.movementDurationMs).toBe(100);
    expect(s.observationDistance).toBe(5);
    expect(s.capacity).toBe(5);
    expect(s.clockMs).toBe(250);
    expect(s.penalty).toBe(1);
    expect(s.parcelMax).toBe(30);
    expect(s.parcelRewardAvg).toBe(50);
    expect(s.parcelRewardVariance).toBe(10);
    expect(s.decayingEvent).toBe("2s");
    expect(s.generationEvent).toBe("1s");
    expect(s.parcelDecayMs).toBe(2000);
    expect(s.parcelGenerationMs).toBe(1000);
  });

  it("treats an 'infinite' decaying event as no decay", () => {
    const s = parseSettings(config({ decaying: "infinite" }), silent);
    expect(s.parcelDecayMs).toBe(Number.POSITIVE_INFINITY);
  });

  it("resolves a 'frame' event against CLOCK", () => {
    const s = parseSettings(
      config({ clock: 250, decaying: "frame", generation: "frame" }),
      silent,
    );
    expect(s.parcelDecayMs).toBe(250);
    expect(s.parcelGenerationMs).toBe(250);
  });

  it("falls back clockMs to movement duration when CLOCK is absent", () => {
    const s = parseSettings(
      config({ movement: 80, decaying: "frame" }),
      silent,
    );
    expect(s.clockMs).toBe(80);
    expect(s.parcelDecayMs).toBe(80);
  });

  it("applies safe defaults for a malformed/partial config", () => {
    const s = parseSettings({} as unknown as IOConfig, silent);
    expect(s.movementDurationMs).toBe(500);
    expect(s.observationDistance).toBe(5);
    expect(s.capacity).toBe(Number.POSITIVE_INFINITY);
    expect(s.penalty).toBe(0);
    expect(s.parcelMax).toBe(0);
    expect(s.decayingEvent).toBe("1s");
    expect(s.parcelDecayMs).toBe(1000);
  });

  it("treats capacity as advisory (unlimited when unset)", () => {
    const s = parseSettings(config({ movement: 100 }), silent);
    expect(s.capacity).toBe(Number.POSITIVE_INFINITY);
  });
});
