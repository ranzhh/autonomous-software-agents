import { z } from "zod";

const tile = z.object({
  x: z.int().nonnegative(),
  y: z.int().nonnegative(),
});

export const Policy = z.object({
  avoid: z.array(tile).describe("Never step on these."),
  noDelivery: z.array(tile).describe("Never deliver on these."),
  batch: z
    .int()
    .min(1)
    .nullable()
    .describe("A delivery is exactly this many parcels at once."),
  cheap: z
    .number()
    .min(1)
    .nullable()
    .describe("A delivery is one parcel worth at most this."),
  handoff: z.boolean().describe("One agent picks up, the other delivers."),
  hold: z.boolean().describe("Both agents stand still."),
  goals: z.array(
    z.object({
      kind: z
        .enum(["visit", "deliver"])
        .describe("Stand on one of the tiles, or deliver parcels on one."),
      tiles: z.array(tile),
      radius: z
        .int()
        .nonnegative()
        .describe("Any tile within this distance of one of them counts."),
      bonus: z.number(),
      together: z
        .boolean()
        .describe("Both agents must be there at the same time."),
    }),
  ),
  rules: z
    .array(
      z.object({
        contains: z.string().describe("A phrase a later message may contain."),
        effect: z.enum(["hold", "resume"]),
      }),
    )
    .describe("Only for a red light, green light game."),
});

export type Policy = z.infer<typeof Policy>;

export const NONE: Policy = {
  avoid: [],
  noDelivery: [],
  batch: null,
  cheap: null,
  handoff: false,
  hold: false,
  goals: [],
  rules: [],
};

export interface Orders {
  policy(): Policy;
  issue(policy: Policy): void;
  onIssue(listener: (policy: Policy) => void): void;
}

export function orders(initial = NONE): Orders {
  let policy = initial;
  const listeners = new Set<(policy: Policy) => void>();
  return {
    policy: () => policy,
    issue: (next) => {
      if (JSON.stringify(next) === JSON.stringify(policy)) return;
      policy = next;
      for (const listener of listeners) listener(next);
    },
    onIssue: (listener) => {
      listeners.add(listener);
    },
  };
}

export function react(policy: Policy, text: string): Policy | undefined {
  const lower = text.toLowerCase();
  const hits = policy.rules
    .map((rule) => ({ rule, at: lower.indexOf(rule.contains.toLowerCase()) }))
    .filter(({ at }) => at >= 0)
    .sort((a, b) => a.at - b.at);
  const first = hits[0]?.rule;
  if (first === undefined) return undefined;
  const hold = first.effect === "hold";
  return hold === policy.hold ? undefined : { ...policy, hold };
}
