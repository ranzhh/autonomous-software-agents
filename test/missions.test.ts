import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  type Director,
  farthestTile,
  loadMissions,
  type Mission,
  runMissions,
  type Sensing,
} from "../bench/missions.js";
import type { IOSensing } from "../src/sdk.js";

const file = (content: unknown): string => {
  const path = join(mkdtempSync(join(tmpdir(), "missions-")), "m.json");
  writeFileSync(path, JSON.stringify(content));
  return path;
};

describe("loadMissions", () => {
  test("loads the standard set for a 150 s run, filling the defaults", () => {
    const missions = loadMissions("bench/missions/standard.json", 150);
    expect(missions.map((m) => m.event.kind)).toEqual([
      "deliver",
      "answer",
      "answer",
      "answer",
    ]);
    // A delivery stays open to the end and its parcel outlives the run's decay.
    expect(missions[0]).toMatchObject({
      t: 30,
      window: 120,
      event: { kind: "deliver", parcel: 121 },
    });
  });

  test("rejects what the run could never pay", () => {
    const answer = { kind: "answer", accept: "a" };
    expect(() =>
      loadMissions(
        file([{ t: 140, text: "?", event: answer, reward: 1, window: 20 }]),
        150,
      ),
    ).toThrow(/window runs past/);
    expect(() =>
      loadMissions(
        file([{ t: 150, text: "?", event: answer, reward: 1 }]),
        150,
      ),
    ).toThrow(/outside the run/);
    expect(() =>
      loadMissions(
        file([{ t: 1, text: "here", event: { kind: "deliver" }, reward: 1 }]),
        150,
      ),
    ).toThrow(/\{x\} and \{y\}/);
    expect(() =>
      loadMissions(
        file([{ t: 1, text: "?", event: { kind: "dance" }, reward: 1 }]),
        150,
      ),
    ).toThrow(/event.kind/);
  });

  test("drops the parcel on the free tile farthest from every agent", () => {
    // Three columns: a wall column, a delivery column, and open ground.
    const tiles = [
      ["0", "0", "0"],
      ["2", "2", "2"],
      ["3", "3", "3"],
    ];
    expect(farthestTile(tiles, [{ x: 2, y: 0 }])).toEqual({ x: 2, y: 2 });
    expect(
      farthestTile(tiles, [
        { x: 2, y: 0 },
        { x: 2, y: 2 },
      ]),
    ).toEqual({ x: 2, y: 1 });
    expect(farthestTile([["0"]], [])).toBeUndefined();
  });
});

function fakes(agentIds: string[]) {
  const calls: unknown[][] = [];
  let hear: ((fromId: string, payload: unknown) => void) | undefined;
  const director: Director = {
    shout: (text) => void calls.push(["shout", text]),
    createParcel: (x, y, reward) => void calls.push(["parcel", x, y, reward]),
    reward: (id, points) => void calls.push(["reward", id, points]),
    onMsg: (listener) => {
      hear = listener;
    },
  };
  let snapshot: IOSensing | undefined;
  const listeners = new Set<(s: IOSensing) => void>();
  const sensing: Sensing = {
    latest: () => snapshot,
    on: (listener) => void listeners.add(listener),
  };
  const see = (parcels: object[], scores: number[] = []) => {
    snapshot = {
      parcels,
      agents: agentIds.map((id, i) => ({
        id,
        score: scores[i] ?? 0,
        x: 0,
        y: 0,
      })),
      positions: [],
      crates: [],
    } as unknown as IOSensing;
    for (const listener of listeners) listener(snapshot);
  };
  const events: Record<string, unknown>[] = [];
  const bare = () =>
    events.map((e) => {
      const { t, wall, mission, ...rest } = e;
      return rest;
    });
  return {
    director,
    sensing,
    calls,
    events,
    bare,
    see,
    say: (fromId: string, payload: unknown) => hear?.(fromId, payload),
    log: (e: Record<string, unknown>) => void events.push(e),
    agents: agentIds.map((id) => ({ id, name: id.toUpperCase() })),
    tiles: [["3"]],
    t0: Date.now(),
  };
}

describe("runMissions", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("pays a correct answer once per agent while the window is open", () => {
    const f = fakes(["a", "b"]);
    const m: Mission = {
      t: 10,
      text: "Capital of Italy? {reward} points.",
      event: { kind: "answer", accept: "rome" },
      reward: 100,
      window: 20,
    };
    runMissions({ ...f, missions: [m] });
    f.see([], [7, 0]);
    vi.advanceTimersByTime(9_999);
    expect(f.calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(f.calls).toEqual([["shout", "Capital of Italy? 100 points."]]);

    f.say("a", "It's Rome.");
    f.say("a", "Rome, I said");
    f.say("b", "Milan");
    f.say("b", { asa: "hello" });
    f.say("stranger", "Rome");
    expect(f.calls.slice(1)).toEqual([["reward", "a", 100]]);
    expect(
      f.events.filter((e) => "answered" in e).map((e) => [e.from, e.correct]),
    ).toEqual([
      ["A", true],
      ["A", true],
      ["B", false],
    ]);

    f.see([], [107, 0]);
    expect(f.events.find((e) => "confirmed" in e)).toMatchObject({
      confirmed: "A",
      score: 107,
    });

    vi.advanceTimersByTime(20_000);
    f.say("b", "Rome");
    expect(f.calls.filter((c) => c[0] === "reward")).toHaveLength(1);
    expect(f.events.at(-1)).toMatchObject({ unsolicited: "Rome", from: "B" });
    expect(f.events.find((e) => "closed" in e)).toMatchObject({ rewarded: 1 });
  });

  test("pays whoever delivers the dropped parcel", () => {
    const f = fakes(["a"]);
    runMissions({
      ...f,
      // A 4x5 open map with the agent at 0,0: the far corner is 3,4.
      tiles: Array.from({ length: 4 }, () => Array(5).fill("3")),
      missions: [
        {
          t: 1,
          text: "Parcel at {x},{y}, {reward} on top.",
          event: { kind: "deliver", parcel: 50 },
          reward: 1000,
          window: 60,
        },
      ],
    });
    const old = { id: "p0", x: 3, y: 4, reward: 5, carriedBy: null };
    f.see([old], [0]);
    vi.advanceTimersByTime(1_000);
    expect(f.calls).toEqual([
      ["shout", "Parcel at 3,4, 1000 on top."],
      ["parcel", 3, 4, 50],
    ]);
    const fresh = { id: "p9", x: 3, y: 4, reward: 50, carriedBy: null };
    f.see([old, fresh], [0]);
    f.see([old, { ...fresh, carriedBy: "a" }], [0]);
    f.see([old], [48]);
    f.see([old], [1048]);
    expect(f.calls.slice(2)).toEqual([["reward", "a", 1000]]);
    expect(f.bare().slice(1)).toEqual([
      { spawned: "p9", x: 3, y: 4, parcel: 50 },
      { picked: "p9", by: "A" },
      { delivered: "p9", by: "A", late: false },
      { rewarded: "A", points: 1000, before: 48 },
      { confirmed: "A", score: 1048 },
    ]);
  });

  test("logs but does not pay a delivery after the window closed", () => {
    const f = fakes(["a"]);
    runMissions({
      ...f,
      missions: [
        {
          t: 0,
          text: "{x},{y}",
          event: { kind: "deliver", parcel: 50 },
          reward: 10,
          window: 5,
        },
      ],
    });
    f.see([], [0]);
    vi.advanceTimersByTime(0);
    const p = { id: "p1", x: 0, y: 0, reward: 50, carriedBy: null };
    f.see([p], [0]);
    f.see([{ ...p, carriedBy: "a" }], [0]);
    vi.advanceTimersByTime(5_000);
    f.see([], [50]);
    expect(f.calls.some((c) => c[0] === "reward")).toBe(false);
    expect(f.events.at(-1)).toMatchObject({ delivered: "p1", late: true });
  });

  test("reports a parcel that never appears", () => {
    const f = fakes(["a"]);
    const stop = runMissions({
      ...f,
      missions: [
        {
          t: 0,
          text: "{x},{y}",
          event: { kind: "deliver", parcel: 10 },
          reward: 10,
          window: 30,
        },
      ],
    });
    vi.advanceTimersByTime(0);
    f.see([]);
    vi.advanceTimersByTime(5_000);
    expect(f.events.at(-1)).toMatchObject({ "spawn-failed": true, x: 0, y: 0 });
    stop();
  });
});
