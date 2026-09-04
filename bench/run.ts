import { parseArgs } from "node:util";
import { runBenchmark } from "./lib.js";

const { values } = parseArgs({
  options: {
    map: { type: "string", default: "26c1_3" },
    seed: { type: "string", default: "1" },
    agent: { type: "string", default: "greedy" },
    duration: { type: "string", default: "120" },
    port: { type: "string", default: "8090" },
    server: { type: "string", default: process.env.DELIVEROO_SERVER },
    out: { type: "string" },
  },
});

if (!values.server)
  throw new Error("pass --server or set DELIVEROO_SERVER to the backend dir");

const out =
  values.out ??
  `bench/results/adhoc/${values.map}__${values.agent}__s${values.seed}__${Date.now()}`;

const meta = await runBenchmark({
  map: values.map,
  seed: values.seed,
  agent: values.agent,
  duration: Number(values.duration),
  port: Number(values.port),
  server: values.server,
  out,
});

console.log(
  JSON.stringify({
    out,
    score: meta.finalScore,
    penalty: meta.finalPenalty,
    snapshots: meta.snapshots,
  }),
);
