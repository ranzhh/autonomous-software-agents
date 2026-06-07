/**
 * Agent B (LLM) entrypoint — `npm run llm`.
 *
 * Phase 0 placeholder: loads config and logs through the project logger. The real
 * wiring (the shared BDI core for standard play + the LLM stack for
 * missions/strategy/coordination) arrives from Phase 5 onward. The process ends
 * naturally with exit code 0.
 */

import { loadConfig, loadDotEnv } from "../core/sdk/index.js";
import { createLogger } from "../core/util/index.js";

loadDotEnv();
const cfg = loadConfig();
const log = createLogger({ scope: "llm-agent", level: cfg.logLevel });

log.info(`phase 0 placeholder — HOST=${cfg.host} (LLM stack lands in Phase 5)`);
