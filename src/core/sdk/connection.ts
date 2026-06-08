/**
 * A typed, readiness-aware wrapper over the SDK socket. The SDK's one-shot
 * `socket.{config,map,me,token}` promises are unreliable (CLAUDE.md §6: `enhance()`
 * copies only prototype methods, so the class field initializers never run), so
 * this builds its world view from our own `onConfig`/`onMap`/`onYou` listeners
 * instead. It exposes `ready()` (resolves once config + map + you have all been
 * seen), latest-value accessors (guarding the optional `IOAgent.x/y`), and the
 * live `sensing` stream.
 *
 * `createConnection` is pure over a `DjsSocketLike` so it is fully unit-testable
 * with a mock socket; `connectToGame` is the thin production adapter over
 * `DjsConnect`, exercised only by live runs.
 */

import { DjsConnect } from "@unitn-asa/deliveroo-js-sdk";
import { SensingError } from "../util/index.js";
import type { IOAgent, IOConfig, IOSensing, IOTile } from "./types.js";

export interface GameMapData {
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly IOTile[];
}

/** The minimal slice of the SDK socket the wrapper needs (so tests can mock it). */
export interface DjsSocketLike {
  onConfig(listener: (config: IOConfig) => void): void;
  onMap(
    listener: (width: number, height: number, tiles: IOTile[]) => void,
  ): void;
  onYou(listener: (me: IOAgent) => void): void;
  onSensing(listener: (sensing: IOSensing) => void): void;
  disconnect(): void;
}

export interface GameConnection {
  /** Resolves once config + map + you have all been received; rejects on timeout. */
  ready(timeoutMs?: number): Promise<void>;
  isReady(): boolean;
  config(): IOConfig | undefined;
  map(): GameMapData | undefined;
  me(): IOAgent | undefined;
  onSensing(listener: (sensing: IOSensing) => void): void;
  disconnect(): void;
}

export interface ConnectOptions {
  readonly host: string;
  readonly token: string | undefined;
  readonly name: string | undefined;
}

export function createConnection(socket: DjsSocketLike): GameConnection {
  let config: IOConfig | undefined;
  let map: GameMapData | undefined;
  let me: IOAgent | undefined;
  const seen = { config: false, map: false, you: false };
  const waiters = new Set<() => void>();

  const isReady = (): boolean => seen.config && seen.map && seen.you;

  const settle = (): void => {
    if (!isReady()) {
      return;
    }
    for (const wake of waiters) {
      wake();
    }
    waiters.clear();
  };

  socket.onConfig((next) => {
    config = next;
    seen.config = true;
    settle();
  });
  socket.onMap((width, height, tiles) => {
    map = { width, height, tiles };
    seen.map = true;
    settle();
  });
  socket.onYou((next) => {
    me = next;
    seen.you = true;
    settle();
  });

  return {
    isReady,
    config: () => config,
    map: () => map,
    me: () => me,
    onSensing: (listener) => socket.onSensing(listener),
    disconnect: () => socket.disconnect(),
    ready: (timeoutMs) =>
      new Promise<void>((resolve, reject) => {
        if (isReady()) {
          resolve();
          return;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const wake = (): void => {
          if (timer !== undefined) {
            clearTimeout(timer);
          }
          resolve();
        };
        waiters.add(wake);
        if (timeoutMs !== undefined) {
          timer = setTimeout(() => {
            waiters.delete(wake);
            reject(
              new SensingError(
                `game connection not ready within ${timeoutMs}ms ` +
                  `(config=${seen.config} map=${seen.map} you=${seen.you})`,
              ),
            );
          }, timeoutMs);
        }
      }),
  };
}

/** Connect to the game server and wrap the socket. Used by live runs. */
export function connectToGame(options: ConnectOptions): GameConnection {
  const socket = DjsConnect(options.host, options.token, options.name, true);
  return createConnection(socket);
}
