/**
 * Agent A (BDI) entrypoint — `npm run bdi`.
 *
 * Phase 0–1: connectivity + world-model check. Connects to the game, waits
 * until ready, builds a BeliefSet, then logs several sensing snapshots (parcels
 * decaying/appearing, agents coming into view) before disconnecting. There is no
 * BDI control loop yet — that arrives in Phase 3.
 * With no TOKEN_BDI set, logs a hint and exits cleanly.
 */

import { createBeliefSet } from "../core/beliefs/index.js";
import { connectToGame, loadConfig, loadDotEnv } from "../core/sdk/index.js";
import { createLogger } from "../core/util/index.js";

loadDotEnv();
const cfg = loadConfig();
const log = createLogger({ scope: "bdi-agent", level: cfg.logLevel });

if (cfg.tokenBdi === undefined) {
  log.warn("no TOKEN_BDI set in .env — cannot connect to the game. Exiting.");
} else {
  const game = connectToGame({
    host: cfg.host,
    token: cfg.tokenBdi,
    name: cfg.name,
  });

  try {
    await game.ready(15_000);

    const me = game.me();
    const map = game.map();
    const gameOptions = game.config()?.GAME;
    log.info(
      `connected as ${me?.name} (${me?.id}) · team ${me?.teamName} · at (${me?.x ?? "?"},${me?.y ?? "?"})`,
    );
    log.info(`map ${map?.width}×${map?.height} · ${map?.tiles.length} tiles`);
    log.info(
      `settings: move=${gameOptions?.player.movement_duration}ms ` +
        `· view=${gameOptions?.player.observation_distance} ` +
        `· decay=${gameOptions?.parcels.decaying_event} ` +
        `· spawn=${gameOptions?.parcels.generation_event}`,
    );

    const beliefs = createBeliefSet(game);
    log.info(
      `game-map: ${beliefs.gameMap?.deliveryTiles.length ?? 0} delivery, ` +
        `${beliefs.gameMap?.spawnerTiles.length ?? 0} spawner tiles`,
    );

    // Log the first few sensing snapshots to verify belief revision live.
    let snapshots = 0;
    const MAX_SNAPSHOTS = 10;

    await new Promise<void>((resolve) => {
      const unsub = beliefs.onUpdated(() => {
        snapshots++;
        const free = beliefs.parcels.free();
        const carrying = beliefs.parcels.carriedByMe();
        const rivals = beliefs.agents.rivals();
        const teammates = beliefs.agents.teammates();
        log.info(
          `sensing #${snapshots}: ` +
            `parcels free=${free.length} carrying=${carrying.length} · ` +
            `agents rivals=${rivals.length} teammates=${teammates.length}`,
        );
        if (free.length > 0) {
          const p = free[0];
          if (p !== undefined) {
            const rem = beliefs.parcels.remainingReward(p.id, Date.now());
            log.debug(
              `  nearest free parcel: id=${p.id} reward=${rem} at (${p.x},${p.y})`,
            );
          }
        }
        if (snapshots >= MAX_SNAPSHOTS) {
          unsub();
          resolve();
        }
      });
    });
  } catch (error) {
    log.error(
      `error: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    game.disconnect();
  }
}
