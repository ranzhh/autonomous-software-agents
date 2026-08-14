/**
 * Agent A (BDI) entrypoint — `npm run bdi`.
 *
 * Wiring only: connect → build beliefs → assemble the plan library (reactive,
 * or PDDL-first with the reactive library as its fallback) → hand both to the
 * shared `ControlLoop`, which owns the sense→deliberate→execute cycle.
 */

import { createControlLoop } from "../bdi/control-loop/index.js";
import { IntentionRevision } from "../bdi/intentions/index.js";
import {
  createPlanContext,
  Deliver,
  GoPickUp,
  GoTo,
  type PlanFactory,
  PlanLibrary,
  Wander,
} from "../bdi/plans/index.js";
import { createBeliefSet } from "../core/beliefs/index.js";
import { connectToGame, loadConfig, loadDotEnv } from "../core/sdk/index.js";
import { createLogger } from "../core/util/index.js";
import { createSolver, PddlPlan } from "../pddl/index.js";

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
    const gameOptions = game.config()?.GAME;
    log.info(
      `connected as ${me?.name} (${me?.id}) · team ${me?.teamName} · at (${me?.x ?? "?"},${me?.y ?? "?"})`,
    );
    log.info(
      `settings: move=${gameOptions?.player.movement_duration}ms ` +
        `· view=${gameOptions?.player.observation_distance} ` +
        `· decay=${gameOptions?.parcels.decaying_event} ` +
        `· spawn=${gameOptions?.parcels.generation_event}`,
    );

    const beliefs = createBeliefSet(game);
    const ctx = createPlanContext(beliefs, game);
    // Reactive plans serve every intention on their own (PLANNER=reactive)
    // and double as PddlPlan's fallback path (PLANNER=pddl). With PDDL on,
    // PddlPlan is registered first so it wins selection for pickup/deliver;
    // explore/goto stay reactive either way. The library builds a fresh
    // instance per selection, so these are factories.
    const reactivePlans: PlanFactory[] = [
      () => new GoPickUp(ctx),
      () => new Deliver(ctx),
      () => new Wander(ctx),
      () => new GoTo(ctx),
    ];
    let library = new PlanLibrary(reactivePlans);
    if (cfg.planner === "pddl") {
      const solver = createSolver(cfg);
      const fallback = library;
      library = new PlanLibrary([
        () => new PddlPlan(ctx, { solver, fallback }),
        ...reactivePlans,
      ]);
    }
    log.info(
      `planner: ${cfg.planner}` +
        (cfg.planner === "pddl" ? ` (solver: ${cfg.pddlSolver})` : ""),
    );

    const loop = createControlLoop({
      beliefs,
      library,
      revision: new IntentionRevision(),
      logger: log,
    });
    loop.start();

    log.info("BDI loop running — Ctrl-C to stop");

    // Keep the process alive until SIGINT.
    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
    });

    await loop.stop();
  } catch (error) {
    log.error(
      `fatal: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    game.disconnect();
  }
}
