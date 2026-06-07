/**
 * Team entrypoint — `npm run team`. Runs Agent A (BDI) and Agent B (LLM) as a
 * coordinated team (two processes over the SDK transport, per ADR-0002).
 *
 * Phase 0 placeholder: resolves a couple of env settings (with safe fallbacks)
 * and logs through the project logger, so the tsx + strict-TS run pipeline is
 * verifiable end-to-end. The real wiring (spawn both agents + the Coordinator)
 * arrives in Phase 8. The process ends naturally with exit code 0.
 */

import { createLogger, parseLogLevel } from "../core/util/index.js";

const host = process.env.HOST ?? "http://localhost:8080";
const log = createLogger({
  scope: "run-team",
  level: parseLogLevel(process.env.LOG_LEVEL),
});

log.info(`phase 0 placeholder — HOST=${host}`);
