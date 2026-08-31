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
    GAME: { parcels: { decaying_event: decay } },
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
