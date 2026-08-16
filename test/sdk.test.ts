import { describe, expect, it } from "vitest";
import { connect, type GameSocket, type IOConfig } from "../src/sdk.js";

const timedOut = (): never => {
  throw new Error("operation has timed out");
};

const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

function fakeSocket(overrides: Partial<GameSocket> = {}): GameSocket {
  return {
    onConfig: () => {},
    onceYou: () => {},
    onMap: () => {},
    emitMove: async () => ({ x: 0, y: 0 }),
    emitPickup: async () => [],
    emitPutdown: async () => [],
    disconnect: () => {},
    ...overrides,
  };
}

describe("action serialization", () => {
  it("does not start an action while another is in flight", async () => {
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

  it("keeps serving actions after one rejects", async () => {
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
  it("resolves undefined instead of rejecting", async () => {
    const game = connect(fakeSocket({ emitMove: timedOut }));
    await expect(game.move("up")).resolves.toBeUndefined();
  });

  it("distinguishes a lost pickup from an empty one", async () => {
    await expect(connect(fakeSocket()).pickup()).resolves.toEqual([]);
    const lost = connect(fakeSocket({ emitPickup: timedOut }));
    await expect(lost.pickup()).resolves.toBeUndefined();
  });

  it("propagates errors that are not ack timeouts", async () => {
    const game = connect(
      fakeSocket({
        emitMove: () => {
          throw new Error("socket closed");
        },
      }),
    );
    await expect(game.move("up")).rejects.toThrow("socket closed");
  });

  it("holds the next action for movement_duration", async () => {
    const config = {
      GAME: { player: { movement_duration: 50 } },
    } as unknown as IOConfig;
    const game = connect(
      fakeSocket({
        onConfig: (listener) => listener(config),
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
});
