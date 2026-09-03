import type { AgentBelief, Beliefs, ParcelBelief } from "./beliefs.js";
import type { Intent } from "./field.js";
import { log } from "./log.js";
import { fields, type IOSensing, type Position } from "./sdk.js";
import type { Team } from "./team.js";

const TELL_MS = 200;

// A claim is only as fresh as the report that carried it; a quiet teammate holds nothing.
const CLAIM_MS = 1_500;

interface Sighted {
  id: string;
  x: number;
  y: number;
  reward: number;
  carriedBy?: string | undefined;
}

interface Seen {
  id: string;
  name: string;
  x: number;
  y: number;
}

interface Report {
  x: number;
  y: number;
  sighted: Sighted[];
  agents: Seen[];
  gone: string[];
  taken: string[];
  stops: Position[];
  going: Position | undefined;
  banked: string[];
}

/** What this agent means to do, as the teammate should hear it. */
export interface Told extends Intent {
  /** The parcels the tour is going for. */
  taken: string[];
}

/** A report as it landed in the beliefs, for whoever else keeps count. */
export interface Heard {
  from: AgentBelief;
  sighted: ParcelBelief[];
  others: AgentBelief[];
  banked: string[];
}

export interface Share {
  /** Forward this frame to the teammate, no more often than once every TELL_MS. */
  post(sensing: IOSensing, gone: string[], now?: number): void;
  /** The parcels the teammate last said it was going for. */
  claimed(now?: number): ReadonlySet<string>;
  /** Where the teammate last said it was heading. */
  intent(now?: number): Intent | undefined;
  /** Parcels delivered since the last post; they ride the next one. */
  bank(ids: string[]): void;
}

function sighted(value: unknown): Sighted | undefined {
  const record = fields(value);
  if (record === undefined) return undefined;
  const { id, x, y, reward, carriedBy } = record;
  if (typeof id !== "string") return undefined;
  if (typeof x !== "number" || typeof y !== "number") return undefined;
  if (typeof reward !== "number") return undefined;
  return {
    id,
    x,
    y,
    reward,
    carriedBy: typeof carriedBy === "string" ? carriedBy : undefined,
  };
}

function seen(value: unknown): Seen | undefined {
  const record = fields(value);
  if (record === undefined) return undefined;
  const { id, name, x, y } = record;
  if (typeof id !== "string" || typeof name !== "string") return undefined;
  if (typeof x !== "number" || typeof y !== "number") return undefined;
  return { id, name, x, y };
}

function position(value: unknown): Position | undefined {
  const record = fields(value);
  return typeof record?.x === "number" && typeof record.y === "number"
    ? { x: record.x, y: record.y }
    : undefined;
}

function report(value: unknown): Report | undefined {
  const record = fields(value);
  if (record === undefined) return undefined;
  const { x, y, sighted: spotted, agents, gone, taken } = record;
  if (typeof x !== "number" || typeof y !== "number") return undefined;
  if (!Array.isArray(spotted) || !Array.isArray(gone)) return undefined;
  if (!Array.isArray(taken)) return undefined;
  const { stops, going, banked } = record;
  const parcels: Sighted[] = [];
  for (const one of spotted) {
    const parcel = sighted(one);
    if (parcel !== undefined) parcels.push(parcel);
  }
  const others: Seen[] = [];
  for (const one of Array.isArray(agents) ? agents : []) {
    const other = seen(one);
    if (other !== undefined) others.push(other);
  }
  const strings = (list: unknown[]): string[] =>
    list.filter((id): id is string => typeof id === "string");
  return {
    x,
    y,
    sighted: parcels,
    agents: others,
    gone: strings(gone),
    taken: strings(taken),
    stops: (Array.isArray(stops) ? stops : []).flatMap((one) => {
      const stop = position(one);
      return stop ? [stop] : [];
    }),
    going: position(going),
    banked: strings(Array.isArray(banked) ? banked : []),
  };
}

export function sharing(
  team: Team,
  beliefs: Beliefs,
  told: () => Told,
  onHeard?: (report: Heard) => void,
): Share {
  let posted = 0;
  let claims = new Set<string>();
  let heading: Intent | undefined;
  let claimedAt = Number.NEGATIVE_INFINITY;
  let delivered: string[] = [];

  team.onTell((payload) => {
    const from = team.mate();
    const heard = report(payload);
    if (from === undefined || heard === undefined) return;
    const now = Date.now();
    const stamped: ParcelBelief[] = heard.sighted.map((p) => ({
      ...p,
      seenAt: now,
    }));
    claims = new Set(heard.taken);
    heading = { stops: heard.stops, going: heard.going };
    claimedAt = now;
    const sender = {
      id: from.id,
      name: from.name,
      x: heard.x,
      y: heard.y,
      seenAt: now,
    };
    const others = heard.agents.map((a) => ({ ...a, seenAt: now }));
    const news = beliefs.heard(sender, stamped, heard.gone, others);
    onHeard?.({ from: sender, sighted: stamped, others, banked: heard.banked });
    log.debug(
      {
        news,
        sighted: stamped.length,
        agents: heard.agents.length,
        gone: heard.gone.length,
        taken: claims.size,
      },
      "merged",
    );
  });

  return {
    post(sensing, gone, now = Date.now()) {
      if (now - posted < TELL_MS && gone.length === 0 && delivered.length === 0)
        return;
      posted = now;
      const at = beliefs.me();
      const mate = team.mate();
      const intent = told();
      const banked = delivered;
      delivered = [];
      // `positions` is the bulk of a frame and the receiver rebuilds it from the map.
      team.tell({
        x: at.x,
        y: at.y,
        // The teammate's own tile it knows better than we do; everyone else is news.
        agents: sensing.agents.flatMap((a) =>
          a.id === mate?.id || a.x === undefined || a.y === undefined
            ? []
            : [{ id: a.id, name: a.name, x: a.x, y: a.y }],
        ),
        sighted: sensing.parcels.map((p) => ({
          id: p.id,
          x: p.x,
          y: p.y,
          reward: p.reward,
          carriedBy: p.carriedBy ?? undefined,
        })),
        gone,
        taken: intent.taken,
        stops: intent.stops,
        going: intent.going ?? null,
        banked,
      });
    },
    claimed: (now = Date.now()) =>
      now - claimedAt < CLAIM_MS ? claims : new Set<string>(),
    intent: (now = Date.now()) =>
      now - claimedAt < CLAIM_MS ? heading : undefined,
    bank: (ids) => {
      delivered = [...delivered, ...ids];
    },
  };
}
