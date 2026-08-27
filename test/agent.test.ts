import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { run } from "../src/agent.js";
import { log } from "../src/log.js";
import type { Connection, IOAgent, World } from "../src/sdk.js";

const me = (score: number): IOAgent => ({
  id: "a",
  name: "tester",
  teamId: "t",
  teamName: "team",
  score,
  penalty: 0,
  x: 0,
  y: 0,
});

const world: World = {
  me: me(0),
  tiles: [],
  config: {} as World["config"],
};

const fakeGame = (overrides: Partial<Connection>): Connection =>
  ({
    ready: async () => world,
    me: () => me(0),
    onLost: () => {},
    disconnect: () => {},
    ...overrides,
  }) as Connection;

describe("the runtime", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("hands the brain a ready world", async () => {
    let handed: World | undefined;
    await run(async (_game, w) => {
      handed = w;
    }, fakeGame({}));
    expect(handed).toBe(world);
  });

  test("logs the score every time it changes", async () => {
    const lines: number[] = [];
    vi.spyOn(log, "info").mockImplementation((fields: unknown) => {
      const { score } = fields as { score?: number };
      if (score !== undefined) lines.push(score);
    });

    const scores = [0, 0, 21, 21, 35][Symbol.iterator]();
    await run(
      async () => {},
      fakeGame({ me: () => me(scores.next().value ?? 35) }),
    );
    await vi.advanceTimersByTimeAsync(5_000);

    expect(lines).toEqual([0, 21, 35]);
    vi.restoreAllMocks();
  });
});
