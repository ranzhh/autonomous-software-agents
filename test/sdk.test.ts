import { describe, expect, test, vi } from "vitest";
import {
  connect,
  type GameSocket,
  type IOAgent,
  type IOConfig,
  type IOTile,
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
    onDisconnect: () => {},
    active: false,
    emitMove: async () => ({ x: 0, y: 0 }),
    emitPickup: async () => [],
    emitPutdown: async () => [],
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

describe("lost connections", () => {
  function dropping(active: boolean) {
    let drop: (() => void) | undefined;
    const game = connect(
      fakeSocket({ active, onDisconnect: (listener) => (drop = listener) }),
    );
    return { game, drop: () => drop?.() };
  }

  test("tells the caller once socket.io has given up", () => {
    const { game, drop } = dropping(false);
    let lost = false;
    game.onLost(() => (lost = true));
    drop();
    expect(lost).toBe(true);
  });

  test("stays quiet while socket.io is still retrying", () => {
    const { game, drop } = dropping(true);
    let lost = false;
    game.onLost(() => (lost = true));
    drop();
    expect(lost).toBe(false);
  });

  test("stays quiet when disconnect closed it", () => {
    const { game, drop } = dropping(false);
    let lost = false;
    game.onLost(() => (lost = true));
    game.disconnect();
    drop();
    expect(lost).toBe(false);
  });

  test("survives a caller that never registered a listener", () => {
    const { drop } = dropping(false);
    expect(drop).not.toThrow();
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
