import type { Beliefs, Report } from "./beliefs.js";
import type { Intention } from "./plans.js";
import { fields, type IOSensing } from "./sdk.js";
import type { Team } from "./team.js";

const num = (v: unknown): v is number => typeof v === "number";
const str = (v: unknown): v is string => typeof v === "string";

function parcel(value: unknown): Report["parcels"][number] | undefined {
  const r = fields(value);
  if (r === undefined) return undefined;
  if (!str(r.id) || !num(r.x) || !num(r.y) || !num(r.reward)) return undefined;
  const { id, x, y, reward } = r;
  return {
    id,
    x,
    y,
    reward,
    carriedBy: str(r.carriedBy) ? r.carriedBy : undefined,
  };
}

function agent(value: unknown): Report["agents"][number] | undefined {
  const r = fields(value);
  if (r === undefined) return undefined;
  if (!str(r.id) || !str(r.name) || !num(r.x) || !num(r.y)) return undefined;
  const { id, name, x, y } = r;
  return { id, name, x, y };
}

function intention(value: unknown): Intention | undefined {
  const r = fields(value);
  if (r === undefined) return undefined;
  if (r.kind === "fetch" && str(r.id)) return { kind: "fetch", id: r.id };
  if (r.kind === "scout" && num(r.x) && num(r.y))
    return { kind: "scout", x: r.x, y: r.y };
  if (r.kind === "home" || r.kind === "explore") return { kind: r.kind };
  return undefined;
}

function list<T>(
  value: unknown,
  parse: (one: unknown) => T | undefined,
): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: T[] = [];
  for (const one of value) {
    const parsed = parse(one);
    if (parsed === undefined) return undefined;
    out.push(parsed);
  }
  return out;
}

export interface Share {
  /** Forward this frame, and what this agent is going for, to the teammate. */
  post(sensing: IOSensing, going: Intention, at?: number): void;
  /** What the teammate last said it was going for. */
  intent(): Intention | undefined;
}

export function sharing(team: Team, beliefs: Beliefs): Share {
  let theirs: Intention | undefined;
  team.onTell((payload) => {
    const mate = team.mate();
    const r = fields(payload);
    if (mate === undefined || r === undefined) return;
    const { at, x, y } = r;
    const parcels = list(r.parcels, parcel);
    const agents = list(r.agents, agent);
    const going = intention(r.intention);
    if (!num(at) || !num(x) || !num(y) || !parcels || !agents || !going) return;
    beliefs.heard({ at, from: { ...mate, x, y }, parcels, agents });
    theirs = going;
  });

  return {
    post: (sensing, going, at = Date.now()) => {
      const me = beliefs.me();
      team.tell({
        at,
        x: me.x ?? 0,
        y: me.y ?? 0,
        parcels: sensing.parcels,
        agents: sensing.agents.flatMap((a) =>
          a.x === undefined || a.y === undefined
            ? []
            : [{ id: a.id, name: a.name, x: a.x, y: a.y }],
        ),
        intention: going,
      });
    },
    intent: () => theirs,
  };
}
