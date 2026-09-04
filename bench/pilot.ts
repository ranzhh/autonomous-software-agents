import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { runBenchmark } from "./lib.js";
import { SUITE } from "./suite.js";

/**
 * Repeats one seed several times and runs every other seed once, so the spread
 * within a seed can be compared with the spread between seeds.
 */
const { values } = parseArgs({
  options: {
    maps: { type: "string", default: SUITE.join(",") },
    agent: { type: "string", default: "greedy" },
    duration: { type: "string", default: "120" },
    repeats: { type: "string", default: "5" },
    seeds: { type: "string", default: "1,2,3,4,5" },
    parallel: { type: "string", default: "2" },
    server: { type: "string", default: process.env.DELIVEROO_SERVER },
    campaign: { type: "string", default: "pilot" },
    basePort: { type: "string", default: "8100" },
  },
});

if (!values.server)
  throw new Error("pass --server or set DELIVEROO_SERVER to the backend dir");
const server = values.server;

const maps = values.maps.split(",");
const seeds = values.seeds.split(",");
const [repeatedSeed, ...otherSeeds] = seeds;
if (!repeatedSeed) throw new Error("need at least one seed");
const repeats = Number(values.repeats);
const duration = Number(values.duration);

interface Job {
  map: string;
  seed: string;
  rep: number;
}
const jobs: Job[] = [];
for (const map of maps) {
  for (let rep = 0; rep < repeats; rep++)
    jobs.push({ map, seed: repeatedSeed, rep });
  for (const seed of otherSeeds) jobs.push({ map, seed, rep: 0 });
}

const outDir = (job: Job) =>
  `bench/results/${values.campaign}/${job.map}__${values.agent}__s${job.seed}__r${job.rep}`;

const pending = jobs.filter((job) => !existsSync(`${outDir(job)}/meta.json`));
console.log(`${pending.length} of ${jobs.length} runs to do`);

let nextPort = Number(values.basePort);
async function worker(): Promise<void> {
  for (;;) {
    const job = pending.shift();
    if (!job) return;
    const port = nextPort++;
    const startedAt = Date.now();
    const meta = await runBenchmark({
      map: job.map,
      seed: job.seed,
      agent: values.agent,
      duration,
      port,
      server,
      out: outDir(job),
    });
    console.log(
      `${job.map} seed=${job.seed} rep=${job.rep} score=${meta.finalScore} penalty=${meta.finalPenalty} (${Math.round((Date.now() - startedAt) / 1000)}s)`,
    );
  }
}

await Promise.all(
  Array.from({ length: Number(values.parallel) }, () => worker()),
);
