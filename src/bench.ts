import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline";
import { env } from "./env.js";

// usage: bench.ts <agent>... [--time s] [--runs n] [--map file.json]...
//                 [--server dir] [--seed n]
// Each agent gets a fresh identity per run, so every run starts from score 0.
// With --server the bench boots a fresh game server per run from that
// directory: repeated --map values become a matrix and --seed pins every
// random draw, server and agents alike, through src/seed.cjs. Without
// --server a single --map rewrites the shared board of a local host.

interface Sample {
  t: number;
  score: number;
}

const args = process.argv.slice(2);
const agents: string[] = [];
const maps: string[] = [];
let seconds = 120;
let runs = 1;
let serverDir: string | undefined;
let seed: number | undefined;
for (let i = 0; i < args.length; i++) {
  const arg = args[i] as string;
  if (arg === "--time") seconds = Number(args[++i]);
  else if (arg === "--runs") runs = Number(args[++i]);
  else if (arg === "--map") maps.push(args[++i] as string);
  else if (arg === "--server") serverDir = args[++i];
  else if (arg === "--seed") seed = Number(args[++i]);
  else agents.push(arg);
}

if (agents.length === 0)
  throw new Error(
    "usage: bench.ts <agent>... [--time s] [--runs n] [--map file.json]... [--server dir] [--seed n]",
  );
for (const agent of agents)
  if (!existsSync(`src/agents/${agent}.ts`))
    throw new Error(`no such agent: src/agents/${agent}.ts`);
for (const map of maps)
  if (!existsSync(map)) throw new Error(`no such map: ${map}`);
if ((seed !== undefined || maps.length > 1) && !serverDir)
  throw new Error("--seed and a map matrix need --server");
if (seed !== undefined && maps.length === 0)
  throw new Error("--seed needs --map");

let host = env.HOST;

if (!serverDir && maps.length === 1) {
  // The map is global server state: a patch repaints the board for every
  // connected client, not just this race. Refuse anything but a local host.
  const hostname = new URL(env.HOST).hostname;
  if (hostname !== "localhost" && hostname !== "127.0.0.1")
    throw new Error(`--map refuses a non-local host: ${env.HOST}`);
  if (!env.ADMIN_TOKEN) throw new Error("--map needs ADMIN_TOKEN in the env");
  const map = JSON.parse(readFileSync(maps[0] as string, "utf8"));
  const response = await fetch(`${env.HOST}/api/configs`, {
    method: "PATCH",
    headers: { "content-type": "application/json", token: env.ADMIN_TOKEN },
    // A patch without `parcels` crashes the server: loadGameConfig reads
    // json.parcels.max unguarded (Deliveroo.js config.js:52).
    body: JSON.stringify({ GAME: { map, parcels: {} } }),
  });
  if (!response.ok) throw new Error(`posting the map: ${response.status}`);
  console.log(`map ${maps[0]} posted to ${env.HOST}`);
}

async function mint(agent: string, run: number): Promise<string> {
  const name = runs > 1 ? `bench-${agent}-${run}` : `bench-${agent}`;
  // A transient DNS failure here would kill the whole race; retry twice.
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(`${host}/api/tokens`, {
        method: "POST",
        headers: { name, team: env.TEAM },
      });
      if (!response.ok)
        throw new Error(`minting for ${agent}: ${response.status}`);
      const { token } = (await response.json()) as { token: string };
      return token;
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
const dir = `.run/bench/${stamp}`;
mkdirSync(dir, { recursive: true });

const PORT = 8123;
let server: ChildProcess | undefined;

async function boot(map: string | undefined, runSeed: number | undefined) {
  const bootArgs = ["index.js", "-p", String(PORT), "--penalty", "0"];
  if (map) bootArgs.push("-g", resolve(map));
  server = spawn("node", bootArgs, {
    cwd: serverDir,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      ...(runSeed === undefined ? {} : { SEED: String(runSeed) }),
      NODE_OPTIONS: `--require ${resolve("src/seed.cjs")}`,
    },
  });
  host = `http://127.0.0.1:${PORT}`;
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      if ((await fetch(`${host}/api/configs`)).ok) return;
    } catch {
      // Not up yet.
    }
  }
  throw new Error(`the server in ${serverDir} never came up`);
}

function killServer(): void {
  if (server?.pid)
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  server = undefined;
}

let children: ChildProcess[] = [];
const stop = (): void => {
  for (const child of children)
    if (child.pid)
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // The whole group already exited.
      }
  killServer();
};
process.once("SIGINT", () => {
  stop();
  process.exit(130);
});
process.once("SIGTERM", () => {
  stop();
  process.exit(143);
});
// A crash anywhere above still sweeps the current run's agents.
process.once("exit", stop);

async function race(
  run: number,
  runSeed: number | undefined,
  label: string,
): Promise<Map<string, Sample[]>> {
  const t0 = Date.now();
  const series = new Map<string, Sample[]>();
  children = [];

  for (const [i, agent] of agents.entries()) {
    const child = spawn("npx", ["tsx", `src/agents/${agent}.ts`], {
      env: {
        ...process.env,
        TOKEN: await mint(agent, run),
        HOST: host,
        // Every agent draws from its own pinned sequence, offset from the
        // server's so the two never share one.
        ...(runSeed === undefined
          ? {}
          : {
              SEED: String(runSeed + 7919 * (i + 1)),
              NODE_OPTIONS: `--require ${resolve("src/seed.cjs")}`,
            }),
      },
      // Its own process group: killing only the npx wrapper orphans the agent.
      detached: true,
    });
    children.push(child);
    series.set(agent, []);

    const raw: string[] = [];
    for (const stream of [child.stdout, child.stderr])
      createInterface({ input: stream }).on("line", (line) => {
        raw.push(line);
        try {
          const { msg, score } = JSON.parse(line);
          if (msg === "score")
            series.get(agent)?.push({ t: (Date.now() - t0) / 1000, score });
        } catch {
          // Not every line is JSON; keep it for the log and move on.
        }
      });
    const tag = boards.length > 1 ? `${agent}-${label}` : agent;
    const log = runs > 1 ? `${tag}-${run}.log` : `${tag}.log`;
    child.on("exit", () => writeFileSync(`${dir}/${log}`, raw.join("\n")));
  }

  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  for (const child of children)
    if (child.pid)
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // The whole group already exited.
      }
  await new Promise((resolve) => setTimeout(resolve, 500));
  return series;
}

const at = (samples: Sample[], t: number): number =>
  samples.filter((s) => s.t <= t).at(-1)?.score ?? 0;

const marks = [...Array(7)].map((_, i) => Math.round((seconds * i) / 6));

const table = (rows: (string | number)[][]): void => {
  const header = ["agent", ...marks.map((t) => `${t}s`)];
  const widths = header.map((h, c) =>
    Math.max(h.length, ...rows.map((r) => String(r[c]).length)),
  );
  const line = (cells: (string | number)[]): string =>
    cells.map((cell, c) => String(cell).padStart(widths[c] ?? 0)).join("  ");
  console.log(line(header));
  for (const row of rows) console.log(line(row));
};

const boards: (string | undefined)[] = serverDir
  ? maps.length > 0
    ? maps
    : [undefined]
  : [undefined];
const labelOf = (board: string | undefined): string =>
  board
    ? basename(board).replace(/\.json$/, "")
    : serverDir
      ? "default"
      : "live";

const races = runs > 1 ? `${runs} runs of ${seconds}s` : `${seconds}s`;
const where = serverDir
  ? `${boards.map(labelOf).join(", ")} via ${serverDir}`
  : env.HOST;
const seeded = seed === undefined ? "" : `, seed ${seed}`;
console.log(`${agents.join(" vs ")}, ${races} on ${where}${seeded}`);

const byBoard = new Map<string, Map<string, Sample[]>[]>();

const save = (): void =>
  writeFileSync(
    `${dir}/scores.csv`,
    [
      "agent,map,run,t,score",
      ...[...byBoard.entries()].flatMap(([label, results]) =>
        results.flatMap((series, i) =>
          agents.flatMap((agent) =>
            (series.get(agent) ?? []).map(
              (s) => `${agent},${label},${i + 1},${s.t.toFixed(1)},${s.score}`,
            ),
          ),
        ),
      ),
    ].join("\n"),
  );

for (const board of boards) {
  const label = labelOf(board);
  const results: Map<string, Sample[]>[] = [];
  byBoard.set(label, results);
  for (let run = 1; run <= runs; run++) {
    const runSeed = seed === undefined ? undefined : seed + run - 1;
    if (serverDir) await boot(board, runSeed);
    const series = await race(run, runSeed, label);
    if (serverDir) killServer();
    results.push(series);
    save();
    if (runs > 1 || boards.length > 1)
      console.log(`${label} run ${run}/${runs}`);
    table(
      agents.map((agent) => [
        agent,
        ...marks.map((t) => at(series.get(agent) ?? [], t)),
      ]),
    );
  }
  if (runs > 1) {
    console.log(`${label} mean of ${runs} runs`);
    table(
      agents.map((agent) => [
        agent,
        ...marks.map((t) => {
          const sum = results.reduce(
            (s, r) => s + at(r.get(agent) ?? [], t),
            0,
          );
          return Number((sum / runs).toFixed(1));
        }),
      ]),
    );
  }
}

console.log(`series in ${dir}/scores.csv, logs in ${dir}/`);
process.exit(0);
