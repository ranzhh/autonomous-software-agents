/**
 * `npm run token` — mint a game token via the SDK's `DjsRestClient`.
 *
 * Phase 0 placeholder: the real minting tool lands in task 0.4 (PLAN.md Phase 0).
 * For now it reports its pending status and exits cleanly, so the `token` npm
 * script is wired and runnable. Planned usage: `npm run token -- <name> [team]`.
 */

import { createLogger } from "../util/index.js";

const log = createLogger({ scope: "mint-token" });

log.info(
  "phase 0 placeholder — game-token minting lands in task 0.4 (DjsRestClient).",
);
