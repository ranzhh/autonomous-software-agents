/**
 * Typed, immutable game settings parsed from the SDK's `IOConfig` (delivered by
 * `onConfig`). CLAUDE.md §6: hardcode nothing — every behavioural number comes
 * from here. The `decaying_event`/`generation_event` strings are mapped to
 * milliseconds via `clockEventToMs` (`'infinite'` → `+Infinity` = no decay);
 * `capacity` is kept but is **advisory** (not enforced server-side).
 */

import type { IOConfig } from "../sdk/index.js";
import { createLogger, type Logger } from "../util/index.js";

const log = createLogger({ scope: "settings" });

export interface Settings {
  /** Duration of one move, ms (`player.movement_duration`). */
  readonly movementDurationMs: number;
  /** Sensing radius (`player.observation_distance`). */
  readonly observationDistance: number;
  /** Carry capacity — advisory only; NOT enforced server-side (CLAUDE.md §6). */
  readonly capacity: number;
  /** Game clock frame duration, ms (`config.CLOCK`); the period of a `'frame'` event. */
  readonly clockMs: number;
  /** Penalty applied to invalid moves (`config.PENALTY`). */
  readonly penalty: number;
  /** Max parcels on the grid (`parcels.max`). */
  readonly parcelMax: number;
  readonly parcelRewardAvg: number;
  readonly parcelRewardVariance: number;
  /** Raw decaying-event string, kept for logging/diagnostics. */
  readonly decayingEvent: string;
  /** Raw generation-event string, kept for logging/diagnostics. */
  readonly generationEvent: string;
  /** Decay interval, ms: reward drops 1 every interval. `+Infinity` = never decays. */
  readonly parcelDecayMs: number;
  /** Parcel-generation interval, ms. `+Infinity` = no generation. */
  readonly parcelGenerationMs: number;
}

// Fallbacks used only for malformed/partial config (live `onConfig` carries all
// fields). Kept conservative so a bad read degrades safely rather than crashing.
const DEFAULT_MOVEMENT_MS = 500;
const DEFAULT_OBSERVATION_DISTANCE = 5;
const DEFAULT_PENALTY = 0;
const DEFAULT_PARCEL_MAX = 0;
const DEFAULT_REWARD_AVG = 0;
const DEFAULT_REWARD_VARIANCE = 0;
const DEFAULT_CLOCK_EVENT = "1s";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Map an `IOClockEvent` string to milliseconds. `'frame'` resolves to the game
 * clock period (`clockMs`); `'infinite'` means "never" (`+Infinity`). Accepts a
 * raw `string` so an unexpected server value degrades to 1s with a warning
 * instead of throwing.
 */
export function clockEventToMs(
  event: string,
  clockMs: number,
  logger: Logger = log,
): number {
  switch (event) {
    case "frame":
      return clockMs;
    case "1s":
      return SECOND_MS;
    case "2s":
      return 2 * SECOND_MS;
    case "5s":
      return 5 * SECOND_MS;
    case "10s":
      return 10 * SECOND_MS;
    case "1m":
      return MINUTE_MS;
    case "1h":
      return HOUR_MS;
    case "infinite":
      return Number.POSITIVE_INFINITY;
    default:
      logger.warn(`unknown clock event "${event}", defaulting to 1s`);
      return SECOND_MS;
  }
}

function numericOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value !== "" ? value : fallback;
}

/**
 * Build typed `Settings` from an `IOConfig`. Tolerant of partial input: missing
 * numbers fall back to safe defaults; the clock period drives `'frame'` events
 * (defaulting to `movementDurationMs` when `CLOCK` is absent).
 */
export function parseSettings(
  config: IOConfig,
  logger: Logger = log,
): Settings {
  const game = config.GAME;
  const player = game?.player;
  const parcels = game?.parcels;

  const movementDurationMs = numericOr(
    player?.movement_duration,
    DEFAULT_MOVEMENT_MS,
  );
  const clockMs = numericOr(config.CLOCK, movementDurationMs);
  const decayingEvent = stringOr(parcels?.decaying_event, DEFAULT_CLOCK_EVENT);
  const generationEvent = stringOr(
    parcels?.generation_event,
    DEFAULT_CLOCK_EVENT,
  );

  return {
    movementDurationMs,
    observationDistance: numericOr(
      player?.observation_distance,
      DEFAULT_OBSERVATION_DISTANCE,
    ),
    capacity: numericOr(player?.capacity, Number.POSITIVE_INFINITY),
    clockMs,
    penalty: numericOr(config.PENALTY, DEFAULT_PENALTY),
    parcelMax: numericOr(parcels?.max, DEFAULT_PARCEL_MAX),
    parcelRewardAvg: numericOr(parcels?.reward_avg, DEFAULT_REWARD_AVG),
    parcelRewardVariance: numericOr(
      parcels?.reward_variance,
      DEFAULT_REWARD_VARIANCE,
    ),
    decayingEvent,
    generationEvent,
    parcelDecayMs: clockEventToMs(decayingEvent, clockMs, logger),
    parcelGenerationMs: clockEventToMs(generationEvent, clockMs, logger),
  };
}
