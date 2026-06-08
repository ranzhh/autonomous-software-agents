/**
 * Agent A (BDI) entrypoint — `npm run bdi`.
 *
 * Phase 0 placeholder: resolves a couple of env settings (with safe fallbacks)
 * and logs, so the tsx + strict-TS run pipeline is verifiable end-to-end. The
 * real wiring (typed SDK connection, BeliefSet, deliberation, plans, PDDL)
 * arrives from task 0.3 onward. The process ends naturally with exit code 0.
 */

const host = process.env.HOST ?? "http://localhost:8080";
const logLevel = process.env.LOG_LEVEL ?? "info";

console.log(
  `[bdi-agent] phase 0 placeholder — HOST=${host} LOG_LEVEL=${logLevel}`,
);
