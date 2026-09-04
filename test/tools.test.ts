import { describe, expect, test } from "vitest";
import { NONE } from "../src/policy.js";
import { type Context, calculate, perform } from "../src/tools.js";

function context(policy = NONE): Context & { said: string[] } {
  const said: string[] = [];
  return {
    policy,
    deliveries: [
      { x: 3, y: 0 },
      { x: 9, y: 0 },
    ],
    reward: 30,
    say: (text) => void said.push(text),
    said,
  };
}

const call = (name: string, args: unknown) => ({ id: "c", name, args });

describe("a tool call", () => {
  test("adds a goal to the orders", () => {
    const out = perform(
      call("go_to", { tiles: [{ x: 1, y: 1 }], bonus: 1000 }),
      context(),
    );
    expect(out.policy.goals).toEqual([
      {
        kind: "visit",
        tiles: [{ x: 1, y: 1 }],
        radius: 0,
        bonus: 1000,
        together: false,
      },
    ]);
    expect(out.result).toMatch(/^ok/);
  });

  test("a penalty is declined and the orders stand", () => {
    const out = perform(
      call("go_to", { tiles: [{ x: 1, y: 1 }], bonus: -10 }),
      context(),
    );
    expect(out.policy).toEqual(NONE);
    expect(out.result).toMatch(/^declined/);
  });

  test("arguments that do not fit come back as an error the model can fix", () => {
    const out = perform(
      call("go_to", { tiles: "(1,1)", bonus: 10 }),
      context(),
    );
    expect(out.policy).toEqual(NONE);
    expect(out.result).toMatch(/^Error: /);
    expect(out.result).toContain("tiles");
  });

  test("a delivery goal keeps only delivery tiles, and none is an error", () => {
    const ok = perform(
      call("deliver_at", {
        tiles: [
          { x: 3, y: 0 },
          { x: 4, y: 4 },
        ],
        bonus: 5,
      }),
      context(),
    );
    expect(ok.policy.goals[0]?.tiles).toEqual([{ x: 3, y: 0 }]);
    const bad = perform(
      call("deliver_at", { tiles: [{ x: 4, y: 4 }], bonus: 5 }),
      context(),
    );
    expect(bad.result).toBe(
      "Error: (4,4) are not delivery tiles; those are (3,0) (9,0)",
    );
  });

  test("standing orders accumulate", () => {
    let { policy } = perform(
      call("never_walk_through", { tiles: [{ x: 1, y: 1 }] }),
      context(),
    );
    ({ policy } = perform(
      call("never_deliver_on", { tiles: [{ x: 3, y: 0 }] }),
      context(policy),
    ));
    ({ policy } = perform(
      call("deliver_in_batches", { size: 3, bonus: 100 }),
      context(policy),
    ));
    ({ policy } = perform(
      call("deliver_only_worth_at_most", { max_total: 10, bonus: 1000 }),
      context(policy),
    ));
    ({ policy } = perform(call("hand_off", { bonus: 500 }), context(policy)));
    ({ policy } = perform(
      call("when_told", { stop_phrase: "red light", go_phrase: "green light" }),
      context(policy),
    ));
    expect(policy).toEqual({
      ...NONE,
      avoid: [{ x: 1, y: 1 }],
      noDelivery: [{ x: 3, y: 0 }],
      batch: 3,
      cheap: 10,
      handoff: true,
      rules: [
        { contains: "red light", effect: "hold" },
        { contains: "green light", effect: "resume" },
      ],
    });
  });

  test("a meeting point is a visit within a distance, both agents at once", () => {
    const out = perform(
      call("meet_near", { x: 19, y: 5, distance: 3, bonus: 500 }),
      context(),
    );
    expect(out.policy.goals).toEqual([
      {
        kind: "visit",
        tiles: [{ x: 19, y: 5 }],
        radius: 3,
        bonus: 500,
        together: true,
      },
    ]);
  });

  test("the delivery tiles and the going rate are there to be asked for", () => {
    expect(perform(call("delivery_tiles", {}), context()).result).toBe(
      "delivery tiles (3,0) (9,0); a parcel is worth about 30",
    );
  });

  test("calculate sends the value, reply sends the text", () => {
    const ctx = context();
    perform(call("calculate", { expression: "5*5" }), ctx);
    perform(call("reply", { text: "Rome" }), ctx);
    expect(ctx.said).toEqual(["25", "Rome"]);
    expect(
      perform(call("calculate", { expression: "five" }), context()).result,
    ).toMatch(/^Error/);
  });

  test("arguments written as JSON text, single-quoted or not, are read anyway", () => {
    const out = perform(
      call("deliver_at", { tiles: '[{"x": 3, "y": 0}]', bonus: "5" }),
      context(),
    );
    expect(out.policy.goals[0]?.bonus).toBe(5);
    expect(out.policy.goals[0]?.tiles).toEqual([{ x: 3, y: 0 }]);
    const single = perform(
      call("never_walk_through", { tiles: "[{'x': 1, 'y': 1}]" }),
      context(),
    );
    expect(single.policy.avoid).toEqual([{ x: 1, y: 1 }]);
    const pairs = perform(
      call("never_walk_through", { tiles: "[(1,1), (2, 3)]" }),
      context(),
    );
    expect(pairs.policy.avoid).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 3 },
    ]);
    const arithmetic = perform(
      call("deliver_at", { tiles: [{ x: 3, y: 0 }], bonus: "5*30" }),
      context(),
    );
    expect(arithmetic.policy.goals[0]?.bonus).toBe(150);
  });

  test("a batch for a fraction of the reward is declined", () => {
    const out = perform(
      call("deliver_in_batches", { size: 5, bonus: 0.3 }),
      context(),
    );
    expect(out.policy).toEqual(NONE);
    expect(out.result).toMatch(/^declined/);
  });

  test("a tool that does not exist is an error, not a crash", () => {
    expect(perform(call("fly", {}), context()).result).toBe(
      "Error: no tool named fly",
    );
  });
});

test("arithmetic is computed, anything else is not", () => {
  expect(calculate("(5*(5+3)/2)+2")).toBe(22);
  expect(calculate(" 4 * 2 ")).toBe(8);
  expect(calculate("-3")).toBe(-3);
  expect(calculate("1/0")).toBeUndefined();
  expect(calculate("2(3)")).toBeUndefined();
  expect(calculate("The answer is 22")).toBeUndefined();
  expect(calculate("process.exit()")).toBeUndefined();
});
