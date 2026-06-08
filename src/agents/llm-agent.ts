/**
 * Agent B (LLM) entrypoint — `npm run llm`.
 *
 * Phase 0 placeholder: resolves a couple of env settings (with safe fallbacks)
 * and logs, so the tsx + strict-TS run pipeline is verifiable end-to-end. The
 * real wiring (the shared BDI core for standard play + the LLM stack for
 * missions/strategy/coordination) arrives from Phase 5 onward. The process ends
 * naturally with exit code 0.
 */

const host = process.env.HOST ?? "http://localhost:8080";
const logLevel = process.env.LOG_LEVEL ?? "info";

console.log(
  `[llm-agent] phase 0 placeholder — HOST=${host} LOG_LEVEL=${logLevel}`,
);
