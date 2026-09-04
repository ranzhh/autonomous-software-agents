import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DjsConnect } from "@unitn-asa/deliveroo-js-sdk";
import type { IOAgent, IOConfig, IOSensing } from "../src/sdk.js";

/**
 * One benchmark run: a fresh server on `map` with `seed`, one agent, `duration`
 * seconds counted from the moment the agent appears on the grid. An admin
 * observer (no position, sees everything) snapshots the grid once a second.
 */
export interface RunOptions {
  /** Game name from the assets package, or a path to a game JSON file. */
  map: string;
  seed: string;
  /** Basename of a script in src/agents/. */
  agent: string;
  /** Seconds of play after the agent spawns. */
  duration: number;
  port: number;
  /** Directory of the server's backend package (holds index.js). */
  server: string;
  /** Output directory for this run; created if missing. */
  out: string;
  team?: string;
}

export interface Snapshot {
  /** Seconds since the agent under test spawned. */
  t: number;
  wall: number;
  agents: IOAgent[];
  parcels: IOSensing["parcels"];
}

export interface RunMeta extends RunOptions {
  agentId: string;
  agentName: string;
  serverRevision: string;
  serverVersion: string;
  node: string;
  startedAt: string;
  spawnedAt: string;
  endedAt: string;
  finalScore: number;
  finalPenalty: number;
  snapshots: number;
  config: IOConfig;
}

const READY_TIMEOUT_MS = 30_000;
const SPAWN_TIMEOUT_MS = 30_000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  const { map, seed, agent, duration, port, out } = options;
  const server = resolve(options.server);
  const team = options.team ?? "bench";
  const host = `http://localhost:${port}`;
  mkdirSync(out, { recursive: true });

  const startedAt = new Date().toISOString();
  const serverLog = createWriteStream(join(out, "server.log"));
  const agentLog = createWriteStream(join(out, "agent.log"));
  const observerLog = createWriteStream(join(out, "observer.ndjson"));

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

  let agentProcess: ChildProcess | undefined;
  let observer: ReturnType<typeof DjsConnect> | undefined;

  const cleanup = async () => {
    observer?.disconnect();
    if (agentProcess) await terminate(agentProcess);
    await terminate(serverProcess);
    serverLog.end();
    agentLog.end();
    observerLog.end();
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

    // The observer connects before the agent so it consumes the same placement draw every run.
    const admin = await mintToken(host, {
      name: "observer",
      password: ADMIN_PASSWORD,
    });
    observer = DjsConnect(host, admin.token, "observer");
    let latest: IOSensing | undefined;
    observer.onSensing((sensing) => {
      latest = sensing;
    });

    const identity = await mintToken(host, { name: agent, team });
    agentProcess = spawn(
      join("node_modules", ".bin", "tsx"),
      [join("src", "agents", `${agent}.ts`)],
      {
        cwd: resolve(import.meta.dirname, ".."),
        env: {
          ...process.env,
          HOST: host,
          TOKEN: identity.token,
          NAME: agent,
          TEAM: team,
          SEED: seed,
          LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    agentProcess.stdout?.pipe(agentLog);
    agentProcess.stderr?.pipe(agentLog);

    const seen = () =>
      latest?.agents.find(
        (a) => a.id === identity.id && a.x !== undefined && a.y !== undefined,
      );
    const spawnDeadline = Date.now() + SPAWN_TIMEOUT_MS;
    while (!seen()) {
      if (Date.now() > spawnDeadline)
        throw new Error(`agent ${agent} never spawned on ${map}`);
      if (agentProcess.exitCode !== null)
        throw new Error(`agent ${agent} exited with ${agentProcess.exitCode}`);
      await sleep(50);
    }
    const t0 = Date.now();
    const spawnedAt = new Date(t0).toISOString();

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

    const final = latest?.agents.find((a) => a.id === identity.id);
    const meta: RunMeta = {
      ...options,
      server,
      team,
      agentId: identity.id,
      agentName: agent,
      serverRevision: about.commitHash,
      serverVersion: about.packageVersion,
      node: process.version,
      startedAt,
      spawnedAt,
      endedAt: new Date().toISOString(),
      finalScore: final?.score ?? 0,
      finalPenalty: final?.penalty ?? 0,
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
