/**
 * Agent A (BDI) entrypoint — `npm run bdi`.
 *
 * Full BDI control loop (Phase 3):
 *   sense → revise beliefs → IntentionRevision.revise → select plan → execute
 *
 * On each `onUpdated` event (post-sensing belief revision):
 *   1. Ask IntentionRevision whether to switch intentions.
 *   2. If yes: stop the in-flight plan (cooperative abort), then start the new
 *      one asynchronously.
 *   3. On PlanFailedError: call revision.reset() so re-deliberation starts
 *      from scratch rather than being suppressed by hysteresis.
 *
 * Concurrency model: only one plan executes at a time. `onUpdated` callbacks
 * are synchronous and fast (just revise → maybe stop); the async plan execution
 * runs in the background and is replaced by the next intention when needed.
 */

import { IntentionRevision } from "../bdi/intentions/index.js";
import type { BasePlan } from "../bdi/plans/index.js";
import {
  createPlanContext,
  Deliver,
  GoPickUp,
  GoTo,
  PlanLibrary,
  Wander,
} from "../bdi/plans/index.js";
import { createBeliefSet } from "../core/beliefs/index.js";
import { connectToGame, loadConfig, loadDotEnv } from "../core/sdk/index.js";
import { createLogger, PlanFailedError } from "../core/util/index.js";

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
    const library = new PlanLibrary([
      new GoPickUp(ctx),
      new Deliver(ctx),
      new Wander(ctx),
      new GoTo(ctx),
    ]);
    const revision = new IntentionRevision();

    let activePlan: BasePlan | undefined;
    let activeDone: Promise<void> = Promise.resolve();

    async function runPlan(
      plan: BasePlan,
      intention: Parameters<BasePlan["execute"]>[0],
    ): Promise<void> {
      try {
        await plan.execute(intention);
        // Only reset + log when this plan is still the active one (not already
        // replaced by a preempting intention). Reset lets the next deliberation
        // pick a fresh intention rather than being blocked by hysteresis on the
        // now-completed one (e.g. explore→explore after Wander reaches its target).
        if (activePlan === plan) {
          log.debug(`plan ${plan.name} completed`);
          revision.reset();
        }
      } catch (err) {
        if (err instanceof PlanFailedError) {
          log.warn(`plan ${plan.name} failed: ${err.message}`);
        } else {
          log.error(
            `plan ${plan.name} threw unexpectedly: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        revision.reset();
      } finally {
        if (activePlan === plan) {
          activePlan = undefined;
          // Re-deliberate immediately rather than waiting for the next sensing
          // event. After a delivery the server often sends no sensing event
          // (agent is stationary, nothing visible changes), so without this the
          // agent idles indefinitely at the delivery tile instead of exploring.
          deliberateAndAct();
        }
      }
    }

    function deliberateAndAct(): void {
      const now = Date.now();
      const newIntention = revision.revise(beliefs, now);
      if (newIntention === undefined) return; // keep current plan

      log.info(
        `intention → ${newIntention.kind}` +
          ("parcelId" in newIntention
            ? ` (parcel ${newIntention.parcelId})`
            : "") +
          ` @ (${newIntention.target.x},${newIntention.target.y})`,
      );

      // Stop the current plan cooperatively.
      activePlan?.stop();

      const plan = library.select(newIntention);
      if (plan === undefined) {
        log.warn(
          `no plan applicable to ${newIntention.kind} — re-deliberating`,
        );
        revision.reset();
        return;
      }

      activePlan = plan;
      activeDone = runPlan(plan, newIntention);
    }

    beliefs.onUpdated(() => deliberateAndAct());

    // Bootstrap: trigger deliberation immediately so the agent doesn't wait for
    // the first sensing event (on some server configs sensing fires only after
    // the first action, which would create a deadlock).
    deliberateAndAct();

    log.info("BDI loop running — Ctrl-C to stop");

    // Keep the process alive until SIGINT.
    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
    });

    activePlan?.stop();
    await activeDone;
  } catch (error) {
    log.error(
      `fatal: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    game.disconnect();
  }
}
