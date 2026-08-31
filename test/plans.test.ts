import { describe, expect, test } from "vitest";
import { decide, naive, pursue } from "../src/plans.js";
import { config, setup } from "./world.js";

describe("the naive plan", () => {
  test("grabs the parcel underfoot", () => {
    const { beliefs, board } = setup(["333"], { x: 1, y: 0 }, [{ x: 1 }]);
    expect(naive(beliefs, board, 0)).toBe("pickup");
  });

  test("carries its load toward a delivery", () => {
    const { beliefs, board } = setup(["233"], { x: 2, y: 0 }, [
      { x: 2, carriedBy: "me" },
    ]);
    expect(naive(beliefs, board, 0)).toBe("left");
  });

  test("drops its load on the delivery", () => {
    const { beliefs, board } = setup(["233"], { x: 0, y: 0 }, [
      { carriedBy: "me" },
    ]);
    expect(naive(beliefs, board, 0)).toBe("putdown");
  });

  test("chases the nearest known parcel", () => {
    const { beliefs, board } = setup(["3333"], { x: 0, y: 0 }, [{ x: 2 }]);
    expect(naive(beliefs, board, 0)).toBe("right");
  });

  test("heads for a spawner when it knows of nothing", () => {
    const { beliefs, board } = setup(["3331"], { x: 0, y: 0 });
    expect(naive(beliefs, board, 0)).toBe("right");
  });

  test("drifts off an empty spawner", () => {
    const { beliefs, board } = setup(["31"], { x: 1, y: 0 });
    expect(naive(beliefs, board, 0)).toBe("left");
  });
});

describe("deliberation", () => {
  const corridor = ["2333333333"];

  test("fetches the nearer parcel when decay eats the richer one", () => {
    const { beliefs, board } = setup(corridor, { x: 3, y: 0 }, [
      { x: 4, reward: 12 },
      { x: 9, reward: 20 },
    ]);
    expect(
      decide(beliefs, board, config, { kind: "explore" }, 0).intention,
    ).toEqual({
      kind: "fetch",
      id: "p0",
    });
  });

  test("holds its target against a challenger inside the margin", () => {
    const { beliefs, board } = setup(corridor, { x: 3, y: 0 }, [
      { x: 4, reward: 10 },
      { x: 5, reward: 13 },
    ]);
    const held = { kind: "fetch", id: "p0" } as const;
    expect(decide(beliefs, board, config, held, 0).intention).toBe(held);
  });

  test("switches when the challenger clears the margin", () => {
    const { beliefs, board } = setup(corridor, { x: 3, y: 0 }, [
      { x: 4, reward: 10 },
      { x: 5, reward: 17 },
    ]);
    const held = { kind: "fetch", id: "p0" } as const;
    expect(decide(beliefs, board, config, held, 0).intention).toEqual({
      kind: "fetch",
      id: "p1",
    });
  });

  test("drops a vanished target", () => {
    const { beliefs, board } = setup(corridor, { x: 3, y: 0 }, [
      { x: 4, reward: 10 },
    ]);
    const held = { kind: "fetch", id: "ghost" } as const;
    expect(decide(beliefs, board, config, held, 0).intention).toEqual({
      kind: "fetch",
      id: "p0",
    });
  });

  test("carries a heavy load home past a distant parcel", () => {
    const { beliefs, board } = setup(corridor, { x: 1, y: 0 }, [
      { x: 1, reward: 30, carriedBy: "me" },
      { x: 9, reward: 10 },
    ]);
    expect(
      decide(beliefs, board, config, { kind: "explore" }, 0).intention,
    ).toEqual({
      kind: "home",
    });
  });

  test("explores when nothing pays", () => {
    const { beliefs, board } = setup(corridor, { x: 3, y: 0 });
    expect(
      decide(beliefs, board, config, { kind: "explore" }, 0).intention,
    ).toEqual({
      kind: "explore",
    });
  });

  test("pursues nothing when the target is gone", () => {
    const { beliefs, board } = setup(corridor, { x: 3, y: 0 });
    expect(pursue({ kind: "fetch", id: "ghost" }, beliefs, board, 0)).toBe(
      undefined,
    );
  });

  test("drops the load at home", () => {
    const { beliefs, board } = setup(corridor, { x: 0, y: 0 }, [
      { carriedBy: "me" },
    ]);
    expect(pursue({ kind: "home" }, beliefs, board, 0)).toBe("putdown");
  });
});

describe("scouting", () => {
  // Delivery at x0; spawners at x3 and x7.
  const arms = ["23313331"];

  test("scouts the near spawner when none was ever seen", () => {
    const { beliefs, board } = setup(arms, { x: 1, y: 0 });
    expect(
      decide(beliefs, board, config, { kind: "explore" }, 0).intention,
    ).toEqual({
      kind: "scout",
      x: 3,
      y: 0,
    });
  });

  test("patrols on to the other spawner after looking at one", () => {
    const { beliefs, board } = setup(arms, { x: 1, y: 0 });
    beliefs.seen(
      { positions: [{ x: 3, y: 0 }], agents: [], parcels: [], crates: [] },
      0,
    );
    expect(
      decide(beliefs, board, config, { kind: "explore" }, 0).intention,
    ).toEqual({
      kind: "scout",
      x: 7,
      y: 0,
    });
  });

  test("fetches a known parcel over scouting for a likely one", () => {
    const { beliefs, board } = setup(arms, { x: 1, y: 0 }, [
      { x: 2, reward: 30 },
    ]);
    expect(
      decide(beliefs, board, config, { kind: "explore" }, 0).intention,
    ).toEqual({
      kind: "fetch",
      id: "p0",
    });
  });
});
