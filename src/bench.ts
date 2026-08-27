import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { env } from "./env.js";

// usage: bench.ts <agent>... [--time seconds] [--map file.json]
// Each agent gets a fresh identity, so every run starts from score 0.

interface Sample {
  t: number;
  score: number;
}

const args = process.argv.slice(2);
const agents: string[] = [];
let seconds = 120;
let mapFile: string | undefined;
for (let i = 0; i < args.length; i++) {
  const arg = args[i] as string;
  if (arg === "--time") seconds = Number(args[++i]);
  else if (arg === "--map") mapFile = args[++i];
  else agents.push(arg);
}

if (agents.length === 0)
  throw new Error("usage: bench.ts <agent>... [--time s] [--map file.json]");
for (const agent of agents)
  if (!existsSync(`src/agents/${agent}.ts`))
    throw new Error(`no such agent: src/agents/${agent}.ts`);

if (mapFile) {
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

async function mint(agent: string): Promise<string> {
  const response = await fetch(`${env.HOST}/api/tokens`, {
    method: "POST",
    headers: { name: `bench-${agent}`, team: env.TEAM },
  });
  if (!response.ok) throw new Error(`minting for ${agent}: ${response.status}`);
  const { token } = (await response.json()) as { token: string };
  return token;
}

const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
const dir = `.run/bench/${stamp}`;
mkdirSync(dir, { recursive: true });

const t0 = Date.now();
const series = new Map<string, Sample[]>();
const children: ChildProcess[] = [];

for (const agent of agents) {
  const child = spawn("npx", ["tsx", `src/agents/${agent}.ts`], {
    env: { ...process.env, TOKEN: await mint(agent) },
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
  child.on("exit", () => writeFileSync(`${dir}/${agent}.log`, raw.join("\n")));
}

console.log(`${agents.join(" vs ")} for ${seconds}s on ${env.HOST}`);

const stop = (): void => {
  for (const child of children) child.kill("SIGTERM");
};
process.once("SIGINT", () => {
  stop();
  process.exit(130);
});

await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
stop();
await new Promise((resolve) => setTimeout(resolve, 500));

const at = (samples: Sample[], t: number): number =>
  samples.filter((s) => s.t <= t).at(-1)?.score ?? 0;

const marks = [...Array(7)].map((_, i) => Math.round((seconds * i) / 6));
const rows = agents.map((agent) => {
  const samples = series.get(agent) ?? [];
  return [agent, ...marks.map((t) => at(samples, t))];
});

const header = ["agent", ...marks.map((t) => `${t}s`)];
const widths = header.map((h, c) =>
  Math.max(h.length, ...rows.map((r) => String(r[c]).length)),
);
const line = (cells: (string | number)[]): string =>
  cells.map((cell, c) => String(cell).padStart(widths[c] ?? 0)).join("  ");
console.log(line(header));
for (const row of rows) console.log(line(row));

writeFileSync(
  `${dir}/scores.csv`,
  [
    "agent,t,score",
    ...agents.flatMap((agent) =>
      (series.get(agent) ?? []).map(
        (s) => `${agent},${s.t.toFixed(1)},${s.score}`,
      ),
    ),
  ].join("\n"),
);
console.log(`series in ${dir}/scores.csv, logs in ${dir}/`);
process.exit(0);
