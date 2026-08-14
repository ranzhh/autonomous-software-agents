/**
 * A typed, readiness-aware wrapper over the SDK socket. The SDK's one-shot
 * `socket.{config,map,me,token}` promises are unreliable (CLAUDE.md §6: `enhance()`
 * copies only prototype methods, so the class field initializers never run), so
 * this builds its world view from our own `onConfig`/`onMap`/`onYou` listeners
 * instead. It exposes `ready()` (resolves once config + map + you have all been
 * seen), latest-value accessors (guarding the optional `IOAgent.x/y`), and the
 * live `sensing` stream.
 *
 * It is also the single choke point for the two action-level server quirks —
 * the SDK's 1s ack timeout and the server's per-agent action mutex — both
 * handled once in `action()` below, which is the only path to the socket.
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
  /**
   * Pick up every uncarried parcel on the current tile. Resolves to the picked
   * parcels, or `undefined` when the ack was lost — the action probably still
   * executed, so callers must treat that as "unknown", never as "took nothing".
   */
  emitPickup(): Promise<readonly PickedParcel[] | undefined>;
  /** Put down parcels (omit/`[]` drops ALL). `undefined` = ack lost, as above. */
  emitPutdown(
    selected?: readonly string[],
  ): Promise<readonly PickedParcel[] | undefined>;
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

  // The SDK wraps every emit in a hardcoded 1s ack timeout
  // (`DjsClientSocket.timeout(1000).emitWithAck`). Above ~1s RTT it rejects
  // with "operation has timed out" even though the action usually executed
  // server-side, so the rejection means "unknown", not "nothing happened".
  const isAckTimeout = (error: unknown): boolean =>
    error instanceof Error && error.message.toLowerCase().includes("timed out");

  // The server runs ONE ActionMutex per agent (backend `deliveroo/Agent.js`):
  // an action issued while another is still running is rejected, costs a
  // penalty, and returns `false` — indistinguishable from "tile occupied" on
  // our side. At -1000 the agent is kicked. Plan preemption cannot cancel an
  // emit already in flight, so every action is queued behind the previous one.
  // → ADR-0008; incident numbers in docs/journal.md 2026-08-14.
  let actionChain: Promise<unknown> = Promise.resolve();

  /** How long the server may still be busy after an ack we never received. */
  function settleAfterLostAck(): Promise<void> {
    const ms = config?.GAME?.player?.movement_duration ?? 0;
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * The only path to the socket: issue `run` once the previous action has
   * settled, and map a lost ack to `onAckTimeout`. Both server quirks live
   * here so a newly added action (say/ask/shout) cannot forget either one.
   */
  function action<T>(run: () => Promise<T>, onAckTimeout: T): Promise<T> {
    const attempt = async (): Promise<T> => {
      try {
        return await run();
      } catch (error) {
        if (!isAckTimeout(error)) throw error;
        // The action is probably still running server-side; releasing the
        // chain now would issue the next one into a held mutex.
        await settleAfterLostAck();
        return onAckTimeout;
      }
    };
    // `.then(attempt, attempt)` runs regardless of how the previous settled;
    // the chain is kept rejection-free and value-free so it neither poisons
    // later actions nor retains the last result.
    const issued = actionChain.then(attempt, attempt);
    actionChain = issued.catch(() => undefined);
    return issued;
  }

  return {
    isReady,
    config: () => config,
    map: () => map,
    me: () => me,
    onSensing: (listener) => socket.onSensing(listener),
    // A timed-out move reads as `false`, the same as a blocked one — plans
    // already wait-and-retry on that, and `GoTo` counts observed progress.
    emitMove: (direction) =>
      action<Position | false>(() => socket.emitMove(direction), false),
    emitPickup: () =>
      action<readonly PickedParcel[] | undefined>(
        () => socket.emitPickup(),
        undefined,
      ),
    emitPutdown: (selected) =>
      action<readonly PickedParcel[] | undefined>(
        () =>
          socket.emitPutdown(
            selected === undefined ? undefined : [...selected],
          ),
        undefined,
      ),
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
