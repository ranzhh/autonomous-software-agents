import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { env } from "./env.js";

// usage: bench.ts <agent>... [--time seconds] [--runs n] [--map file.json]
// Each agent gets a fresh identity per run, so every run starts from score 0.
// --map only works against a local host: it rewrites the shared board.

interface Sample {
  t: number;
  score: number;
}

const args = process.argv.slice(2);
const agents: string[] = [];
let seconds = 120;
let runs = 1;
let mapFile: string | undefined;
for (let i = 0; i < args.length; i++) {
  const arg = args[i] as string;
  if (arg === "--time") seconds = Number(args[++i]);
  else if (arg === "--runs") runs = Number(args[++i]);
  else if (arg === "--map") mapFile = args[++i];
  else agents.push(arg);
}

if (agents.length === 0)
  throw new Error(
    "usage: bench.ts <agent>... [--time s] [--runs n] [--map file.json]",
  );
for (const agent of agents)
  if (!existsSync(`src/agents/${agent}.ts`))
    throw new Error(`no such agent: src/agents/${agent}.ts`);

if (mapFile) {
  // The map is global server state: a patch repaints the board for every
  // connected client, not just this race. Refuse anything but a local host.
  const host = new URL(env.HOST).hostname;
  if (host !== "localhost" && host !== "127.0.0.1")
    throw new Error(`--map refuses a non-local host: ${env.HOST}`);
  if (!env.ADMIN_TOKEN) throw new Error("--map needs ADMIN_TOKEN in the env");
  const map = JSON.parse(readFileSync(mapFile, "utf8"));
  const response = await fetch(`${env.HOST}/api/configs`, {
    method: "PATCH",
    headers: { "content-type": "application/json", token: env.ADMIN_TOKEN },
    // A patch without `parcels` crashes the server: loadGameConfig reads
    // json.parcels.max unguarded (Deliveroo.js config.js:52).
    body: JSON.stringify({ GAME: { map, parcels: {} } }),
  });
  if (!response.ok) throw new Error(`posting the map: ${response.status}`);
  console.log(`map ${mapFile} posted to ${env.HOST}`);
}

async function mint(agent: string, run: number): Promise<string> {
  const name = runs > 1 ? `bench-${agent}-${run}` : `bench-${agent}`;
  // A transient DNS failure here would kill the whole race; retry twice.
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(`${env.HOST}/api/tokens`, {
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

let children: ChildProcess[] = [];
const stop = (): void => {
  for (const child of children)
    if (child.pid)
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // The whole group already exited.
      }
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

async function race(run: number): Promise<Map<string, Sample[]>> {
  const t0 = Date.now();
  const series = new Map<string, Sample[]>();
  children = [];

  for (const agent of agents) {
    const child = spawn("npx", ["tsx", `src/agents/${agent}.ts`], {
      env: { ...process.env, TOKEN: await mint(agent, run) },
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
    const log = runs > 1 ? `${agent}-${run}.log` : `${agent}.log`;
    child.on("exit", () => writeFileSync(`${dir}/${log}`, raw.join("\n")));
  }

  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  stop();
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

const races = runs > 1 ? `${runs} runs of ${seconds}s` : `${seconds}s`;
console.log(`${agents.join(" vs ")}, ${races} on ${env.HOST}`);

const all: Map<string, Sample[]>[] = [];

// Rewritten after every run, so a crash mid-series loses one run at most.
const save = (): void =>
  writeFileSync(
    `${dir}/scores.csv`,
    [
      "agent,run,t,score",
      ...all.flatMap((series, i) =>
        agents.flatMap((agent) =>
          (series.get(agent) ?? []).map(
            (s) => `${agent},${i + 1},${s.t.toFixed(1)},${s.score}`,
          ),
        ),
      ),
    ].join("\n"),
  );

for (let run = 1; run <= runs; run++) {
  const series = await race(run);
  all.push(series);
  save();
  if (runs > 1) console.log(`run ${run}/${runs}`);
  table(
    agents.map((agent) => [
      agent,
      ...marks.map((t) => at(series.get(agent) ?? [], t)),
    ]),
  );
}

if (runs > 1) {
  console.log(`mean of ${runs} runs`);
  table(
    agents.map((agent) => [
      agent,
      ...marks.map((t) => {
        const sum = all.reduce((s, run) => s + at(run.get(agent) ?? [], t), 0);
        return Number((sum / runs).toFixed(1));
      }),
    ]),
  );
}

console.log(`series in ${dir}/scores.csv, logs in ${dir}/`);
process.exit(0);
