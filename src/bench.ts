import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import {
  identityNames,
  type Member,
  type Mission,
  parallelMap,
  type RunMeta,
  runBenchmark,
} from "../bench/lib.js";
import { SUITE } from "../bench/suite.js";

const USAGE =
  "usage: bench.ts [agent[@team]]... [--team a,b]... [--time s] [--runs n] [--map name|file.json]... [--seed n] [--server dir] [--parallel n] [--campaign name] [--missions file.json]";
// One fresh server per run. Run k of n uses seed + k - 1, on the server and
// every agent alike. A bare agent is a team of its own; `--team a,b` is a team
// named team1, team2... in order; `a@red` names the team. Agents spawn in the
// order given. Without --map the suite is the matrix. Missions are a JSON
// list of { t, text }, said to every agent t seconds into the run.

const args = process.argv.slice(2);
const agents: Member[] = [];
const maps: string[] = [];
let seconds = 120;
let runs = 1;
let seed = 1;
let parallel = 2;
let server = process.env.DELIVEROO_SERVER;
let campaign = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
let missionsFile: string | undefined;
let teamsGiven = 0;
for (let i = 0; i < args.length; i++) {
  const arg = args[i] as string;
  if (arg === "--time") seconds = Number(args[++i]);
  else if (arg === "--runs") runs = Number(args[++i]);
  else if (arg === "--map") maps.push(args[++i] as string);
  else if (arg === "--seed") seed = Number(args[++i]);
  else if (arg === "--server") server = args[++i];
  else if (arg === "--parallel") parallel = Number(args[++i]);
  else if (arg === "--campaign") campaign = args[++i] as string;
  else if (arg === "--missions") missionsFile = args[++i];
  else if (arg === "--team") {
    const team = `team${++teamsGiven}`;
    for (const agent of (args[++i] ?? "").split(",").filter(Boolean))
      agents.push({ agent, team });
  } else if (arg.startsWith("-"))
    throw new Error(`unknown flag ${arg}\n${USAGE}`);
  else {
    const [agent, team] = arg.split("@") as [string, string?];
    // Own team, named after the identity, so two bare agents of one script stay apart.
    agents.push({ agent, team: team ?? "" });
  }
}

if (agents.length === 0) throw new Error(USAGE);
for (const [i, name] of identityNames(agents.map((m) => m.agent)).entries()) {
  const member = agents[i] as Member;
  if (member.team === "") member.team = name;
}
for (const { agent } of agents)
  if (!existsSync(`src/agents/${agent}.ts`))
    throw new Error(`no such agent: src/agents/${agent}.ts`);
for (const map of maps)
  if (map.endsWith(".json") && !existsSync(map))
    throw new Error(`no such map: ${map}`);
if (!server)
  throw new Error("pass --server or set DELIVEROO_SERVER to the backend dir");
const serverDir = server;
if (missionsFile && !existsSync(missionsFile))
  throw new Error(`no such missions file: ${missionsFile}`);
const missions: Mission[] = missionsFile
  ? (JSON.parse(readFileSync(missionsFile, "utf8")) as Mission[])
  : [];
for (const m of missions)
  if (typeof m.t !== "number" || typeof m.text !== "string")
    throw new Error(
      `missions must be { t: number, text: string }: ${JSON.stringify(m)}`,
    );
if (missions.some((m) => m.t >= seconds))
  throw new Error(
    `a mission is scheduled at or after the run ends (${seconds}s)`,
  );

const boards = maps.length > 0 ? maps : [...SUITE];
const labelOf = (map: string) => basename(map).replace(/\.json$/, "");

interface Job {
  map: string;
  seed: string;
}
const jobs: Job[] = boards.flatMap((map) =>
  Array.from({ length: runs }, (_, k) => ({ map, seed: String(seed + k) })),
);
const order = agents.map((m) => m.agent).join("+");
const outDir = (job: Job) =>
  `bench/results/${campaign}/${labelOf(job.map)}__${order}__s${job.seed}`;
/** Teams in first-appearance order, members joined by +, teams by vs. */
const lineup = [...new Set(agents.map((m) => m.team))]
  .map((team) =>
    agents
      .filter((m) => m.team === team)
      .map((m) => m.agent)
      .join("+"),
  )
  .join(" vs ");

const marks = [...Array(7)].map((_, i) => Math.round((seconds * i) / 6));

interface Sample {
  t: number;
  score: number;
}
/** Score series per identity name, read back from the run's observer snapshots. */
function series(meta: RunMeta): Map<string, Sample[]> {
  const out = new Map<string, Sample[]>(meta.agents.map((a) => [a.name, []]));
  for (const line of readFileSync(`${meta.out}/observer.ndjson`, "utf8")
    .trim()
    .split("\n")) {
    const snap = JSON.parse(line) as {
      t: number;
      agents: { id: string; score: number }[];
    };
    for (const a of meta.agents) {
      const score = snap.agents.find((x) => x.id === a.id)?.score ?? 0;
      out.get(a.name)?.push({ t: snap.t, score });
    }
  }
  return out;
}

// The observer samples once a second on a drifting interval, so the snapshot
// for second n lands a few ms past n and the closing one just past `seconds`.
// Half a period of slack takes each mark's own snapshot, never the next.
const JITTER = 0.5;
const at = (samples: Sample[], t: number): number =>
  samples.filter((s) => s.t <= t + JITTER).at(-1)?.score ?? 0;

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

console.log(
  `${lineup}, ${runs} run(s) of ${seconds}s on ${boards.map(labelOf).join(", ")}, seeds ${seed}..${seed + runs - 1}, ${parallel} at a time${missions.length > 0 ? `, ${missions.length} mission(s)` : ""}`,
);

const metas = await parallelMap(jobs, parallel, async (job, index) => {
  const meta = await runBenchmark({
    map: job.map,
    seed: job.seed,
    agents,
    duration: seconds,
    port: 8100 + index,
    server: serverDir,
    out: outDir(job),
    missions,
  });
  console.log(`\n${labelOf(job.map)} seed ${job.seed}`);
  const s = series(meta);
  table(
    meta.agents.map((a) => [
      a.name,
      ...marks.map((t) => at(s.get(a.name) ?? [], t)),
    ]),
  );
  return meta;
});

const rows = ["agent,map,seed,t,score"];
for (const meta of metas)
  for (const [name, samples] of series(meta))
    for (const s of samples)
      rows.push(
        `${name},${labelOf(meta.map)},${meta.seed},${s.t.toFixed(1)},${s.score}`,
      );
writeFileSync(`bench/results/${campaign}/scores.csv`, `${rows.join("\n")}\n`);

if (runs > 1)
  for (const map of boards) {
    const here = metas.filter((m) => m.map === map);
    console.log(`\n${labelOf(map)} mean of ${here.length} runs`);
    table(
      (here[0]?.agents ?? []).map((a) => [
        a.name,
        ...marks.map((t) => {
          const sum = here.reduce(
            (acc, m) => acc + at(series(m).get(a.name) ?? [], t),
            0,
          );
          return Number((sum / here.length).toFixed(1));
        }),
      ]),
    );
  }

console.log(`\nruns in bench/results/${campaign}/, series in scores.csv`);
