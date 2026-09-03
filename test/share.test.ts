import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { believe } from "../src/beliefs.js";
import type { IOAgent, IOConfig, IOParcel, IOSensing } from "../src/sdk.js";
import { sharing, type Told } from "../src/share.js";
import type { Mate, Team } from "../src/team.js";

const me = (id: string): IOAgent => ({
  id,
  name: id,
  teamId: "t",
  teamName: "team",
  score: 0,
  penalty: 0,
  x: 0,
  y: 0,
});

const config = {
  CLOCK: 50,
  GAME: {
    parcels: { decaying_event: "1s" },
    player: { observation_distance: 5 },
  },
} as unknown as IOConfig;

const world = (id: string) => ({
  me: me(id),
  tiles: [{ x: 0, y: 0, type: "3" as const }],
  config,
});

const sensing = (partial: Partial<IOSensing>): IOSensing => ({
  positions: [],
  agents: [],
  parcels: [],
  crates: [],
  ...partial,
});

interface Wired {
  team: Team;
  sent: unknown[];
}

/** Two Teams whose tell reaches the other's listeners, with the traffic recorded. */
function link(): { a: Wired; b: Wired } {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const build = (self: string, other: Mate): Wired => {
    const sent: unknown[] = [];
    listeners.set(self, new Set());
    return {
      sent,
      team: {
        mate: () => other,
        tell: (payload) => {
          sent.push(payload);
          for (const listener of listeners.get(other.id) ?? [])
            listener(payload);
        },
        onTell: (listener) => {
          listeners.get(self)?.add(listener);
        },
      },
    };
  };
  return {
    a: build("a", { id: "b", name: "b" }),
    b: build("b", { id: "a", name: "a" }),
  };
}

const telling =
  (taken: string[]): (() => Told) =>
  () => ({
    taken,
    stops: [],
    going: undefined,
  });
const none = telling([]);

const parcel = {
  id: "p1",
  x: 5,
  y: 5,
  reward: 40,
  carriedBy: null,
} as unknown as IOParcel;

describe("what the teammate is going for", () => {
  // A report is stamped on arrival, so the clock has to be the same on both sides.
  const at = <T>(now: number, act: () => T): T => {
    vi.setSystemTime(now);
    return act();
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("the claims ride on the report and expire with it", () => {
    const { a, b } = link();
    const theirs = sharing(b.team, believe(world("b")), none);
    const mine = sharing(a.team, believe(world("a")), telling(["p1", "p2"]));
    at(1_000, () => mine.post(sensing({}), []));

    expect([...theirs.claimed(1_000)]).toEqual(["p1", "p2"]);
    expect([...theirs.claimed(3_000)]).toEqual([]);
  });

  test("an emptied tour releases what it held", () => {
    const { a, b } = link();
    const theirs = sharing(b.team, believe(world("b")), none);
    let going = ["p1"];
    const mine = sharing(a.team, believe(world("a")), () => ({
      ...telling(going)(),
    }));
    at(1_000, () => mine.post(sensing({}), []));
    going = [];
    at(1_300, () => mine.post(sensing({}), []));

    expect([...theirs.claimed(1_300)]).toEqual([]);
  });
});

describe("sharing a frame", () => {
  test("a parcel one agent sees reaches the other's beliefs", () => {
    const { a, b } = link();
    const theirs = believe(world("b"));
    sharing(b.team, theirs, none);
    const mine = believe(world("a"));
    sharing(a.team, mine, none).post(sensing({ parcels: [parcel] }), [], 1_000);

    expect(theirs.parcels()).toMatchObject([{ id: "p1", x: 5, y: 5 }]);
  });

  test("carries the agents it can see, and never the teammate itself", () => {
    const { a, b } = link();
    const theirs = believe(world("b"));
    sharing(b.team, theirs, none);
    const mine = sharing(a.team, believe(world("a")), none);
    mine.post(
      sensing({
        agents: [
          { ...me("b"), x: 4, y: 4 },
          { ...me("rival"), x: 7, y: 2 },
        ],
      }),
      [],
    );

    expect(
      theirs
        .agents()
        .map((x) => x.id)
        .sort(),
    ).toEqual(["a", "rival"]);
    expect(theirs.agents().find((x) => x.id === "rival")).toMatchObject({
      x: 7,
      y: 2,
    });
  });

  test("the sender's position arrives even with nothing in view", () => {
    const { a, b } = link();
    const theirs = believe(world("b"));
    sharing(b.team, theirs, none);
    const mine = believe(world("a"));
    mine.moved({ ...me("a"), x: 7, y: 3 });
    sharing(a.team, mine, none).post(sensing({}), [], 1_000);

    expect(theirs.agents()).toMatchObject([{ id: "a", x: 7, y: 3 }]);
  });

  test("`positions` is never forwarded", () => {
    const { a } = link();
    const share = sharing(a.team, believe(world("a")), none);
    share.post(sensing({ positions: [{ x: 0, y: 0 }] }), [], 1_000);

    expect(JSON.stringify(a.sent)).not.toContain("positions");
  });

  test("holds back a second frame inside the window", () => {
    const { a } = link();
    const share = sharing(a.team, believe(world("a")), none);
    share.post(sensing({ parcels: [parcel] }), [], 1_000);
    share.post(sensing({ parcels: [parcel] }), [], 1_100);
    share.post(sensing({ parcels: [parcel] }), [], 1_400);

    expect(a.sent).toHaveLength(2);
  });

  test("a retired parcel is worth a message of its own", () => {
    const { a } = link();
    const share = sharing(a.team, believe(world("a")), none);
    share.post(sensing({}), [], 1_000);
    share.post(sensing({}), ["p1"], 1_050);

    expect(a.sent).toHaveLength(2);
  });

  test("a payload of the wrong shape changes nothing", () => {
    const { a, b } = link();
    const theirs = believe(world("b"));
    sharing(b.team, theirs, none);
    a.team.tell({ sighted: "not a list" });
    a.team.tell("Go to (19,19) for 1000pts");

    expect(theirs.parcels()).toEqual([]);
    expect(theirs.agents()).toEqual([]);
  });
});
