import { describe, expect, test } from "vitest";
import { NONE, orders, Policy, react } from "../src/policy.js";

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
