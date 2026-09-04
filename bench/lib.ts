import { type ChildProcess, spawn } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { DjsConnect } from "@unitn-asa/deliveroo-js-sdk";
import type { IOAgent, IOConfig, IOSensing } from "../src/sdk.js";

/**
 * One run: a fresh server on `map` with `seed`, the listed agents on it in
 * their teams, `duration` seconds from the moment the last of them has spawned.
 * An admin observer, which has no position and sees the whole grid, snapshots
 * it once a second. With missions, an admin "director" says the mission text,
 * a plain string, to every agent at the given second, and records whatever
 * they say back.
 */
export interface RunOptions {
  /** Game name from the assets package, or a path to a game JSON file. */
  map: string;
  seed: string;
  /** In spawn order; a repeated script runs twice. */
  agents: Member[];
  /** Seconds of play after every agent has spawned. */
  duration: number;
  port: number;
  /** Directory of the server's backend package (holds index.js). */
  server: string;
  /** Output directory for this run; created if missing. */
  out: string;
  missions?: Mission[];
}

export interface Member {
  /** Script basename in src/agents/. */
  agent: string;
  /** Members sharing a team name share the server's team. */
  team: string;
}

export interface Mission {
  /** Seconds after the last agent spawned. */
  t: number;
  text: string;
}

export interface Snapshot {
  /** Seconds since the last agent spawned. */
  t: number;
  wall: number;
  agents: IOAgent[];
  parcels: IOSensing["parcels"];
}

export interface AgentResult {
  /** Script basename. */
  agent: string;
  /** Identity name: the script basename, suffixed when repeated. */
  name: string;
  id: string;
  team: string;
  teamId: string | undefined;
  finalScore: number;
  finalPenalty: number;
}

export interface RunMeta extends Omit<RunOptions, "agents"> {
  agents: AgentResult[];
  serverRevision: string;
  serverVersion: string;
  node: string;
  startedAt: string;
  spawnedAt: string;
  endedAt: string;
  snapshots: number;
  config: IOConfig;
}

const READY_TIMEOUT_MS = 30_000;
const SPAWN_TIMEOUT_MS = 30_000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Identity names for the agent list: greedy, greedy-2, naive. */
export function identityNames(agents: string[]): string[] {
  const seen = new Map<string, number>();
  return agents.map((agent) => {
    const n = (seen.get(agent) ?? 0) + 1;
    seen.set(agent, n);
    return n === 1 ? agent : `${agent}-${n}`;
  });
}

/** Runs `work` over `items`, at most `parallel` at a time, in order of start. */
export async function parallelMap<T, R>(
  items: T[],
  parallel: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      const item = items[index];
      if (index >= items.length || item === undefined) return;
      results[index] = await work(item, index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, parallel) }, () => worker()),
  );
  return results;
}

async function waitForServer(host: string): Promise<IOConfig> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${host}/api/configs`);
      if (response.ok) return (await response.json()) as IOConfig;
    } catch {
      // not listening yet
    }
    await sleep(200);
  }
  throw new Error(`server at ${host} not ready after ${READY_TIMEOUT_MS}ms`);
}

async function mintToken(
  host: string,
  headers: Record<string, string>,
): Promise<{ token: string; id: string }> {
  const response = await fetch(`${host}/api/tokens`, {
    method: "POST",
    headers,
  });
  if (!response.ok)
    throw new Error(`minting a token failed: ${response.status}`);
  const { token, payload } = (await response.json()) as {
    token: string;
    payload: { id: string };
  };
  return { token, id: payload.id };
}

function stopped(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", () => resolve());
  });
}

async function terminate(child: ChildProcess, graceMs = 5_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([stopped(child), sleep(graceMs)]);
  if (child.exitCode === null && child.signalCode === null)
    child.kill("SIGKILL");
  await stopped(child);
}

export async function runBenchmark(options: RunOptions): Promise<RunMeta> {
  const { map, seed, agents, duration, port, out } = options;
  if (agents.length === 0) throw new Error("no agents to run");
  const server = resolve(options.server);
  // The seeding patch adds this module; an unpatched server ignores SEED silently.
  if (!existsSync(join(server, "src", "utils", "random.js")))
    throw new Error(
      `${server} is not patched for seeding: apply bench/deliveroo-seed.patch`,
    );
  const teamSizes = new Map<string, number>();
  for (const { team } of agents)
    teamSizes.set(team, (teamSizes.get(team) ?? 0) + 1);
  if (
    [...teamSizes.values()].some((size) => size > 1) &&
    !readFileSync(
      join(server, "src", "middlewares", "token.js"),
      "utf8",
    ).includes("|| (teamName ?")
  )
    throw new Error(
      `${server} does not inherit teams from a token: apply bench/deliveroo-team.patch`,
    );
  const missions = [...(options.missions ?? [])].sort((a, b) => a.t - b.t);
  const host = `http://localhost:${port}`;
  mkdirSync(out, { recursive: true });

  const startedAt = new Date().toISOString();
  const serverLog = createWriteStream(join(out, "server.log"));
  const observerLog = createWriteStream(join(out, "observer.ndjson"));
  const missionLog =
    missions.length > 0
      ? createWriteStream(join(out, "missions.ndjson"))
      : undefined;
  const agentLogs: ReturnType<typeof createWriteStream>[] = [];

  const gameEnv = map.endsWith(".json") ? {} : { GAME_NAME: map };
  const gameArgs = map.endsWith(".json") ? ["-g", resolve(map)] : [];
  const serverProcess = spawn(
    "node",
    ["index.js", "-p", String(port), ...gameArgs],
    {
      cwd: server,
      env: { ...process.env, ...gameEnv, SEED: seed, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  serverProcess.stdout?.pipe(serverLog);
  serverProcess.stderr?.pipe(serverLog);

  const agentProcesses: ChildProcess[] = [];
  let observer: ReturnType<typeof DjsConnect> | undefined;
  let director: ReturnType<typeof DjsConnect> | undefined;
  const timers: ReturnType<typeof setTimeout>[] = [];

  const cleanup = async () => {
    for (const timer of timers) clearTimeout(timer);
    director?.disconnect();
    observer?.disconnect();
    await Promise.all(agentProcesses.map((child) => terminate(child)));
    await terminate(serverProcess);
    serverLog.end();
    observerLog.end();
    missionLog?.end();
    for (const log of agentLogs) log.end();
  };

  const onSignal = () => {
    void cleanup().then(() => process.exit(130));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    const config = await waitForServer(host);
    const about = (await (await fetch(`${host}/api`)).json()) as {
      commitHash: string;
      packageVersion: string;
    };

    // The observer connects first so it consumes the same placement draw every run.
    const admin = await mintToken(host, {
      name: "observer",
      password: ADMIN_PASSWORD,
    });
    observer = DjsConnect(host, admin.token, "observer");
    let latest: IOSensing | undefined;
    observer.onSensing((sensing) => {
      latest = sensing;
    });

    const names = identityNames(agents.map((m) => m.agent));
    const identities: {
      agent: string;
      name: string;
      team: string;
      id: string;
    }[] = [];
    // A mint that carries a teammate's token inherits its teamId; otherwise
    // the server mints a new team per token, whatever the team label says.
    const teamTokens = new Map<string, string>();
    for (const [i, { agent, team }] of agents.entries()) {
      const name = names[i] as string;
      const teamToken = teamTokens.get(team);
      const identity = await mintToken(
        host,
        teamToken ? { name, authorization: teamToken } : { name, team },
      );
      teamTokens.set(team, teamToken ?? identity.token);
      identities.push({ agent, name, team, id: identity.id });
      const log = createWriteStream(join(out, `${name}.log`));
      agentLogs.push(log);
      const child = spawn(
        join("node_modules", ".bin", "tsx"),
        [join("src", "agents", `${agent}.ts`)],
        {
          cwd: resolve(import.meta.dirname, ".."),
          env: {
            ...process.env,
            HOST: host,
            TOKEN: identity.token,
            NAME: name,
            TEAM: team,
            SEED: seed,
            LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.stdout?.pipe(log);
      child.stderr?.pipe(log);
      agentProcesses.push(child);
    }

    const positioned = (id: string) =>
      latest?.agents.some(
        (a) => a.id === id && a.x !== undefined && a.y !== undefined,
      );
    const spawnDeadline = Date.now() + SPAWN_TIMEOUT_MS;
    while (!identities.every(({ id }) => positioned(id))) {
      if (Date.now() > spawnDeadline)
        throw new Error(
          `not every agent spawned on ${map}: ${identities
            .filter(({ id }) => !positioned(id))
            .map(({ name }) => name)
            .join(", ")}`,
        );
      for (const [i, child] of agentProcesses.entries())
        if (child.exitCode !== null)
          throw new Error(`${names[i]} exited with ${child.exitCode}`);
      await sleep(50);
    }
    // The director connects after the agents so it draws no placement of theirs.
    if (missions.length > 0) {
      const admin = await mintToken(host, {
        name: "director",
        password: ADMIN_PASSWORD,
      });
      director = DjsConnect(host, admin.token, "director");
    }

    const t0 = Date.now();
    const spawnedAt = new Date(t0).toISOString();

    director?.onMsg((fromId, fromName, payload) => {
      missionLog?.write(
        `${JSON.stringify({
          t: (Date.now() - t0) / 1000,
          wall: Date.now(),
          heard: payload,
          from: { id: fromId, name: fromName },
        })}\n`,
      );
    });

    for (const mission of missions) {
      const socket = director;
      if (socket === undefined) break;
      timers.push(
        setTimeout(async () => {
          // A bare string: agents read chat text as text and keep objects
          // for their own protocols.
          const acks = await Promise.all(
            identities.map(({ id }) => socket.emitSay(id, mission.text)),
          );
          missionLog?.write(
            `${JSON.stringify({
              t: (Date.now() - t0) / 1000,
              wall: Date.now(),
              said: mission.text,
              to: identities.map(({ name }) => name),
              acks,
            })}\n`,
          );
        }, mission.t * 1_000),
      );
    }

    const snapshot = (): Snapshot => ({
      t: (Date.now() - t0) / 1000,
      wall: Date.now(),
      agents: latest?.agents ?? [],
      parcels: latest?.parcels ?? [],
    });
    let snapshots = 0;
    const record = () => {
      observerLog.write(`${JSON.stringify(snapshot())}\n`);
      snapshots += 1;
    };
    record();
    const ticker = setInterval(record, 1_000);
    await sleep(duration * 1_000);
    clearInterval(ticker);
    record();

    const results: AgentResult[] = identities.map(
      ({ agent, name, team, id }) => {
        const final = latest?.agents.find((a) => a.id === id);
        return {
          agent,
          name,
          id,
          team,
          teamId: final?.teamId,
          finalScore: final?.score ?? 0,
          finalPenalty: final?.penalty ?? 0,
        };
      },
    );
    const meta: RunMeta = {
      map,
      seed,
      duration,
      port,
      out,
      server,
      missions,
      agents: results,
      serverRevision: about.commitHash,
      serverVersion: about.packageVersion,
      node: process.version,
      startedAt,
      spawnedAt,
      endedAt: new Date().toISOString(),
      snapshots,
      config,
    };
    writeFileSync(join(out, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
    return meta;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await cleanup();
  }
}
