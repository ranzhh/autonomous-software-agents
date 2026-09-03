import { describe, expect, test } from "vitest";
import { grid } from "../src/grid.js";
import {
  centre,
  constrain,
  handing,
  NONE,
  orders,
  type Policy,
  policyOf,
  react,
  rendezvous,
} from "../src/policy.js";
import { parcelOf, tilesOf } from "./world.js";

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

  test("changes nothing when the text triggers no rule, or the state it asks for holds", () => {
    expect(react(lights, "Go to (1,1) for 1000pts")).toBeUndefined();
    expect(react(lights, "GREEN LIGHT!")).toBeUndefined();
  });
});

describe("constraining the board", () => {
  test("a forbidden delivery tile becomes plain floor", () => {
    const tiles = tilesOf(["232"]);
    const kept = constrain(tiles, { ...NONE, noDelivery: [{ x: 2, y: 0 }] });
    expect(grid(kept).deliveries).toEqual([{ x: 0, y: 0 }]);
    expect(constrain(tiles, NONE)).toBe(tiles);
  });
});

describe("the exchange tiles", () => {
  test("both agents derive the same pair, each taking its own side", () => {
    const board = grid(tilesOf(["31313", "32323"]));
    const a = rendezvous(board, "a", "b");
    const b = rendezvous(board, "b", "a");
    expect(a).toBeDefined();
    expect(a?.mine).toEqual(b?.theirs);
    expect(a?.theirs).toEqual(b?.mine);
    expect(a?.mine).not.toEqual(a?.theirs);
  });

  test("a delivery tile with one neighbour is no place to exchange", () => {
    expect(rendezvous(grid(tilesOf(["21"])), "a", "b")).toBeUndefined();
  });
});

describe("what to put down at the end of a tour", () => {
  const carried = (...rewards: number[]) =>
    rewards.map((reward, i) => ({
      ...parcelOf(`p${i}`, 0),
      reward,
      carriedBy: "me",
    }));

  test("everything, by default", () => {
    expect(handing(carried(30, 20), NONE)).toEqual({
      drop: ["p0", "p1"],
      more: false,
    });
    expect(handing([], NONE)).toBe("leave");
  });

  test("exactly the batch, and the rest another time", () => {
    const three = { ...NONE, batch: 3 };
    expect(handing(carried(1, 2, 3, 4, 5, 6, 7), three)).toEqual({
      drop: ["p0", "p1", "p2"],
      more: true,
    });
    expect(handing(carried(1, 2, 3, 4), three)).toEqual({
      drop: ["p0", "p1", "p2"],
      more: false,
    });
    expect(handing(carried(1, 2), three)).toBe("leave");
  });

  test("one cheap parcel at a time, waiting for the dear ones to decay", () => {
    const cheap = { ...NONE, cheap: 10 };
    expect(handing(carried(30, 8, 9), cheap)).toEqual({
      drop: ["p1"],
      more: true,
    });
    expect(handing(carried(30, 20), cheap)).toBe("wait");
    expect(handing(carried(7), cheap)).toEqual({ drop: ["p0"], more: false });
  });
});

test("the centre of a set is the tile nearest all the others", () => {
  expect(
    centre([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 9, y: 0 },
    ]),
  ).toEqual({ x: 1, y: 0 });
});

describe("orders", () => {
  test("a reached goal is not pending, the rest are", () => {
    const standing = orders();
    const near = {
      kind: "visit" as const,
      tiles: [{ x: 1, y: 1 }],
      bonus: 10,
      together: false,
    };
    const far = {
      kind: "visit" as const,
      tiles: [{ x: 9, y: 9 }],
      bonus: 10,
      together: false,
    };
    standing.issue({ ...NONE, goals: [near, far] });
    standing.done(near);
    expect(standing.pending()).toEqual([far]);
  });

  test("the same orders issued again change nothing", () => {
    const standing = orders();
    let issued = 0;
    standing.onIssue(() => issued++);
    standing.issue({ ...NONE, batch: 3 });
    standing.issue(JSON.parse(JSON.stringify(standing.policy())));
    expect(issued).toBe(1);
  });

  test("survives the wire and rejects what does not fit", () => {
    const policy: Policy = {
      ...lights,
      avoid: [{ x: 1, y: 2 }],
      batch: 3,
      goals: [
        {
          kind: "deliver",
          tiles: [{ x: 1, y: 1 }],
          bonus: 1000,
          together: false,
        },
      ],
    };
    expect(policyOf(JSON.parse(JSON.stringify(policy)))).toEqual(policy);
    expect(policyOf({ ...policy, goals: [{ kind: "fly" }] })).toBeUndefined();
    expect(policyOf("Go to (1,1)")).toBeUndefined();
  });
});
