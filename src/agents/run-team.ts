/**
 * Team entrypoint — `npm run team`. Runs Agent A (BDI) and Agent B (LLM) as a
 * coordinated team (two processes over the SDK transport, per ADR-0002).
 *
 * Phase 0 placeholder: loads config and logs through the project logger. The real
 * wiring (spawn both agents + the Coordinator) arrives in Phase 8. The process
 * ends naturally with exit code 0.
 */

import { loadConfig, loadDotEnv } from "../core/sdk/index.js";
import { createLogger } from "../core/util/index.js";

loadDotEnv();
const cfg = loadConfig();
const log = createLogger({ scope: "run-team", level: cfg.logLevel });

log.info(
  `phase 0 placeholder — HOST=${cfg.host} (team wiring lands in Phase 8)`,
);
