/**
 * Agent A (BDI) entrypoint — `npm run bdi`.
 *
 * Phase 0: a connectivity check. It connects to the game, waits until the world
 * model is ready, logs config + map + you + the first sensing, then disconnects
 * and exits — there is no BDI control loop yet (that arrives in Phase 3). With no
 * `TOKEN_BDI` set it logs a hint and exits cleanly instead of connecting.
 */

import {
  connectToGame,
  type IOSensing,
  loadConfig,
  loadDotEnv,
} from "../core/sdk/index.js";
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

  const firstSensing = new Promise<IOSensing>((resolve) => {
    game.onSensing(resolve);
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
      `settings: move=${gameOptions?.player.movement_duration}ms · view=${gameOptions?.player.observation_distance} · decay=${gameOptions?.parcels.decaying_event} · spawn=${gameOptions?.parcels.generation_event}`,
    );

    const sensing = await Promise.race([
      firstSensing,
      new Promise<undefined>((resolve) => {
        setTimeout(() => resolve(undefined), 5_000).unref();
      }),
    ]);
    if (sensing !== undefined) {
      log.info(
        `first sensing: ${sensing.agents.length} agents · ${sensing.parcels.length} parcels · ${sensing.positions.length} visible tiles`,
      );
    } else {
      log.warn("no sensing received within 5s");
    }
  } catch (error) {
    log.error(
      `could not reach ready state: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    game.disconnect();
  }
}
