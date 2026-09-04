import { describe, expect, test } from "vitest";
import { believe } from "../src/beliefs.js";
import type { IOAgent, IOConfig, IOSensing } from "../src/sdk.js";

const me: IOAgent = {
  id: "me",
  name: "tester",
  teamId: "t",
  teamName: "team",
  score: 0,
  penalty: 0,
  x: 0,
  y: 0,
};

const configWith = (decay: string): IOConfig =>
  ({
    CLOCK: 50,
    GAME: {
      parcels: { decaying_event: decay, reward_avg: 30, reward_variance: 0 },
      player: { observation_distance: 5 },
    },
  }) as unknown as IOConfig;

const world = (decay = "1s") => ({
  me,
  tiles: [{ x: 0, y: 0, type: "3" as const }],
  config: configWith(decay),
});

const sensing = (partial: Partial<IOSensing>): IOSensing => ({
  positions: [],
  agents: [],
  parcels: [],
  crates: [],
  ...partial,
});

const parcel = { id: "p1", x: 1, y: 1, reward: 34 };

const row = Array.from({ length: 13 }, (_, x) => ({
  x,
  y: 0,
  type: "3" as const,
}));

describe("parcels", () => {
  test("decays rewards to the asked time and drops the expired", () => {
    const beliefs = believe(world());
    beliefs.seen(sensing({ parcels: [parcel] }), 0);

    expect(beliefs.parcels(5_000)).toEqual([
      { ...parcel, carriedBy: undefined, reward: 29, seenAt: 0 },
    ]);
    expect(beliefs.parcels(34_000)).toEqual([]);
  });

  test("never decays under an infinite decay config", () => {
    const beliefs = believe(world("infinite"));
    beliefs.seen(sensing({ parcels: [parcel] }), 0);
    expect(beliefs.parcels(3_600_000)[0]).toMatchObject({ reward: 34 });
  });

  test("forgets a parcel missing from a tile in sight", () => {
    const beliefs = believe(world());
    beliefs.seen(sensing({ parcels: [parcel] }), 0);
    beliefs.seen(sensing({ positions: [{ x: 1, y: 1 }] }), 100);
    expect(beliefs.parcels(100)).toEqual([]);
  });

  test("keeps a parcel that fell out of sight", () => {
    const beliefs = believe(world());
    beliefs.seen(sensing({ parcels: [parcel] }), 0);
    beliefs.seen(sensing({ positions: [{ x: 9, y: 9 }] }), 100);
    expect(beliefs.parcels(100)[0]).toMatchObject({ id: "p1", seenAt: 0 });
  });

  test("separates what I carry from what lies around", () => {
    const beliefs = believe(world());
    beliefs.seen(
      sensing({ parcels: [parcel, { ...parcel, id: "p2", carriedBy: "me" }] }),
      0,
    );
    expect(beliefs.carrying(0).map((p) => p.id)).toEqual(["p2"]);
  });
});

describe("what a teammate saw", () => {
  const mate = { id: "mate", name: "other", x: 9, y: 9 };
  const remote = { id: "p2", x: 5, y: 5, reward: 40 };
  const report = (
    at: number,
    from = mate,
    parcels: (typeof remote)[] = [],
  ) => ({ at, from, parcels, agents: [] });

  test("takes a parcel this agent has never seen", () => {
    const beliefs = believe(world());
    beliefs.heard(report(0, mate, [remote]));
    expect(beliefs.parcels(0)).toEqual([{ ...remote, seenAt: 0 }]);
  });

  test("places the teammate without it ever being in sight", () => {
    const beliefs = believe(world());
    beliefs.heard(report(0));
    expect(beliefs.agents()).toEqual([{ ...mate, seenAt: 0 }]);
  });

  test("does not overwrite a record this agent saw later", () => {
    const beliefs = believe(world());
    beliefs.seen(sensing({ parcels: [{ ...parcel, reward: 34 }] }), 1_000);
    beliefs.heard(report(0, mate, [{ ...parcel, reward: 9 }]));
    expect(beliefs.parcels(1_000)[0]).toMatchObject({ reward: 34 });
  });

  test("retires a parcel absent from a tile the teammate could see", () => {
    const beliefs = believe({ me, tiles: row, config: configWith("1s") });
    beliefs.seen(sensing({ parcels: [{ ...parcel, x: 5, y: 0 }] }), 0);
    beliefs.heard(report(100, { ...mate, x: 6, y: 0 }));
    expect(beliefs.parcels(100)).toEqual([]);
  });

  test("leaves a tile out of the teammate's reach alone", () => {
    const beliefs = believe({ me, tiles: row, config: configWith("1s") });
    beliefs.seen(sensing({ parcels: [{ ...parcel, x: 0, y: 0 }] }), 0);
    beliefs.heard(report(100, { ...mate, x: 12, y: 0 }));
    expect(beliefs.parcels(100)).toHaveLength(1);
  });

  test("keeps a parcel it is carrying, whatever the teammate saw", () => {
    const beliefs = believe({ me, tiles: row, config: configWith("1s") });
    beliefs.seen(sensing({ parcels: [{ ...parcel, x: 0, y: 0 }] }), 0);
    beliefs.took([{ xy: { x: 0, y: 0 }, reward: 30 }]);
    beliefs.heard(report(100, { ...mate, x: 2, y: 0 }));
    expect(beliefs.carrying(100)).toHaveLength(1);
  });

  test("runs no sweep of its own, so a distant sighting survives", () => {
    const beliefs = believe(world());
    beliefs.heard(report(0, mate, [remote]));
    beliefs.seen(sensing({ positions: [{ x: 0, y: 0 }] }), 100);
    expect(beliefs.parcels(100)).toHaveLength(1);
  });

  test("counts the teammate's reach as observed ground", () => {
    const beliefs = believe({ me, tiles: row, config: configWith("1s") });
    beliefs.heard(report(100, { ...mate, x: 6, y: 0 }));
    expect(beliefs.observedAt(6, 0)).toBe(100);
    expect(beliefs.observedAt(1, 0)).toBe(100);
    expect(beliefs.observedAt(0, 0)).toBe(Number.NEGATIVE_INFINITY);
  });

  test("does not walk back a fresher look of our own", () => {
    const beliefs = believe({ me, tiles: row, config: configWith("1s") });
    beliefs.seen(sensing({ positions: [{ x: 6, y: 0 }] }), 300);
    beliefs.heard(report(100, { ...mate, x: 6, y: 0 }));
    expect(beliefs.observedAt(6, 0)).toBe(300);
  });
});

describe("my own actions", () => {
  const underfoot = { id: "p0", x: 0, y: 0, reward: 30 };

  test("a pickup carries what was believed underfoot", () => {
    const beliefs = believe(world());
    beliefs.seen(sensing({ parcels: [underfoot] }), 0);
    beliefs.took([{ xy: { x: 0, y: 0 }, reward: 30 }]);
    expect(beliefs.carrying(0).map((p) => p.id)).toEqual(["p0"]);
  });

  test("an empty pickup forgets what was never there", () => {
    const beliefs = believe(world());
    beliefs.seen(sensing({ parcels: [underfoot] }), 0);
    beliefs.took([]);
    expect(beliefs.parcels(0)).toEqual([]);
  });

  test("a lost pickup ack forgets too, rather than claim a carry", () => {
    const beliefs = believe(world());
    beliefs.seen(sensing({ parcels: [underfoot] }), 0);
    beliefs.took(undefined);
    expect(beliefs.parcels(0)).toEqual([]);
  });

  test("a pickup leaves parcels on other tiles alone", () => {
    const beliefs = believe(world());
    beliefs.seen(sensing({ parcels: [parcel] }), 0);
    beliefs.took([]);
    expect(beliefs.parcels(0).map((p) => p.id)).toEqual(["p1"]);
  });

  test("a putdown lets go of the whole load", () => {
    const beliefs = believe(world());
    beliefs.seen(
      sensing({ parcels: [{ ...underfoot, carriedBy: "me" }, parcel] }),
      0,
    );
    beliefs.gave();
    expect(beliefs.carrying(0)).toEqual([]);
    expect(beliefs.parcels(0).map((p) => p.id)).toEqual(["p1"]);
  });

  test("a putdown of named parcels keeps the rest", () => {
    const beliefs = believe(world());
    beliefs.seen(
      sensing({
        parcels: [
          { ...underfoot, carriedBy: "me" },
          { ...underfoot, id: "p2", carriedBy: "me" },
        ],
      }),
      0,
    );
    beliefs.gave(["p2"]);
    expect(beliefs.carrying(0).map((p) => p.id)).toEqual(["p0"]);
  });
});

describe("agents", () => {
  test("remembers by the same sight rule as parcels", () => {
    const rival: IOAgent = { ...me, id: "r1", name: "rival", x: 2, y: 2 };
    const beliefs = believe(world());
    beliefs.seen(sensing({ agents: [rival] }), 0);
    expect(beliefs.agents()).toEqual([
      { id: "r1", name: "rival", x: 2, y: 2, seenAt: 0 },
    ]);

    beliefs.seen(sensing({ positions: [{ x: 2, y: 2 }] }), 100);
    expect(beliefs.agents()).toEqual([]);
  });
});

describe("crates", () => {
  test("remembers by the same sight rule as parcels", () => {
    const beliefs = believe(world());
    beliefs.seen(sensing({ crates: [{ id: "c1", x: 1, y: 1 }] }), 0);
    expect(beliefs.crates()).toEqual([{ id: "c1", x: 1, y: 1, seenAt: 0 }]);

    beliefs.seen(sensing({ positions: [{ x: 9, y: 9 }] }), 100);
    expect(beliefs.crates()).toHaveLength(1);

    beliefs.seen(sensing({ positions: [{ x: 1, y: 1 }] }), 200);
    expect(beliefs.crates()).toEqual([]);
  });
});

describe("the map", () => {
  test("applies tile changes", () => {
    const beliefs = believe(world());
    expect(beliefs.tileAt(0, 0)).toMatchObject({ type: "3" });
    beliefs.changed({ x: 0, y: 0, type: "2" });
    expect(beliefs.tileAt(0, 0)).toMatchObject({ type: "2" });
  });
});

describe("me", () => {
  test("tracks the latest position", () => {
    const beliefs = believe(world());
    beliefs.moved({ ...me, x: 4, y: 5 });
    expect(beliefs.me()).toMatchObject({ x: 4, y: 5 });
  });
});
