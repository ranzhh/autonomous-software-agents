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
import type {
  Direction,
  IOAgent,
  IOConfig,
  IOSensing,
  IOTile,
  PickedParcel,
  Position,
} from "./types.js";

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
  emitMove(direction: Direction): Promise<Position | false>;
  emitPickup(): Promise<PickedParcel[]>;
  emitPutdown(selected?: string[]): Promise<PickedParcel[]>;
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
  /** Move one tile; resolves to the new position, or `false` if the tile was occupied. */
  emitMove(direction: Direction): Promise<Position | false>;
  /** Pick up every uncarried parcel on the current tile; resolves to the picked parcels. */
  emitPickup(): Promise<readonly PickedParcel[]>;
  /** Put down parcels (omit/`[]` drops ALL); resolves to the dropped parcels. */
  emitPutdown(selected?: readonly string[]): Promise<readonly PickedParcel[]>;
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

  // The SDK wraps every client emit in a hardcoded 1s Socket.IO ack timeout
  // (DjsClientSocket `this.timeout(1000).emitWithAck(...)`). On a slow server
  // or VPN the round-trip exceeds it and the promise REJECTS with "operation
  // has timed out" even though the move usually executed server-side (beliefs
  // stay truthful via onYou). Treat that rejection as a blocked move (`false`)
  // so plans take their existing wait-and-retry path instead of aborting —
  // live runs 2026-07-09/10 showed the agent near-inert without this.
  const isAckTimeout = (error: unknown): boolean =>
    error instanceof Error && error.message.toLowerCase().includes("timed out");

  return {
    isReady,
    config: () => config,
    map: () => map,
    me: () => me,
    onSensing: (listener) => socket.onSensing(listener),
    emitMove: async (direction) => {
      try {
        return await socket.emitMove(direction);
      } catch (error) {
        if (isAckTimeout(error)) return false;
        throw error;
      }
    },
    emitPickup: () => socket.emitPickup(),
    emitPutdown: (selected) =>
      socket.emitPutdown(selected === undefined ? undefined : [...selected]),
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
