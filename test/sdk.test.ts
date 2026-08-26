import { describe, expect, test, vi } from "vitest";
import { log } from "../src/log.js";
import {
  connect,
  type GameSocket,
  type IOAgent,
  type IOConfig,
  type IOTile,
  type Message,
} from "../src/sdk.js";

const timedOut = (): never => {
  throw new Error("operation has timed out");
};

const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

const agent = (position?: Position): IOAgent => ({
  id: "a",
  name: "tester",
  teamId: "t",
  teamName: "team",
  score: 0,
  penalty: 0,
  ...position,
});

interface Position {
  x: number;
  y: number;
}

const configWith = (movementDuration: number): IOConfig =>
  ({
    GAME: { player: { movement_duration: movementDuration } },
  }) as unknown as IOConfig;

const tiles: IOTile[] = [{ x: 0, y: 0, type: "3" }];

function fakeSocket(overrides: Partial<GameSocket> = {}): GameSocket {
  return {
    onConfig: (listener) => listener(configWith(0)),
    onYou: (listener) => listener(agent({ x: 1, y: 2 })),
    onMap: (listener) => listener(1, 1, tiles),
    emitMove: async () => ({ x: 0, y: 0 }),
    emitPickup: async () => [],
    emitPutdown: async () => [],
    emitSay: async () => "successful",
    emitAsk: async () => ({ answered: true }),
    emitShout: async () => "successful",
    onMsg: () => {},
    disconnect: () => {},
    ...overrides,
  };
}

describe("ready", () => {
  test("resolves with the map, the config and a positioned agent", async () => {
    const world = await connect(fakeSocket()).ready();
    expect(world.me).toMatchObject({ x: 1, y: 2 });
    expect(world.tiles).toEqual(tiles);
    expect(world.config.GAME.player.movement_duration).toBe(0);
  });

  test("waits past an unpositioned `you` for the spawned one", async () => {
    let emit: ((me: IOAgent) => void) | undefined;
    const game = connect(
      fakeSocket({ onYou: (listener) => (emit = listener) }),
    );

    let world: unknown;
    void game.ready().then((next) => (world = next));

    emit?.(agent());
    await tick();
    expect(world).toBeUndefined();
    expect(game.me()).toMatchObject({ name: "tester" });

    emit?.(agent({ x: 4, y: 5 }));
    await tick();
    expect(world).toMatchObject({ me: { x: 4, y: 5 } });
  });

  test("returns the same world to every caller", async () => {
    const game = connect(fakeSocket());
    expect(await game.ready()).toBe(await game.ready());
  });

  test("names the events that never arrived when it times out", async () => {
    vi.useFakeTimers();
    const game = connect(fakeSocket({ onMap: () => {}, onConfig: () => {} }));

    const failed = expect(game.ready()).rejects.toThrow(
      "ready timed out after 10000ms without map, config",
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await failed;
    vi.useRealTimers();
  });
});

describe("penalties", () => {
  function charging(...penalties: number[]) {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    let emit: ((me: IOAgent) => void) | undefined;
    connect(fakeSocket({ onYou: (listener) => (emit = listener) }));
    for (const penalty of penalties)
      emit?.({ ...agent({ x: 1, y: 2 }), penalty });
    const reported = warn.mock.calls.map(([fields]) => fields);
    warn.mockRestore();
    return reported;
  }

  test("reports every charge and where it leaves the agent", () => {
    expect(charging(0, -1, -4)).toEqual([
      { penalty: -1, charged: 1 },
      { penalty: -4, charged: 3 },
    ]);
  });

  test("stays quiet while the penalty holds", () => {
    expect(charging(0, 0, 0)).toEqual([]);
  });

  test("reports a penalty already charged before the process started", () => {
    expect(charging(-76)).toEqual([{ penalty: -76, charged: 76 }]);
  });
});

describe("action serialization", () => {
  test("does not start an action while another is in flight", async () => {
    const events: string[] = [];
    let release: (() => void) | undefined;
    const game = connect(
      fakeSocket({
        emitMove: async (direction) => {
          events.push(`start ${direction}`);
          if (direction === "up") {
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
          events.push(`end ${direction}`);
          return { x: 0, y: 0 };
        },
      }),
    );

    const first = game.move("up");
    const second = game.move("down");
    await tick();
    expect(events).toEqual(["start up"]);

    release?.();
    await Promise.all([first, second]);
    expect(events).toEqual(["start up", "end up", "start down", "end down"]);
  });

  test("keeps serving actions after one rejects", async () => {
    let calls = 0;
    const game = connect(
      fakeSocket({
        emitMove: async () => {
          calls += 1;
          if (calls === 1) throw new Error("socket closed");
          return { x: 1, y: 1 };
        },
      }),
    );

    await expect(game.move("up")).rejects.toThrow("socket closed");
    await expect(game.move("down")).resolves.toEqual({ x: 1, y: 1 });
  });
});

describe("lost acks", () => {
  test("resolves undefined on an ack timeout", async () => {
    const game = connect(fakeSocket({ emitMove: timedOut }));
    await expect(game.move("up")).resolves.toBeUndefined();
  });

  test("resolves undefined on a mid-action disconnect", async () => {
    const game = connect(
      fakeSocket({
        emitMove: () => {
          throw new Error("socket has been disconnected");
        },
      }),
    );
    await expect(game.move("up")).resolves.toBeUndefined();
  });

  test("distinguishes a lost pickup from an empty one", async () => {
    await expect(connect(fakeSocket()).pickup()).resolves.toEqual([]);
    const lost = connect(fakeSocket({ emitPickup: timedOut }));
    await expect(lost.pickup()).resolves.toBeUndefined();
  });

  test("propagates errors that are not lost acks", async () => {
    const game = connect(
      fakeSocket({
        emitMove: () => {
          throw new Error("socket closed");
        },
      }),
    );
    await expect(game.move("up")).rejects.toThrow("socket closed");
  });

  test("holds the next action for movement_duration", async () => {
    const game = connect(
      fakeSocket({
        onConfig: (listener) => listener(configWith(50)),
        emitMove: async (direction) => {
          if (direction === "up") timedOut();
          return { x: 1, y: 1 };
        },
      }),
    );

    const startedAt = Date.now();
    await game.move("up");
    await game.move("down");
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(45);
  });

  test("cools down even when the config arrives after the action", async () => {
    let emit: ((config: IOConfig) => void) | undefined;
    const game = connect(
      fakeSocket({
        onConfig: (listener) => (emit = listener),
        emitMove: timedOut,
      }),
    );

    let settled = false;
    const move = game.move("up").then(() => (settled = true));

    await tick();
    expect(settled).toBe(false);

    emit?.(configWith(0));
    await move;
    expect(settled).toBe(true);
  });
});

describe("delegation", () => {
  test("forwards the selected ids to putdown", async () => {
    const seen: (string[] | undefined)[] = [];
    const game = connect(
      fakeSocket({
        emitPutdown: async (selected) => {
          seen.push(selected);
          return [];
        },
      }),
    );

    await game.putdown(["p1", "p2"]);
    await game.putdown();
    expect(seen).toEqual([["p1", "p2"], undefined]);
  });

  test("forwards disconnect", () => {
    let closed = false;
    connect(fakeSocket({ disconnect: () => (closed = true) })).disconnect();
    expect(closed).toBe(true);
  });
});

describe("incoming messages", () => {
  const listening = (): {
    game: ReturnType<typeof connect>;
    heard: Message[];
    arrive: Parameters<GameSocket["onMsg"]>[0];
  } => {
    let arrive: Parameters<GameSocket["onMsg"]>[0] | undefined;
    const game = connect(
      fakeSocket({ onMsg: (listener) => (arrive = listener) }),
    );
    const heard: Message[] = [];
    game.onMessage((message) => heard.push(message));
    if (!arrive) throw new Error("connect never subscribed to msg");
    return { game, heard, arrive };
  };

  test("names the sender and keeps the payload whole", () => {
    const { heard, arrive } = listening();

    arrive("b", "mate", { kind: "hello", at: { x: 1, y: 2 } });

    expect(heard).toEqual([
      {
        from: { id: "b", name: "mate" },
        payload: { kind: "hello", at: { x: 1, y: 2 } },
        reply: undefined,
      },
    ]);
  });

  test("carries the reply of an `ask`, and only of an `ask`", () => {
    const { heard, arrive } = listening();
    const answered = vi.fn();

    arrive("b", "mate", "where are you?", answered);
    arrive("b", "mate", "just telling you");

    heard[0]?.reply?.({ x: 1, y: 2 });
    expect(answered).toHaveBeenCalledWith({ x: 1, y: 2 });
    expect(heard[1]?.reply).toBeUndefined();
  });

  test("serves every listener", () => {
    const { game, heard, arrive } = listening();
    game.onMessage((message) => heard.push(message));

    arrive("b", "mate", "twice");

    expect(heard).toHaveLength(2);
    expect(heard[0]).toBe(heard[1]);
  });
});

describe("outgoing messages", () => {
  test("reports a say the server took, and what it was given", async () => {
    const sent: unknown[] = [];
    const game = connect(
      fakeSocket({
        emitSay: async (toId, payload) => {
          sent.push([toId, payload]);
          return "successful";
        },
      }),
    );

    await expect(game.say("b", { kind: "hello" })).resolves.toBe(true);
    expect(sent).toEqual([["b", { kind: "hello" }]]);
  });

  test("reports a shout the server took", async () => {
    const sent: unknown[] = [];
    const game = connect(
      fakeSocket({
        emitShout: async (payload) => {
          sent.push(payload);
          return "successful";
        },
      }),
    );

    await expect(game.shout("anyone there?")).resolves.toBe(true);
    expect(sent).toEqual(["anyone there?"]);
  });

  test("gives up on an emit that never settles", async () => {
    vi.useFakeTimers();
    const game = connect(fakeSocket({ emitSay: () => new Promise(() => {}) }));

    const said = game.say("b", "hello?");
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(said).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  test("does not wait for an action in flight", async () => {
    const game = connect(fakeSocket({ emitMove: () => new Promise(() => {}) }));

    const moved = game.move("up");
    await expect(game.say("b", "still talking")).resolves.toBe(true);
    expect(moved).toBeInstanceOf(Promise);
  });
});

describe("asking", () => {
  test("resolves with the answer", async () => {
    const asked: unknown[] = [];
    const game = connect(
      fakeSocket({
        emitAsk: async (toId, payload) => {
          asked.push([toId, payload]);
          return { at: { x: 1, y: 2 } };
        },
      }),
    );

    await expect(game.ask("b", { q: "where?" })).resolves.toEqual({
      at: { x: 1, y: 2 },
    });
    expect(asked).toEqual([["b", { q: "where?" }]]);
  });

  test("reads the server's `timeout` as no answer", async () => {
    const game = connect(fakeSocket({ emitAsk: async () => "timeout" }));
    await expect(game.ask("b", "?")).resolves.toBeUndefined();
  });

  test("gives up on an emit that never settles", async () => {
    vi.useFakeTimers();
    const game = connect(fakeSocket({ emitAsk: () => new Promise(() => {}) }));

    const asked = game.ask("b", "?");
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(asked).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  test("does not wait for an action in flight", async () => {
    const game = connect(fakeSocket({ emitMove: () => new Promise(() => {}) }));

    void game.move("up");
    await expect(game.ask("b", "?")).resolves.toEqual({ answered: true });
  });
});
