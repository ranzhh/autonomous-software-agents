/**
 * The BDI control loop: sense → revise beliefs → revise intentions → execute.
 *
 * On every belief update (post-sensing) it asks `IntentionRevision` whether to
 * switch; if so it cooperatively stops the in-flight plan and starts the new
 * one. A plan that ends (completed or failed) resets the commitment and
 * re-deliberates immediately, rather than waiting for the next sensing event —
 * after a delivery the server often sends none (the agent is stationary and
 * nothing visible changes), which would otherwise leave it idling.
 *
 * Preemption bookkeeping: each `runPlan` captures a monotonic `runId`, and only
 * the run still matching `activeRun` may touch shared state (reset the
 * commitment, clear `active`, re-deliberate). A superseded execution must unwind
 * silently — otherwise it resets the commitment its replacement is running on,
 * and the loop re-adopts the identical intention faster than sensing arrives.
 * → ADR-0008.
 */

import type { BeliefSet } from "../../core/beliefs/index.js";
import { type Logger, PlanFailedError } from "../../core/util/index.js";
import type { Intention } from "../intentions/index.js";
import type { BasePlan, PlanLibrary } from "../plans/index.js";

/**
 * The deliberation slice the loop depends on — satisfied by `IntentionRevision`.
 * Structural so a test can script exactly which intention is adopted when,
 * without staging beliefs that produce it.
 */
export interface Deliberator {
  /** The intention to adopt, or `undefined` to keep the current one. */
  revise(beliefs: BeliefSet, now: number): Intention | undefined;
  /** Clear the commitment so the next `revise` starts fresh. */
  reset(): void;
}

export interface ControlLoopDeps {
  readonly beliefs: BeliefSet;
  readonly library: PlanLibrary;
  readonly revision: Deliberator;
  readonly logger: Logger;
}

export interface ControlLoop {
  /**
   * Subscribe to belief updates and run the first deliberation immediately
   * (some server configs only emit sensing after the first action, which would
   * otherwise deadlock).
   */
  start(): void;
  /**
   * Run one deliberate→act cycle. Called by `start`, by every belief update,
   * and by a finishing plan; tests drive it directly.
   */
  deliberateAndAct(): void;
  /** Stop the running plan and unsubscribe; resolves once it has unwound. */
  stop(): Promise<void>;
  /** The plan currently executing, if any (diagnostics/tests). */
  activePlan(): BasePlan | undefined;
}

export function createControlLoop(deps: ControlLoopDeps): ControlLoop {
  const { beliefs, library, revision, logger } = deps;

  let active: BasePlan | undefined;
  /** Monotonic id of the execution allowed to own shared state. */
  let activeRun = 0;
  let running: Promise<void> = Promise.resolve();
  let unsubscribe: (() => void) | undefined;
  let stopped = false;

  async function runPlan(
    plan: BasePlan,
    intention: Intention,
    runId: number,
  ): Promise<void> {
    const isCurrent = (): boolean => runId === activeRun;

    try {
      await plan.execute(intention);
      if (isCurrent()) {
        logger.debug(`plan ${plan.name} completed`);
        revision.reset();
      }
    } catch (error) {
      if (error instanceof PlanFailedError) {
        logger.warn(`plan ${plan.name} failed: ${error.message}`);
      } else {
        logger.error(
          `plan ${plan.name} threw unexpectedly: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      if (isCurrent()) revision.reset();
    } finally {
      if (isCurrent()) {
        active = undefined;
        deliberateAndAct();
      }
    }
  }

  function deliberateAndAct(): void {
    if (stopped) return;

    const intention = revision.revise(beliefs, Date.now());
    if (intention === undefined) return; // keep the current plan

    logger.info(
      `intention → ${intention.kind}` +
        ("parcelId" in intention ? ` (parcel ${intention.parcelId})` : "") +
        ` @ (${intention.target.x},${intention.target.y})`,
    );

    // Cooperative: the running plan resolves at its next check. Any action it
    // still has in flight cannot overlap the new plan's — the connection
    // serializes them.
    active?.stop();

    const plan = library.select(intention);
    if (plan === undefined) {
      logger.warn(`no plan applicable to ${intention.kind} — re-deliberating`);
      revision.reset();
      return;
    }

    active = plan;
    running = runPlan(plan, intention, ++activeRun);
  }

  return {
    start(): void {
      unsubscribe = beliefs.onUpdated(() => deliberateAndAct());
      deliberateAndAct();
    },
    deliberateAndAct,
    async stop(): Promise<void> {
      stopped = true;
      unsubscribe?.();
      active?.stop();
      await running;
    },
    activePlan: () => active,
  };
}
