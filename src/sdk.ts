import { DjsConnect } from "@unitn-asa/deliveroo-js-sdk";
import type { IOAgent } from "@unitn-asa/deliveroo-js-sdk/types/IOAgent.js";
import type { IOConfig } from "@unitn-asa/deliveroo-js-sdk/types/IOConfig.js";
import type { IOTile } from "@unitn-asa/deliveroo-js-sdk/types/IOTile.js";
import { log } from "./log.js";

export type { IOAgent, IOConfig, IOTile };

export type Direction = Parameters<
  ReturnType<typeof DjsConnect>["emitMove"]
>[0];

export interface Position {
  x: number;
  y: number;
}

export interface Parcel {
  id: string;
}

export interface World {
  me: IOAgent;
  tiles: IOTile[];
  config: IOConfig;
}

export interface GameSocket {
  onConfig(listener: (config: IOConfig) => void): void;
  onYou(listener: (me: IOAgent) => void): void;
  onMap(
    listener: (width: number, height: number, tiles: IOTile[]) => void,
  ): void;
  emitMove(direction: Direction): Promise<Position | false>;
  emitPickup(): Promise<Parcel[]>;
  emitPutdown(selected?: string[]): Promise<Parcel[]>;
  disconnect(): void;
}

export interface Connection {
  /** Resolves once the map, the config and a spawned (positioned) `you` have arrived. */
  ready(): Promise<World>;
  /** Latest `you` snapshot; `undefined` until the first one arrives. */
  me(): IOAgent | undefined;
  /** Position on success, `false` if the server refused, `undefined` if the ack was lost. */
  move(direction: Direction): Promise<Position | false | undefined>;
  pickup(): Promise<Parcel[] | undefined>;
  putdown(ids?: string[]): Promise<Parcel[] | undefined>;
  disconnect(): void;
}

type Settled<T> =
  | { ok: true; value: T | undefined }
  | { ok: false; error: unknown };

// socket.io rejects a pending ack on timeout and on disconnect (socket.js:306 and :487);
// both mean the action may well have run, and neither carries a name or code to match on.
const LOST_ACK = /timed out|has been disconnected/i;

// DjsConnect defaults every argument to HOST / TOKEN / NAME in the environment.
export function connect(socket: GameSocket = DjsConnect()): Connection {
  let latest: IOAgent | undefined;
  let config: IOConfig | undefined;

  const configured = new Promise<IOConfig>((resolve) => {
    socket.onConfig((next) => {
      config = next;
      resolve(next);
    });
  });

  // `you` arrives before the agent spawns, without coordinates, so wait for a positioned one.
  const spawned = new Promise<IOAgent>((resolve) => {
    socket.onYou((next) => {
      latest = next;
      if (next.x !== undefined && next.y !== undefined) resolve(next);
    });
  });

  const mapped = new Promise<IOTile[]>((resolve) =>
    socket.onMap((_width, _height, tiles) => resolve(tiles)),
  );

  const world = Promise.all([spawned, mapped, configured]).then(
    ([me, tiles, config]) => ({ me, tiles, config }),
  );

  // After a lost ack the server may still be executing; the next action would hit a held mutex.
  async function cooldown(): Promise<void> {
    // could cause issues with the sdk's own 1s timeout
    const ms = (config ?? (await configured)).GAME.player.movement_duration;
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  // The server runs one action mutex per agent: an action issued while another is
  // still running is refused and penalised, so each one queues behind the last.
  let chain: Promise<unknown> = Promise.resolve();

  // The SDK gives every emit a 1s ack timeout that rejects even when the action did
  // execute server-side, so a lost ack is unknown, never "nothing happened".
  function action<T>(
    fields: Record<string, unknown>,
    run: () => Promise<T>,
  ): Promise<T | undefined> {
    const attempt = async (): Promise<Settled<T>> => {
      const startedAt = Date.now();
      const ms = () => Date.now() - startedAt;
      try {
        const value = await run();
        log.info({ ...fields, result: value, ms: ms() }, "acked");
        return { ok: true, value };
      } catch (error) {
        if (!(error instanceof Error) || !LOST_ACK.test(error.message)) {
          log.error({ ...fields, err: error, ms: ms() }, "failed");
          return { ok: false, error };
        }
        log.warn({ ...fields, ms: ms() }, "ack lost, cooling down");
        await cooldown();
        return { ok: true, value: undefined };
      }
    };
    // `attempt` reports failure as a value, so the queue never needs a rejection
    // handler — which would otherwise mark an ignored caller's error as handled.
    const settled = chain.then(attempt);
    chain = settled;
    return settled.then((result) => {
      if (result.ok) return result.value;
      throw result.error;
    });
  }

  return {
    ready: () => world,
    me: () => latest,
    move: (direction) =>
      action({ action: "move", direction }, () => socket.emitMove(direction)),
    pickup: () => action({ action: "pickup" }, () => socket.emitPickup()),
    putdown: (ids) =>
      action({ action: "putdown", ids }, () => socket.emitPutdown(ids)),
    disconnect: () => socket.disconnect(),
  };
}
