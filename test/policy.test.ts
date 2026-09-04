import { describe, expect, test } from "vitest";
import { grid } from "../src/grid.js";
import {
  constrain,
  drop,
  exchange,
  type Goal,
  mark,
  NONE,
  orders,
  Policy,
  pending,
  react,
  targets,
  within,
} from "../src/policy.js";
import { tilesOf } from "./tiles.js";

const lights: Policy = {
  ...NONE,
  rules: [
    { contains: "red light", effect: "hold" },
    { contains: "green light", effect: "resume" },
  ],
};

describe("a standing rule", () => {
  test("the phrase that comes first in the text decides", () => {
    // The stop message names both lights; the one it opens with is the one meant.
    const held = react(
      lights,
      "RED LIGHT! Stop moving until the next green light!",
    );
    expect(held?.hold).toBe(true);
    const freed = react(
      { ...lights, hold: true },
      "GREEN LIGHT! You can move again!",
    );
    expect(freed?.hold).toBe(false);
  });

  test("changes nothing when no rule fires, or the state it asks for holds", () => {
    expect(react(lights, "Go to (1,1) for 1000pts")).toBeUndefined();
    expect(react(lights, "GREEN LIGHT!")).toBeUndefined();
  });
});

describe("orders", () => {
  test("the same orders issued again change nothing", () => {
    const standing = orders();
    let issued = 0;
    standing.onIssue(() => issued++);
    standing.issue({ ...NONE, batch: 3 });
    standing.issue(JSON.parse(JSON.stringify(standing.policy())));
    expect(issued).toBe(1);
  });

  test("survive the wire and reject what does not fit", () => {
    const policy: Policy = {
      ...lights,
      avoid: [{ x: 1, y: 2 }],
      batch: 3,
      goals: [
        {
          kind: "deliver",
          tiles: [{ x: 1, y: 1 }],
          radius: 0,
          bonus: 1000,
          together: false,
        },
      ],
    };
    expect(Policy.parse(JSON.parse(JSON.stringify(policy)))).toEqual(policy);
    expect(
      Policy.safeParse({ ...policy, goals: [{ kind: "fly" }] }).success,
    ).toBe(false);
    expect(Policy.safeParse("Go to (1,1)").success).toBe(false);
  });
});

describe("what the orders mean", () => {
  const board = grid(tilesOf(["3332", "1333"]));

  test("goals are pending until marked done, and any tile in radius is inside", () => {
    const goal: Goal = {
      kind: "visit",
      tiles: [{ x: 2, y: 1 }],
      radius: 1,
      bonus: 500,
      together: false,
    };
    const done = new Set<string>();
    expect(pending({ ...NONE, goals: [goal] }, done)).toEqual([goal]);
    done.add(mark(goal));
    expect(pending({ ...NONE, goals: [goal] }, done)).toEqual([]);
    expect(within({ x: 3, y: 1 }, goal)).toBe(true);
    expect(within({ x: 3, y: 0 }, goal)).toBe(false);
  });

  test("a meeting heads for the middle of the set, a visit for any of it", () => {
    const meet: Goal = {
      kind: "visit",
      tiles: [{ x: 2, y: 1 }],
      radius: 1,
      bonus: 500,
      together: true,
    };
    expect(targets(meet, board)).toEqual([{ x: 2, y: 1 }]);
    expect(targets({ ...meet, together: false }, board)).toHaveLength(4);
    expect(targets({ ...meet, radius: 0 }, board)).toEqual(meet.tiles);
  });

  test("the board is walled and its deliveries narrowed as ordered", () => {
    const shaped = grid(
      constrain(
        tilesOf(["3332", "1323"]),
        { ...NONE, avoid: [{ x: 1, y: 1 }] },
        [{ x: 2, y: 0 }],
      ),
    );
    expect(shaped.walkable({ x: 1, y: 1 })).toBe(false);
    expect(shaped.deliveries).toEqual([{ x: 2, y: 0 }]);
    expect(shaped.walkable({ x: 3, y: 1 })).toBe(true);
  });

  test("the exchange is beside the delivery tile nearest the spawners", () => {
    expect(exchange(board)).toEqual({
      drop: { x: 3, y: 0 },
      post: { x: 3, y: 1 },
    });
    expect(exchange(grid(tilesOf(["333"])))).toBeUndefined();
  });

  test("a putdown lets go of all, a full lot, or one parcel cheap enough", () => {
    const load = [
      { id: "a", reward: 30 },
      { id: "b", reward: 8 },
      { id: "c", reward: 12 },
    ];
    expect(drop(load, NONE)).toEqual(["a", "b", "c"]);
    expect(drop(load, { ...NONE, batch: 2 })).toEqual(["a", "b"]);
    expect(drop(load.slice(0, 1), { ...NONE, batch: 2 })).toBeUndefined();
    expect(drop(load, { ...NONE, cheap: 10 })).toEqual(["b"]);
    expect(drop(load.slice(0, 1), { ...NONE, cheap: 10 })).toBeUndefined();
    expect(drop([], NONE)).toBeUndefined();
  });
});
