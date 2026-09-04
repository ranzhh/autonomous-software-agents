import { z } from "zod";
import type { Call, Tool } from "./llm.js";
import type { Policy } from "./policy.js";
import type { Position } from "./sdk.js";

export interface Context {
  policy: Policy;
  deliveries: Position[];
  reward: number;
  say(text: string): void;
}

export interface Outcome {
  policy: Policy;
  result: string;
}

interface Runnable extends Tool {
  perform(args: unknown, ctx: Context): Outcome;
}

function tool<S extends z.ZodType>(
  name: string,
  description: string,
  parameters: S,
  run: (args: z.infer<S>, ctx: Context) => Outcome | string,
): Runnable {
  return {
    name,
    description,
    parameters,
    perform(args, ctx) {
      const parsed = parameters.safeParse(loosened(args));
      if (!parsed.success)
        return {
          policy: ctx.policy,
          result: `Error: ${z.prettifyError(parsed.error)}`,
        };
      const out = run(parsed.data, ctx);
      return typeof out === "string"
        ? { policy: ctx.policy, result: out }
        : out;
    },
  };
}

export function calculate(text: string): number | undefined {
  if (!/^[\d\s+\-*/().]+$/.test(text)) return undefined;
  try {
    const value: unknown = new Function(`return (${text})`)();
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function loosened(args: unknown): unknown {
  if (typeof args !== "object" || args === null) return {};
  const json = (text: string): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };
  const value = (text: string): unknown =>
    json(text) ??
    calculate(text) ??
    json(
      text
        .replace(/\((\d+)\s*,\s*(\d+)\)/g, '{"x":$1,"y":$2}')
        .replace(/'/g, '"'),
    ) ??
    text;
  return Object.fromEntries(
    Object.entries(args).map(([k, v]) => [
      k,
      typeof v === "string" ? value(v) : v,
    ]),
  );
}

const tile = z.object({ x: z.int().nonnegative(), y: z.int().nonnegative() });
const tiles = z.array(tile).min(1);
const list = (at: Position[]): string =>
  at.map((t) => `(${t.x},${t.y})`).join(" ");
const same = (a: Position, b: Position): boolean => a.x === b.x && a.y === b.y;

const goal = (policy: Policy, one: Policy["goals"][number]): Policy => ({
  ...policy,
  goals: [...policy.goals, one],
});

export const DONE = "done";

export const TOOLS: Runnable[] = [
  tool(
    "delivery_tiles",
    "Where the delivery tiles are, and what a parcel is worth on average.",
    z.object({}),
    (_, { deliveries, reward }) =>
      `delivery tiles ${list(deliveries)}; a parcel is worth about ${reward}`,
  ),
  tool(
    "deliver_at",
    "Deliver parcels on one of the tiles for a bonus.",
    z.object({
      tiles,
      bonus: z
        .number()
        .describe(
          "Points; for a multiplied reward, the average reward from delivery_tiles times the extra factor.",
        ),
    }),
    ({ tiles, bonus }, { policy, deliveries }) => {
      if (bonus <= 0) return `declined: ${bonus} is a penalty, nobody goes`;
      const on = tiles.filter((t) => deliveries.some((d) => same(d, t)));
      if (on.length === 0)
        return `Error: ${list(tiles)} are not delivery tiles; those are ${list(deliveries)}`;
      return {
        policy: goal(policy, {
          kind: "deliver",
          tiles: on,
          radius: 0,
          bonus,
          together: false,
        }),
        result: `ok: delivering at ${list(on)} for ${bonus}`,
      };
    },
  ),
  tool(
    "go_to",
    "Both agents go and stand on one of the tiles the message names, for a bonus paid for being there rather than for delivering. A bonus with no tile to reach is not a go_to.",
    z.object({ tiles, bonus: z.number() }),
    ({ tiles, bonus }, { policy }) =>
      bonus <= 0
        ? `declined: ${bonus} is a penalty, nobody goes`
        : {
            policy: goal(policy, {
              kind: "visit",
              tiles,
              radius: 0,
              bonus,
              together: false,
            }),
            result: `ok: going to ${list(tiles)} for ${bonus}`,
          },
  ),
  tool(
    "meet_near",
    "Both agents go within distance of the tile and wait there for each other, for a bonus.",
    z.object({
      x: z.int().nonnegative(),
      y: z.int().nonnegative(),
      distance: z.int().nonnegative(),
      bonus: z.number(),
    }),
    ({ x, y, distance, bonus }, { policy }) =>
      bonus <= 0
        ? `declined: ${bonus} is a penalty, nobody goes`
        : {
            policy: goal(policy, {
              kind: "visit",
              tiles: [{ x, y }],
              radius: distance,
              bonus,
              together: true,
            }),
            result: `ok: meeting within ${distance} of (${x},${y}) for ${bonus}`,
          },
  ),
  tool(
    "never_walk_through",
    "Never step on the tiles from now on.",
    z.object({ tiles }),
    ({ tiles }, { policy }) => ({
      policy: { ...policy, avoid: [...policy.avoid, ...tiles] },
      result: `ok: avoiding ${list(tiles)}`,
    }),
  ),
  tool(
    "never_deliver_on",
    "Never deliver on the named tiles from now on. Not for a rule about what a parcel is worth.",
    z.object({ tiles }),
    ({ tiles }, { policy }) => ({
      policy: { ...policy, noDelivery: [...policy.noDelivery, ...tiles] },
      result: `ok: never delivering at ${list(tiles)}`,
    }),
  ),
  tool(
    "deliver_in_batches",
    "Deliver exactly size parcels at a time from now on, for a bonus in points or a factor on the reward.",
    z.object({ size: z.int().min(1), bonus: z.number() }),
    ({ size, bonus }, { policy }) =>
      bonus < 1
        ? `declined: ${bonus} of the reward is a loss, nobody batches`
        : {
            policy: { ...policy, batch: size },
            result: `ok: delivering ${size} at a time`,
          },
  ),
  tool(
    "deliver_only_worth_at_most",
    "Deliver one parcel at a time, and only once its reward has decayed to at most max_total, from now on. For a bonus on deliveries worth at most N, and for parcels with a score higher than N earning no reward.",
    z.object({
      max_total: z.number().min(1),
      bonus: z
        .number()
        .describe(
          "Points; when parcels above the threshold merely earn nothing, the normal reward, 1.",
        ),
    }),
    ({ max_total, bonus }, { policy }) =>
      bonus <= 0
        ? `declined: ${bonus} is a penalty, deliveries stay as they are`
        : {
            policy: { ...policy, cheap: max_total },
            result: `ok: delivering one parcel at a time once worth at most ${max_total}`,
          },
  ),
  tool(
    "hand_off",
    "From now on one agent picks parcels up and the other agent delivers them, for a bonus.",
    z.object({ bonus: z.number() }),
    ({ bonus }, { policy }) =>
      bonus <= 0
        ? `declined: ${bonus} is a penalty, nobody hands off`
        : {
            policy: { ...policy, handoff: true },
            result: "ok: one picks up, the other delivers",
          },
  ),
  tool(
    "when_told",
    "From now on, without asking you, any message containing stop_phrase makes both agents hold still, and any containing go_phrase makes them move again.",
    z.object({ stop_phrase: z.string().min(1), go_phrase: z.string().min(1) }),
    ({ stop_phrase, go_phrase }, { policy }) => ({
      policy: {
        ...policy,
        rules: [
          { contains: stop_phrase, effect: "hold" },
          { contains: go_phrase, effect: "resume" },
        ],
      },
      result: `ok: "${stop_phrase}" stops, "${go_phrase}" frees`,
    }),
  ),
  tool(
    "calculate",
    "Answer an arithmetic question: the value goes to whoever asked.",
    z.object({ expression: z.coerce.string() }),
    ({ expression }, ctx) => {
      const value = calculate(expression);
      if (value === undefined)
        return `Error: ${expression} is not an arithmetic expression`;
      ctx.say(String(value));
      return `ok: sent ${value}`;
    },
  ),
  tool(
    "reply",
    "Answer a question: the text goes to whoever asked, exactly as it should be read. A mission is never answered.",
    z.object({ text: z.coerce.string().min(1) }),
    ({ text }, ctx) => {
      ctx.say(text);
      return `ok: sent "${text}"`;
    },
  ),
  tool(
    DONE,
    "Nothing more to order: the message is handled, asks nothing of the team, or is a trap.",
    z.object({ reason: z.string() }),
    ({ reason }) => `ok: ${reason}`,
  ),
];

export function perform(call: Call, ctx: Context): Outcome {
  const found = TOOLS.find((t) => t.name === call.name);
  return found
    ? found.perform(call.args, ctx)
    : { policy: ctx.policy, result: `Error: no tool named ${call.name}` };
}
