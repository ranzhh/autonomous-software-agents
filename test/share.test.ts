import { describe, expect, test } from "vitest";
import { believe } from "../src/beliefs.js";
import type { IOAgent, IOConfig, IOParcel, IOSensing } from "../src/sdk.js";
import { sharing } from "../src/share.js";
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

const row = Array.from({ length: 8 }, (_, x) => ({
  x,
  y: 0,
  type: "3" as const,
}));

const world = (id: string) => ({ me: me(id), tiles: row, config });

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

const parcel = {
  id: "p1",
  x: 5,
  y: 0,
  reward: 40,
  carriedBy: null,
} as unknown as IOParcel;

describe("sharing a frame", () => {
  test("a parcel one agent sees reaches the other's beliefs", () => {
    const { a, b } = link();
    const theirs = believe(world("b"));
    sharing(b.team, theirs);
    sharing(a.team, believe(world("a")))(sensing({ parcels: [parcel] }), 1_000);

    expect(theirs.parcels(1_000)).toMatchObject([{ id: "p1", x: 5, y: 0 }]);
  });

  test("carries the agents it can see, and never the teammate itself", () => {
    const { a, b } = link();
    const theirs = believe(world("b"));
    sharing(b.team, theirs);
    sharing(a.team, believe(world("a")))(
      sensing({
        agents: [
          { ...me("b"), x: 4, y: 0 },
          { ...me("rival"), x: 7, y: 0 },
        ],
      }),
      1_000,
    );

    expect(
      theirs
        .agents()
        .map((x) => x.id)
        .sort(),
    ).toEqual(["a", "rival"]);
    expect(theirs.agents().find((x) => x.id === "rival")).toMatchObject({
      x: 7,
      y: 0,
    });
  });

  test("the sender's position arrives even with nothing in view", () => {
    const { a, b } = link();
    const theirs = believe(world("b"));
    sharing(b.team, theirs);
    const mine = believe(world("a"));
    mine.moved({ ...me("a"), x: 7, y: 0 });
    sharing(a.team, mine)(sensing({}), 1_000);

    expect(theirs.agents()).toMatchObject([{ id: "a", x: 7, y: 0 }]);
  });

  test("`positions` is never forwarded", () => {
    const { a } = link();
    sharing(a.team, believe(world("a")))(
      sensing({ positions: [{ x: 0, y: 0 }] }),
      1_000,
    );

    expect(JSON.stringify(a.sent)).not.toContain("positions");
  });

  test("a payload of the wrong shape changes nothing", () => {
    const { a, b } = link();
    const theirs = believe(world("b"));
    sharing(b.team, theirs);
    a.team.tell({ at: 1, x: 0, y: 0, parcels: "not a list", agents: [] });
    a.team.tell("Go to (19,19) for 1000pts");

    expect(theirs.parcels()).toEqual([]);
    expect(theirs.agents()).toEqual([]);
  });
});

describe("when the report was sensed", () => {
  test("an empty tile in the sender's reach retires what we remembered", () => {
    const { a, b } = link();
    const theirs = believe(world("b"));
    theirs.seen(sensing({ positions: [{ x: 5, y: 0 }], parcels: [parcel] }), 0);
    sharing(b.team, theirs);
    sharing(a.team, believe(world("a")))(sensing({}), 1_000);

    expect(theirs.parcels(1_000)).toEqual([]);
  });

  test("a look of our own outlives an older report of the same tile", () => {
    const { a, b } = link();
    const theirs = believe(world("b"));
    theirs.seen(
      sensing({ positions: [{ x: 5, y: 0 }], parcels: [parcel] }),
      1_000,
    );
    sharing(b.team, theirs);
    sharing(a.team, believe(world("a")))(sensing({}), 500);

    expect(theirs.parcels(1_000)).toMatchObject([{ id: "p1" }]);
  });

  test("a stale sighting does not overwrite a fresher one", () => {
    const { a, b } = link();
    const theirs = believe(world("b"));
    theirs.seen(sensing({ parcels: [parcel] }), 1_000);
    sharing(b.team, theirs);
    sharing(a.team, believe(world("a")))(
      sensing({ parcels: [{ ...parcel, reward: 9 }] }),
      500,
    );

    expect(theirs.parcels(1_000)).toMatchObject([{ reward: 40 }]);
  });
});
