/**
 * Team entrypoint — `npm run team`. Runs Agent A (BDI) and Agent B (LLM) as a
 * coordinated team (two processes over the SDK transport, per ADR-0002).
 *
 * Phase 0 placeholder: resolves a couple of env settings (with safe fallbacks)
 * and logs, so the tsx + strict-TS run pipeline is verifiable end-to-end. The
 * real wiring (spawn both agents + the Coordinator) arrives in Phase 8. The
 * process ends naturally with exit code 0.
 */

const host = process.env.HOST ?? "http://localhost:8080";
const logLevel = process.env.LOG_LEVEL ?? "info";

console.log(
  `[run-team] phase 0 placeholder — HOST=${host} LOG_LEVEL=${logLevel}`,
);
