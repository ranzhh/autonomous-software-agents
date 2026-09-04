import { createHmac, randomBytes } from "node:crypto";
import { log } from "./log.js";
import { type Connection, fields } from "./sdk.js";

const HELLO_MS = 2_000;

interface Greeting {
  asa: "hello" | "hi";
  nonce: string;
  mac: string;
}

interface Note {
  asa: "note";
  payload: unknown;
}

export interface Mate {
  id: string;
  name: string;
}

export interface Team {
  /** The teammate, once a greeting of theirs has verified. */
  mate(): Mate | undefined;
  /** Unicast to the teammate; dropped before the handshake, never awaited. */
  tell(payload: unknown): void;
  /** Payloads from the teammate. Nothing else on the channel reaches here. */
  onTell(listener: (payload: unknown) => void): void;
}

const tag = (secret: string, id: string, nonce: string): string =>
  createHmac("sha256", secret).update(`${id}:${nonce}`).digest("base64url");

function greeting(payload: unknown): Greeting | undefined {
  const record = fields(payload);
  if (record === undefined) return undefined;
  const { asa, nonce, mac } = record;
  if (asa !== "hello" && asa !== "hi") return undefined;
  if (typeof nonce !== "string" || typeof mac !== "string") return undefined;
  return { asa, nonce, mac };
}

function note(payload: unknown): Note | undefined {
  const record = fields(payload);
  if (record?.asa !== "note") return undefined;
  return { asa: "note", payload: record.payload };
}

export function team(game: Connection, me: string, secret: string): Team {
  const nonce = randomBytes(8).toString("base64url");
  const mac = tag(secret, me, nonce);
  const listeners = new Set<(payload: unknown) => void>();
  let mate: Mate | undefined;

  game.onMessage(({ from, payload }) => {
    const greeted = greeting(payload);
    if (greeted !== undefined) {
      if (tag(secret, from.id, greeted.nonce) !== greeted.mac) return;
      if (mate?.id !== from.id) {
        mate = { id: from.id, name: from.name };
        log.info(mate, "teamed");
      }
      if (greeted.asa === "hello")
        void game.say(from.id, { asa: "hi", nonce, mac });
      return;
    }
    if (from.id !== mate?.id) return;
    const told = note(payload);
    if (told !== undefined)
      for (const listener of listeners) listener(told.payload);
  });

  const greet = (): void => {
    if (mate === undefined) void game.shout({ asa: "hello", nonce, mac });
  };
  setInterval(greet, HELLO_MS).unref();
  greet();

  return {
    mate: () => mate,
    tell: (payload) => {
      if (mate !== undefined) void game.say(mate.id, { asa: "note", payload });
    },
    onTell: (listener) => {
      listeners.add(listener);
    },
  };
}
