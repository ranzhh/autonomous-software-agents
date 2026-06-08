/**
 * `npm run token -- <name> [team]` — mint a game token via the SDK's
 * `DjsRestClient` and print it to stdout for manual paste into `.env`.
 *
 * Reads HOST from the environment (via `loadConfig`). An optional
 * GAME_PASSWORD env var is forwarded as the server password header.
 *
 * Usage:
 *   npm run token -- AgentA MyTeam
 *   TOKEN_BDI=$(npm run token --silent -- AgentA MyTeam)
 */

import { DjsRestClient } from "@unitn-asa/deliveroo-js-sdk";
import { createLogger } from "../util/index.js";
import { loadConfig, loadDotEnv } from "./config.js";
import { extractToken, parseTokenArgs } from "./token.js";

loadDotEnv();
const cfg = loadConfig();
const log = createLogger({ scope: "mint-token", level: cfg.logLevel });

let args: { name: string; team: string };
try {
  args = parseTokenArgs(process.argv);
} catch (e) {
  log.error((e as Error).message);
  process.exit(1);
}

const client = new DjsRestClient(cfg.host);
try {
  const data: unknown = await client.getToken(
    args.name,
    args.team,
    process.env.GAME_PASSWORD ?? "",
  );
  const token = extractToken(data);
  process.stdout.write(`${token}\n`);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  log.error(`Token mint failed: ${msg}`);
  process.exit(1);
}
