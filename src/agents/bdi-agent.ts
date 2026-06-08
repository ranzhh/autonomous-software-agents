/**
 * Agent A (BDI) entrypoint — `npm run bdi`.
 *
 * Phase 0–2: connectivity + world-model + a first movement demo. Connects, waits
 * until ready, builds a BeliefSet, logs one sensing snapshot, then navigates to the
 * nearest delivery tile (BFS over the map, A* per step via the `GoTo` plan) to
 * prove the movement stack end-to-end. There is no BDI control loop yet — that
 * arrives in Phase 3. With no TOKEN_BDI set, logs a hint and exits cleanly.
 */

import { createPlanContext, GoTo } from "../bdi/plans/index.js";
import { createBeliefSet } from "../core/beliefs/index.js";
import { bfsToNearest } from "../core/pathfinding/index.js";
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

    // Wait for the first sensing so position + blockers are known, log a snapshot.
    await new Promise<void>((resolve) => {
      const unsub = beliefs.onUpdated(() => {
        const free = beliefs.parcels.free();
        const rivals = beliefs.agents.rivals();
        const teammates = beliefs.agents.teammates();
        log.info(
          `first sensing: parcels free=${free.length} · ` +
            `agents rivals=${rivals.length} teammates=${teammates.length}`,
        );
        unsub();
        resolve();
      });
    });

    // Movement demo: navigate to the nearest reachable delivery tile.
    const ctx = createPlanContext(beliefs, game);
    const myPos = ctx.myPosition();
    if (myPos === undefined) {
      log.warn(
        "position unknown after first sensing — skipping navigation demo",
      );
    } else {
      const route = bfsToNearest(ctx.map, myPos, ctx.map.deliveryTiles, {
        isBlocked: ctx.isBlocked,
      });
      const routeLen = route?.length ?? 0;
      const target = route === null ? undefined : route[routeLen - 1];
      if (target === undefined) {
        log.warn("no reachable delivery tile — skipping navigation demo");
      } else {
        log.info(
          `navigating from (${myPos.x},${myPos.y}) to nearest delivery ` +
            `(${target.x},${target.y}) · ${routeLen}-tile route`,
        );
        try {
          await new GoTo(ctx).execute({ kind: "goto", target });
          const arrived = ctx.myPosition();
          log.info(`arrived at (${arrived?.x ?? "?"},${arrived?.y ?? "?"})`);
        } catch (error) {
          log.error(
            `navigation failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  } catch (error) {
    log.error(
      `error: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    game.disconnect();
  }
}
