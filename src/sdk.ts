import { DjsConnect } from "@unitn-asa/deliveroo-js-sdk";
import type { IOAgent } from "@unitn-asa/deliveroo-js-sdk/types/IOAgent.js";
import type { IOConfig } from "@unitn-asa/deliveroo-js-sdk/types/IOConfig.js";
import type { IOParcel } from "@unitn-asa/deliveroo-js-sdk/types/IOParcel.js";
import type { IOSensing } from "@unitn-asa/deliveroo-js-sdk/types/IOSensing.js";
import type { IOTile } from "@unitn-asa/deliveroo-js-sdk/types/IOTile.js";
import { log } from "./log.js";

export type { IOAgent, IOConfig, IOParcel, IOSensing, IOTile };

export type Direction = Parameters<
  ReturnType<typeof DjsConnect>["emitMove"]
>[0];

export const DIRECTIONS = [
  "up",
  "right",
  "down",
  "left",
] as const satisfies readonly Direction[];

export interface Position {
  x: number;
  y: number;
}

export interface Parcel {
  id: string;
}

export interface Message {
  from: { id: string; name: string };
  payload: unknown;
  // Present only when the sender used `ask`, and the server stops waiting for it after a second
  reply?: ((value: object) => void) | undefined;
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
  onTile(listener: (tile: IOTile) => void): void;
  onSensing(listener: (sensing: IOSensing) => void): void;
  emitMove(direction: Direction): Promise<Position | false>;
  emitPickup(): Promise<Parcel[]>;
  emitPutdown(selected?: string[]): Promise<Parcel[]>;
  // Both answer 'successful'; emitShout is typed `Promise<{any}>` (DjsClientSocket.js:192).
  emitSay(toId: string, payload: unknown): Promise<unknown>;
  emitAsk(toId: string, payload: unknown): Promise<unknown>;
  emitShout(payload: unknown): Promise<unknown>;
  onMsg(
    listener: (
      fromId: string,
      fromName: string,
      payload: unknown,
      reply?: (value: object) => void,
    ) => void,
  ): void;
  disconnect(): void;
}

export interface Connection {
  /** Resolves once the map, the config and a spawned (positioned) `you` have arrived. */
  ready(): Promise<World>;
  /** Latest `you` snapshot; `undefined` until the first one arrives. */
  me(): IOAgent | undefined;
  /** A tile changed type after the initial map. */
  onTile(listener: (tile: IOTile) => void): void;
  /** Everything in range right now; what a snapshot omits is out of sight, not gone. */
  onSensing(listener: (sensing: IOSensing) => void): void;
  /** Position on success, `false` if the server refused, `undefined` if the ack was lost. */
  move(direction: Direction): Promise<Position | false | undefined>;
  pickup(): Promise<Parcel[] | undefined>;
  putdown(ids?: string[]): Promise<Parcel[] | undefined>;
  /** `true` once the server has taken the message, `undefined` if it never answered. */
  say(toId: string, payload: unknown): Promise<boolean | undefined>;
  /** The answer, or `undefined`: unanswered, too late and no such agent are one case. */
  ask(toId: string, payload: unknown): Promise<unknown>;
  /** Heard by every connected agent, opponents included. */
  shout(payload: unknown): Promise<boolean | undefined>;
  /** Every `say`, `ask` and `shout` addressed to us, whoever sent it. */
  onMessage(listener: (message: Message) => void): void;
  disconnect(): void;
}

type Settled<T> =
  | { ok: true; value: T | undefined }
  | { ok: false; error: unknown };

// socket.io rejects a pending ack on timeout and on disconnect (socket.js:306 and :487);
// both mean the action may well have run, and neither carries a name or code to match on.
const LOST_ACK = /timed out|has been disconnected/i;

const READY_TIMEOUT_MS = 10_000;

const SPEECH_TIMEOUT_MS = 1_000;

// The server already gives the recipient a second, so this only catches a lost ack.
const ASK_TIMEOUT_MS = 2_000;

// Chat emits carry no ack timeout of their own, so an unanswered say never returns.
function deadline<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout>;
  const expired = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

// DjsConnect defaults every argument to HOST / TOKEN / NAME in the environment.
export function connect(socket: GameSocket = DjsConnect()): Connection {
  let latest: IOAgent | undefined;
  let penalty = 0;
  let config: IOConfig | undefined;

  const awaiting = new Set(["you", "map", "config"]);
  function arrived<T>(name: string, value: T): T {
    if (awaiting.delete(name)) log.info({ event: name }, "arrived");
    return value;
  }

  const configured = new Promise<IOConfig>((resolve) => {
    socket.onConfig((next) => {
      config = next;
      resolve(arrived("config", next));
    });
  });

  // `you` arrives before the agent spawns, without coordinates, so wait for a positioned one.
  const spawned = new Promise<IOAgent>((resolve) => {
    socket.onYou((next) => {
      latest = next;
      if (next.penalty < penalty) {
        log.warn(
          { penalty: next.penalty, charged: penalty - next.penalty },
          "penalised",
        );
        penalty = next.penalty;
      }
      if (next.x !== undefined && next.y !== undefined)
        resolve(arrived("you", next));
    });
  });

  const mapped = new Promise<IOTile[]>((resolve) =>
    socket.onMap((_width, _height, tiles) => resolve(arrived("map", tiles))),
  );

  let timer: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `ready timed out after ${READY_TIMEOUT_MS}ms without ${[...awaiting].join(", ")}`,
        ),
      );
    }, READY_TIMEOUT_MS);
  });

  const world = Promise.race([
    Promise.all([spawned, mapped, configured]).then(([me, tiles, config]) => ({
      me,
      tiles,
      config,
    })),
    expired,
    // An armed timer would hold node open for the full timeout after a clean ready.
  ]).finally(() => clearTimeout(timer));

  const audience = new Set<(message: Message) => void>();

  socket.onMsg((fromId, fromName, payload, reply) => {
    log.info(
      { from: fromName, id: fromId, payload, ask: reply !== undefined },
      "heard",
    );
    const message = { from: { id: fromId, name: fromName }, payload, reply };
    for (const listener of audience) listener(message);
  });

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

  async function speak(
    fields: Record<string, unknown>,
    run: () => Promise<unknown>,
  ): Promise<boolean | undefined> {
    const status = await deadline(run(), SPEECH_TIMEOUT_MS);
    if (status === undefined) {
      log.warn(fields, "never acknowledged");
      return undefined;
    }
    log.info({ ...fields, status }, "said");
    return status === "successful";
  }

  async function question(toId: string, payload: unknown): Promise<unknown> {
    const fields = { action: "ask", to: toId, payload };
    const reply = await deadline(socket.emitAsk(toId, payload), ASK_TIMEOUT_MS);
    // The server answers 'timeout' for a recipient that stayed silent, was late, or never existed.
    if (reply === undefined || reply === "timeout") {
      log.warn(fields, "unanswered");
      return undefined;
    }
    log.info({ ...fields, reply }, "asked");
    return reply;
  }

  return {
    ready: () => world,
    me: () => latest,
    onTile: (listener) => socket.onTile(listener),
    onSensing: (listener) => socket.onSensing(listener),
    move: (direction) =>
      action({ action: "move", direction }, () => socket.emitMove(direction)),
    pickup: () => action({ action: "pickup" }, () => socket.emitPickup()),
    putdown: (ids) =>
      action({ action: "putdown", ids }, () => socket.emitPutdown(ids)),
    say: (toId, payload) =>
      speak({ action: "say", to: toId, payload }, () =>
        socket.emitSay(toId, payload),
      ),
    ask: question,
    shout: (payload) =>
      speak({ action: "shout", payload }, () => socket.emitShout(payload)),
    onMessage: (listener) => {
      audience.add(listener);
    },
    disconnect: () => socket.disconnect(),
  };
}
