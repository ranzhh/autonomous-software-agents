import { describe, expect, test, vi } from "vitest";
import {
  type Connection,
  connect,
  type IOAgent,
  type IOConfig,
  type IOTile,
} from "../src/sdk.js";
import { team } from "../src/team.js";

const SECRET = "shared";

const config = {
  GAME: { player: { movement_duration: 0 } },
} as unknown as IOConfig;
const tiles: IOTile[] = [{ x: 0, y: 0, type: "3" }];
const you = (id: string): IOAgent => ({
  id,
  name: id,
  teamId: "t",
  teamName: "team",
  score: 0,
  penalty: 0,
  x: 0,
  y: 0,
});

type Heard = { from: string; payload: unknown };
type Drop = (from: string, to: string, payload: unknown) => boolean;

interface Wire {
  game: Connection;
  heard: Heard[];
}

/** A server: a say reaches one inbox, a shout reaches every other one. */
function bus(ids: string[], drop: Drop = () => false): Map<string, Wire> {
  const inboxes = new Map<
    string,
    (fromId: string, fromName: string, payload: unknown) => void
  >();
  const wires = new Map<string, Wire>();
  const deliver = (from: string, to: string, payload: unknown): void => {
    if (drop(from, to, payload)) return;
    wires.get(to)?.heard.push({ from, payload });
    inboxes.get(to)?.(from, from, payload);
  };
  for (const id of ids) {
    const game = connect({
      onConfig: (listener) => listener(config),
      onYou: (listener) => listener(you(id)),
      onMap: (listener) => listener(1, 1, tiles),
      onTile: () => {},
      onSensing: () => {},
      onDisconnect: () => {},
      active: false,
      emitMove: async () => ({ x: 0, y: 0 }),
      emitPickup: async () => [],
      emitPutdown: async () => [],
      emitAsk: async () => ({}),
      emitSay: async (toId, payload) => {
        deliver(id, toId, payload);
        return "successful";
      },
      emitShout: async (payload) => {
        for (const other of ids) if (other !== id) deliver(id, other, payload);
        return "successful";
      },
      onMsg: (listener) => inboxes.set(id, listener),
      disconnect: () => {},
    });
    wires.set(id, { game, heard: [] });
  }
  return wires;
}

const gameOf = (wires: Map<string, Wire>, id: string): Connection => {
  const wire = wires.get(id);
  if (!wire) throw new Error(`no wire for ${id}`);
  return wire.game;
};

const heardBy = (wires: Map<string, Wire>, id: string): Heard[] =>
  wires.get(id)?.heard ?? [];

describe("the handshake", () => {
  test("two agents holding the secret pin each other", () => {
    const wires = bus(["a", "b"]);
    const a = team(gameOf(wires, "a"), "a", SECRET);
    const b = team(gameOf(wires, "b"), "b", SECRET);
    expect(a.mate()?.id).toBe("b");
    expect(b.mate()?.id).toBe("a");
  });

  test("it settles in two messages and does not ping-pong", () => {
    const wires = bus(["a", "b"]);
    team(gameOf(wires, "a"), "a", SECRET);
    team(gameOf(wires, "b"), "b", SECRET);
    // a's opening shout, then b's, then a's answer: nothing after it.
    expect(heardBy(wires, "a")).toHaveLength(1);
    expect(heardBy(wires, "b")).toHaveLength(2);
  });

  test("an agent holding a different secret is ignored by both", () => {
    const wires = bus(["a", "b", "c"]);
    const a = team(gameOf(wires, "a"), "a", SECRET);
    const b = team(gameOf(wires, "b"), "b", SECRET);
    const c = team(gameOf(wires, "c"), "c", "guessed");
    expect(c.mate()).toBeUndefined();
    expect(a.mate()?.id).toBe("b");
    expect(b.mate()?.id).toBe("a");
  });

  test("a captured greeting replayed by somebody else does not verify", () => {
    const wires = bus(["a", "b", "c"]);
    team(gameOf(wires, "a"), "a", SECRET);
    const b = team(gameOf(wires, "b"), "b", SECRET);
    const captured = heardBy(wires, "c").find(({ from }) => from === "a");
    expect(captured).toBeDefined();

    void gameOf(wires, "c").shout(captured?.payload);

    // The tag covers the id the server stamps, so c's copy of a's greeting is not a's.
    expect(b.mate()?.id).toBe("a");
  });

  test("a lost answer is recovered by the next shout", () => {
    vi.useFakeTimers();
    try {
      let lost = 0;
      const wires = bus(["a", "b"], (from, to, payload) => {
        const kind = (payload as { asa?: unknown }).asa;
        return from === "a" && to === "b" && kind === "hi" && lost++ === 0;
      });
      const a = team(gameOf(wires, "a"), "a", SECRET);
      const b = team(gameOf(wires, "b"), "b", SECRET);
      expect(a.mate()?.id).toBe("b");
      expect(b.mate()).toBeUndefined();

      vi.advanceTimersByTime(2_000);
      expect(b.mate()?.id).toBe("a");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the channel", () => {
  test("carries a payload to the teammate", () => {
    const wires = bus(["a", "b"]);
    const a = team(gameOf(wires, "a"), "a", SECRET);
    const b = team(gameOf(wires, "b"), "b", SECRET);
    const seen: unknown[] = [];
    b.onTell((payload) => seen.push(payload));

    a.tell({ parcels: ["p0"] });

    expect(seen).toEqual([{ parcels: ["p0"] }]);
    expect(b.mate()?.id).toBe("a");
  });

  test("drops a note from anyone but the teammate", () => {
    const wires = bus(["a", "b", "c"]);
    team(gameOf(wires, "a"), "a", SECRET);
    const b = team(gameOf(wires, "b"), "b", SECRET);
    const seen: unknown[] = [];
    b.onTell((payload) => seen.push(payload));

    void gameOf(wires, "c").say("b", { asa: "note", payload: "spoofed" });

    expect(seen).toEqual([]);
  });

  test("drops a payload the protocol did not shape", () => {
    const wires = bus(["a", "b"]);
    const a = team(gameOf(wires, "a"), "a", SECRET);
    const b = team(gameOf(wires, "b"), "b", SECRET);
    const seen: unknown[] = [];
    b.onTell((payload) => seen.push(payload));

    // A mission arrives on this channel as a bare string.
    void gameOf(wires, "a").say("b", "Go to (19,19) for 1000pts");
    a.tell("mine");

    expect(seen).toEqual(["mine"]);
  });

  test("says nothing before the handshake", () => {
    const wires = bus(["a", "b"]);
    const a = team(gameOf(wires, "a"), "a", SECRET);
    heardBy(wires, "b").length = 0;

    a.tell("early");

    expect(a.mate()).toBeUndefined();
    expect(heardBy(wires, "b")).toEqual([]);
  });
});
