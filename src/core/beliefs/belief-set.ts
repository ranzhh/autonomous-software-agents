/**
 * Wires the Phase-0 `GameConnection` to the four belief stores and the
 * `Settings` parser. On each `onSensing` event it:
 *   1. Builds the visible-tile set from `sensing.positions`.
 *   2. Revises parcels and agents.
 *   3. Refreshes the latest `me` snapshot.
 *   4. Emits an `updated` event so consumers can react.
 *
 * `createBeliefSet` must be called after the connection is ready (i.e. after
 * `connection.ready()` resolves) so that `config()` and `map()` are available.
 * Calling it before ready is safe but `settings` / `gameMap` will be undefined.
 */

import type { GameConnection, IOAgent, IOSensing } from "../sdk/index.js";
import { type AgentBeliefs, createAgentBeliefs } from "./agent-beliefs.js";
import { buildGameMap, type GameMap } from "./game-map.js";
import { createParcelBeliefs, type ParcelBeliefs } from "./parcel-beliefs.js";
import { parseSettings, type Settings } from "./settings.js";

export interface BeliefSetOptions {
  /** Override `Date.now` for deterministic tests. */
  now?: () => number;
  /** How long (ms) to retain an out-of-view agent. Default 30 s. */
  agentTtlMs?: number;
}

export interface BeliefSet {
  /** Typed, immutable game settings (from `onConfig`). */
  readonly settings: Settings | undefined;
  /** Static map model (from `onMap`). */
  readonly gameMap: GameMap | undefined;
  /** Latest `me` snapshot from `onYou`. */
  readonly me: IOAgent | undefined;
  readonly parcels: ParcelBeliefs;
  readonly agents: AgentBeliefs;
  /**
   * Subscribe to post-sensing belief updates. Returns an unsubscribe fn.
   * The listener receives the raw `IOSensing` that triggered the update.
   */
  onUpdated(listener: (sensing: IOSensing) => void): () => void;
}

/**
 * Build a `BeliefSet` wired to the given connection. Should be called after
 * `connection.ready()` resolves.
 */
export function createBeliefSet(
  connection: GameConnection,
  options: BeliefSetOptions = {},
): BeliefSet {
  const now = options.now ?? (() => Date.now());

  // Build settings and map from whatever the connection has (may be undefined
  // if called before ready, but that's the caller's choice).
  let settings: Settings | undefined;
  let gameMap: GameMap | undefined;
  let me: IOAgent | undefined = connection.me();

  const rawConfig = connection.config();
  if (rawConfig !== undefined) {
    settings = parseSettings(rawConfig);
  }

  const rawMap = connection.map();
  if (rawMap !== undefined) {
    gameMap = buildGameMap(rawMap.width, rawMap.height, rawMap.tiles);
  }

  const parcels = createParcelBeliefs(
    settings?.parcelDecayMs ?? Number.POSITIVE_INFINITY,
  );
  const agents = createAgentBeliefs(options.agentTtlMs);

  const listeners = new Set<(sensing: IOSensing) => void>();

  connection.onSensing((sensing) => {
    // Refresh me (onYou may have fired since the last sensing)
    const latest = connection.me();
    if (latest !== undefined) me = latest;

    if (me === undefined) return;

    // Build the visible-tile set from sensing.positions
    const visible = new Set<string>(
      sensing.positions.map((p) => `${p.x},${p.y}`),
    );

    parcels.revise(sensing.parcels, visible, me.id, now());
    agents.revise(sensing.agents, me.id, me.teamName, now());

    for (const listener of listeners) {
      listener(sensing);
    }
  });

  return {
    get settings() {
      return settings;
    },
    get gameMap() {
      return gameMap;
    },
    get me() {
      return me;
    },
    parcels,
    agents,
    onUpdated(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
