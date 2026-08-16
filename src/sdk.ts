import { DjsConnect } from "@unitn-asa/deliveroo-js-sdk";
import type { IOAgent } from "@unitn-asa/deliveroo-js-sdk/types/IOAgent.js";
import type { IOConfig } from "@unitn-asa/deliveroo-js-sdk/types/IOConfig.js";
import type { IOTile } from "@unitn-asa/deliveroo-js-sdk/types/IOTile.js";

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
  onceYou(listener: (me: IOAgent) => void): void;
  onMap(
    listener: (width: number, height: number, tiles: IOTile[]) => void,
  ): void;
  emitMove(direction: Direction): Promise<Position | false>;
  emitPickup(): Promise<Parcel[]>;
  emitPutdown(selected?: string[]): Promise<Parcel[]>;
  disconnect(): void;
}

export interface Connection {
  /** Resolves once config, map and you have all arrived. */
  ready(): Promise<World>;
  /** Position on success, `false` if the server refused, `undefined` if the ack was lost. */
  move(direction: Direction): Promise<Position | false | undefined>;
  pickup(): Promise<Parcel[] | undefined>;
  putdown(ids?: string[]): Promise<Parcel[] | undefined>;
  disconnect(): void;
}

const ACK_TIMEOUT = /timed out/i;

// DjsConnect defaults every argument to HOST / TOKEN / NAME in the environment.
export function connect(socket: GameSocket = DjsConnect()): Connection {
  let config: IOConfig | undefined;
  const configured = new Promise<IOConfig>((resolve) => {
    socket.onConfig((next) => {
      config = next;
      resolve(next);
    });
  });

  const world = Promise.all([
    new Promise<IOAgent>((resolve) => socket.onceYou(resolve)),
    new Promise<IOTile[]>((resolve) =>
      socket.onMap((_width, _height, tiles) => resolve(tiles)),
    ),
    configured,
  ]).then(([me, tiles, config]) => ({ me, tiles, config }));

  // After a lost ack the server may still be executing; the next action would hit a held mutex.
  function cooldown(): Promise<void> {
    const ms = config?.GAME?.player?.movement_duration ?? 0;
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // The server runs one action mutex per agent: an action issued while another is
  // still running is refused and penalised, so each one queues behind the last.
  let chain: Promise<unknown> = Promise.resolve();

  // The SDK gives every emit a 1s ack timeout that rejects even when the action did
  // execute server-side, so a lost ack is unknown, never "nothing happened".
  function action<T>(run: () => Promise<T>): Promise<T | undefined> {
    const attempt = async (): Promise<T | undefined> => {
      try {
        return await run();
      } catch (error) {
        if (!(error instanceof Error) || !ACK_TIMEOUT.test(error.message)) {
          throw error;
        }
        await cooldown();
        return undefined;
      }
    };
    const issued = chain.then(attempt);
    chain = issued.catch(() => undefined);
    return issued;
  }

  return {
    ready: () => world,
    move: (direction) => action(() => socket.emitMove(direction)),
    pickup: () => action(() => socket.emitPickup()),
    putdown: (ids) => action(() => socket.emitPutdown(ids)),
    disconnect: () => socket.disconnect(),
  };
}
