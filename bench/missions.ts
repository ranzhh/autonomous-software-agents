import { readFileSync } from "node:fs";
import type { IOSensing } from "../src/sdk.js";

/**
 * A mission is a triple: the text shouted at second `t`, the event the
 * director then watches for, and the reward paid to each agent who brings the
 * event about. Missions never name a tile, so one file serves every map.
 */
export interface Mission {
  /** Seconds after the last agent spawned. */
  t: number;
  /** Shouted after `{reward}` and, for a delivery, `{x}` and `{y}` are filled in. */
  text: string;
  event: Event;
  /** Points paid once per agent through the admin reward command. */
  reward: number;
  /** Seconds the mission stays open; the rest of the run unless given. */
  window: number;
}

export type Event =
  | {
      /**
       * The director drops a parcel worth `parcel` on the walkable, non-delivery
       * tile farthest from every agent; delivering it is the event. The parcel
       * decays like any other, so `parcel` defaults to enough to last the run.
       */
      kind: "deliver";
      parcel: number;
    }
  | {
      /** A reply to the director containing `accept`, case-insensitively. */
      kind: "answer";
      accept: string;
    };

/** The admin connection that shouts, spawns and pays. */
export interface Director {
  shout(text: string): void;
  createParcel(x: number, y: number, reward: number): void;
  reward(agentId: string, points: number): void;
  onMsg(listener: (fromId: string, payload: unknown) => void): void;
}

/** The observer's view of the grid. */
export interface Sensing {
  latest(): IOSensing | undefined;
  on(listener: (sensing: IOSensing) => void): void;
}

export interface MissionOptions {
  director: Director;
  sensing: Sensing;
  agents: { id: string; name: string }[];
  /** The map, `tiles[x][y]`, to drop parcels on. */
  tiles: unknown[][];
  missions: Mission[];
  /** Epoch ms the run's clock starts from. */
  t0: number;
  log: (event: Record<string, unknown>) => void;
}

const SPAWN_TIMEOUT_MS = 5_000;
const PAY_TIMEOUT_MS = 5_000;

/** Read and validate a missions file against the run's duration, filling defaults. */
export function loadMissions(path: string, duration: number): Mission[] {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`${path}: expected a JSON list`);
  return raw.map((m, i) => validate(m, i, duration, path));
}

function validate(
  m: unknown,
  i: number,
  duration: number,
  path: string,
): Mission {
  const fail = (why: string): never => {
    throw new Error(`${path}[${i}]: ${why}`);
  };
  if (typeof m !== "object" || m === null) return fail("not an object");
  const r = m as Record<string, unknown>;
  const num = (rec: Record<string, unknown>, key: string): number =>
    typeof rec[key] === "number" && Number.isFinite(rec[key])
      ? (rec[key] as number)
      : fail(`${key} must be a number`);
  const str = (rec: Record<string, unknown>, key: string): string =>
    typeof rec[key] === "string" && rec[key] !== ""
      ? (rec[key] as string)
      : fail(`${key} must be a non-empty string`);

  const t = num(r, "t");
  if (t < 0 || t >= duration) fail(`t=${t} is outside the run (${duration}s)`);
  const text = str(r, "text");
  const reward = num(r, "reward");
  if (reward <= 0) fail("reward must be positive");
  const window = r.window === undefined ? duration - t : num(r, "window");
  if (window <= 0) fail("window must be positive");
  if (t + window > duration)
    fail(`the window runs past the run's end (${duration}s)`);

  if (typeof r.event !== "object" || r.event === null)
    return fail("event must be an object");
  const e = r.event as Record<string, unknown>;
  let event: Event;
  if (e.kind === "deliver") {
    if (!text.includes("{x}") || !text.includes("{y}"))
      fail("a delivery's text must name {x} and {y}");
    const parcel = e.parcel === undefined ? duration - t + 1 : num(e, "parcel");
    if (parcel <= 0) fail("parcel must be positive");
    event = { kind: "deliver", parcel };
  } else if (e.kind === "answer") {
    event = { kind: "answer", accept: str(e, "accept") };
  } else return fail(`event.kind must be "deliver" or "answer"`);
  return { t, text, event, reward, window };
}

interface Position {
  x: number;
  y: number;
}

/**
 * The walkable, non-delivery tile farthest (Manhattan) from the nearest of
 * `from`; ties go to the lowest x, then y. Undefined on a map with no such
 * tile.
 */
export function farthestTile(
  tiles: unknown[][],
  from: Position[],
): Position | undefined {
  let best: { at: Position; gap: number } | undefined;
  for (const [x, column] of tiles.entries())
    for (const [y, tile] of column.entries()) {
      const type = String(tile);
      if (type.startsWith("0") || type.startsWith("2")) continue;
      const gap = Math.min(
        Number.POSITIVE_INFINITY,
        ...from.map((p) => Math.abs(p.x - x) + Math.abs(p.y - y)),
      );
      if (best === undefined || gap > best.gap) best = { at: { x, y }, gap };
    }
  return best?.at;
}

/** Schedule every mission from t0; the returned function cancels what is left. */
export function runMissions(options: MissionOptions): () => void {
  const { director, sensing, agents, tiles, missions, t0, log } = options;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let stopped = false;
  const at = (ms: number, fn: () => void): void => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!stopped) fn();
    }, ms);
    timers.add(timer);
  };
  const stamp = (event: Record<string, unknown>): void =>
    log({ t: (Date.now() - t0) / 1000, wall: Date.now(), ...event });
  const nameOf = (id: string): string =>
    agents.find((a) => a.id === id)?.name ?? id;

  // Watchers run on every snapshot until they return true.
  type Watcher = (sensing: IOSensing) => boolean;
  const watchers = new Set<Watcher>();
  sensing.on((snapshot) => {
    if (stopped) return;
    for (const watch of [...watchers])
      if (watch(snapshot)) watchers.delete(watch);
  });

  interface Active {
    mission: Mission;
    paid: Set<string>;
    open: boolean;
  }
  const active = new Set<Active>();

  function pay(a: Active, id: string): void {
    a.paid.add(id);
    const { text, reward } = a.mission;
    const before =
      sensing.latest()?.agents.find((x) => x.id === id)?.score ?? 0;
    director.reward(id, reward);
    stamp({ mission: text, rewarded: nameOf(id), points: reward, before });
    const confirm: Watcher = (s) => {
      const score = s.agents.find((x) => x.id === id)?.score;
      if (score === undefined || score < before + reward) return false;
      stamp({ mission: text, confirmed: nameOf(id), score });
      return true;
    };
    watchers.add(confirm);
    at(PAY_TIMEOUT_MS, () => {
      if (watchers.delete(confirm))
        stamp({ mission: text, unconfirmed: nameOf(id) });
    });
  }

  function start(m: Mission): void {
    const a: Active = { mission: m, paid: new Set(), open: true };
    active.add(a);
    at(m.window * 1_000, () => {
      a.open = false;
      active.delete(a);
      stamp({ mission: m.text, closed: true, rewarded: a.paid.size });
    });
    const text = m.text.replaceAll("{reward}", String(m.reward));
    if (m.event.kind === "answer") {
      director.shout(text);
      stamp({ mission: m.text, shouted: text });
      return;
    }
    deliver(a, m.event, text);
  }

  function deliver(
    a: Active,
    event: Event & { kind: "deliver" },
    template: string,
  ): void {
    const m = a.mission;
    const now = sensing.latest();
    const known = new Set((now?.parcels ?? []).map((p) => p.id));
    const where = (now?.agents ?? [])
      .filter((x) => x.x !== undefined && x.y !== undefined)
      .map((x) => ({ x: Math.round(x.x ?? 0), y: Math.round(x.y ?? 0) }));
    const spot = farthestTile(tiles, where);
    if (spot === undefined) {
      stamp({ mission: m.text, "spawn-failed": true, why: "no free tile" });
      return;
    }
    const text = template
      .replaceAll("{x}", String(spot.x))
      .replaceAll("{y}", String(spot.y));
    director.shout(text);
    stamp({ mission: m.text, shouted: text });
    director.createParcel(spot.x, spot.y, event.parcel);
    let id: string | undefined;
    let carrier: string | undefined;
    const track: Watcher = (s) => {
      const p = s.parcels.find((q) => q.id === id);
      if (p !== undefined) {
        if (p.carriedBy && carrier === undefined) {
          carrier = p.carriedBy;
          stamp({ mission: m.text, picked: id, by: nameOf(carrier) });
        }
        return false;
      }
      if (carrier === undefined) {
        stamp({ mission: m.text, vanished: id });
        return true;
      }
      stamp({
        mission: m.text,
        delivered: id,
        by: nameOf(carrier),
        late: !a.open,
      });
      if (a.open && !a.paid.has(carrier)) pay(a, carrier);
      return true;
    };
    const spawned: Watcher = (s) => {
      const fresh = s.parcels.find(
        (p) => !known.has(p.id) && p.x === spot.x && p.y === spot.y,
      );
      if (fresh === undefined) return false;
      id = fresh.id;
      stamp({
        mission: m.text,
        spawned: id,
        x: spot.x,
        y: spot.y,
        parcel: fresh.reward,
      });
      watchers.add(track);
      return true;
    };
    watchers.add(spawned);
    at(SPAWN_TIMEOUT_MS, () => {
      if (id === undefined && watchers.delete(spawned))
        stamp({ mission: m.text, "spawn-failed": true, x: spot.x, y: spot.y });
    });
  }

  director.onMsg((fromId, payload) => {
    if (stopped || typeof payload !== "string") return;
    if (!agents.some((x) => x.id === fromId)) return;
    const questions = [...active].filter(
      (a) => a.mission.event.kind === "answer",
    );
    if (questions.length === 0) {
      stamp({ unsolicited: payload, from: nameOf(fromId) });
      return;
    }
    for (const a of questions) {
      const { accept } = a.mission.event as Event & { kind: "answer" };
      const correct = payload.toLowerCase().includes(accept.toLowerCase());
      stamp({
        mission: a.mission.text,
        answered: payload,
        from: nameOf(fromId),
        correct,
      });
      if (correct && !a.paid.has(fromId)) pay(a, fromId);
    }
  });

  for (const m of missions) at(m.t * 1_000, () => start(m));

  return () => {
    stopped = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
}
