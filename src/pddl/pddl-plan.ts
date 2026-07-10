/**
 * The PDDL-backed plan: when a `pickup`/`deliver` intention activates it
 * builds the multi-parcel tour problem from live beliefs, solves it behind
 * the `Solver` seam, maps the abstract plan to executable steps, and runs
 * them — `goto` legs through the existing `GoTo` (A* expansion, blocker
 * retries, opportunistic grabs), tile actions through the emitters with the
 * same optimistic belief acks the reactive plans use.
 *
 * Replanning: a failed leg or a material belief change mid-tour (planned
 * parcels vanished, nothing left to put down) aborts the tour and re-enters
 * the build→solve→run cycle, at most `maxReplans` (default 2) extra times.
 * When planning is impossible (mid-move never settles, no plannable tour, no
 * plan found, solver/mapping failure) or replans are exhausted, the intention
 * is handed to the reactive `fallback` library — PDDL never strands the
 * agent. `stop()` aborts cooperatively, cascading into the active leg or
 * fallback plan.
 */

import type { Intention } from "../bdi/intentions/index.js";
import {
  BasePlan,
  GoTo,
  type PlanContext,
  type PlanLibrary,
} from "../bdi/plans/index.js";
import {
  createLogger,
  PlanFailedError,
  PlannerError,
} from "../core/util/index.js";
import { PDDL_DOMAIN } from "./domain.js";
import { mapSolvedPlan, type TourStep } from "./plan-steps.js";
import { buildTourProblem, type TourProblem } from "./problem.js";
import type { PddlStep, Solver } from "./solvers.js";

export interface PddlPlanOptions {
  readonly solver: Solver;
  /** Reactive plans to hand the intention to when PDDL cannot serve it. */
  readonly fallback: PlanLibrary;
  /** Extra build→solve→run rounds after the first. Default 2. */
  readonly maxReplans?: number | undefined;
}

const DEFAULT_MAX_REPLANS = 2;

/** How many move-durations to wait for a mid-flight move to settle. */
const SETTLE_ATTEMPTS = 5;

const log = createLogger({ scope: "pddl-plan" });

export class PddlPlan extends BasePlan {
  override readonly name = "PddlPlan";
  private readonly solver: Solver;
  private readonly fallback: PlanLibrary;
  private readonly maxReplans: number;
  private aborted = false;
  // Bumped by every execute(): an older in-flight execution on this shared
  // instance sees the mismatch and dies at its next check, so re-selecting
  // the plan can never resurrect it into a concurrent duplicate (execute()
  // resets `aborted`, which alone would un-stop the old run).
  private generation = 0;
  private inner: GoTo | undefined;
  private activeFallback: BasePlan | undefined;

  constructor(ctx: PlanContext, options: PddlPlanOptions) {
    super(ctx);
    this.solver = options.solver;
    this.fallback = options.fallback;
    this.maxReplans = options.maxReplans ?? DEFAULT_MAX_REPLANS;
  }

  override isApplicableTo(intention: Intention): boolean {
    return (
      (intention.kind === "pickup" || intention.kind === "deliver") &&
      this.ctx.map.inBounds(intention.target)
    );
  }

  override stop(): void {
    this.aborted = true;
    this.inner?.stop();
    this.activeFallback?.stop();
  }

  /** True when this execution was stopped or superseded by a newer execute(). */
  private isStale(gen: number): boolean {
    return this.aborted || gen !== this.generation;
  }

  override async execute(intention: Intention): Promise<void> {
    this.aborted = false; // reset so the instance is reusable after stop()
    const gen = ++this.generation;

    if (intention.kind !== "pickup" && intention.kind !== "deliver") {
      throw new PlanFailedError(
        `PddlPlan cannot execute intention "${intention.kind}"`,
      );
    }

    // Same pre-checks as the reactive plans: re-deliberate on stale beliefs
    // instead of planning toward a goal that no longer exists.
    if (
      intention.kind === "pickup" &&
      !this.ctx.isParcelFree(intention.parcelId)
    ) {
      throw new PlanFailedError(
        `PddlPlan: parcel ${intention.parcelId} is no longer free — re-deliberating`,
      );
    }
    if (
      intention.kind === "deliver" &&
      this.ctx.carriedParcelIds().length === 0
    ) {
      throw new PlanFailedError("PddlPlan: nothing to deliver (stale beliefs)");
    }

    const mustInclude =
      intention.kind === "pickup" ? intention.parcelId : undefined;

    const maxRounds = 1 + this.maxReplans;
    for (let round = 1; round <= maxRounds; round++) {
      if (this.isStale(gen)) return;

      const tour = await this.buildProblem(mustInclude, gen);
      if (tour === null) {
        return this.runFallback(intention, "no plannable tour", gen);
      }

      let solved: readonly PddlStep[] | null;
      const startedAt = Date.now();
      try {
        solved = await this.solver.solve(PDDL_DOMAIN, tour.problemText);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return this.runFallback(intention, `solver failed: ${message}`, gen);
      }
      if (this.isStale(gen)) return;
      if (solved === null) {
        return this.runFallback(intention, "solver found no plan", gen);
      }

      let steps: TourStep[];
      try {
        steps = mapSolvedPlan(solved, tour);
      } catch (error) {
        const message =
          error instanceof PlannerError ? error.message : String(error);
        return this.runFallback(intention, `unusable plan: ${message}`, gen);
      }

      log.info(
        `plan ${round}/${maxRounds}: ${solved.length} steps via ${this.solver.name} ` +
          `in ${Date.now() - startedAt}ms (parcels: ${tour.candidateParcelIds.join(",") || "carried-only"})`,
      );

      const completed = await this.runTour(steps, gen);
      if (this.isStale(gen)) return;
      if (completed) return;
      if (round < maxRounds) {
        log.info(`tour invalidated — replanning (${round}/${this.maxReplans})`);
      }
    }

    return this.runFallback(intention, "replans exhausted", gen);
  }

  /**
   * Build the tour problem from live beliefs, waiting up to a few
   * move-durations for a mid-flight move to settle on an integer tile.
   */
  private async buildProblem(
    mustInclude: string | undefined,
    gen: number,
  ): Promise<TourProblem | null> {
    for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
      if (this.isStale(gen)) return null;
      const myPos = this.ctx.myExactPosition();
      if (myPos === undefined) return null;
      if (Number.isInteger(myPos.x) && Number.isInteger(myPos.y)) {
        return buildTourProblem({
          myPos,
          carried: this.ctx.carriedParcels(),
          freeParcels: this.ctx.freeParcels(),
          map: this.ctx.map,
          now: this.ctx.now(),
          settings: {
            parcelDecayMs: this.ctx.parcelDecayMs,
            movementDurationMs: this.ctx.moveDurationMs,
          },
          mustIncludeParcelId: mustInclude,
        });
      }
      await this.ctx.wait(this.ctx.moveDurationMs);
    }
    return null; // never settled — fall back
  }

  /**
   * Run the mapped tour. Resolves `true` on completion, `false` when the tour
   * was invalidated (failed leg / vanished parcels / nothing to put down) and
   * a replan should be attempted.
   */
  private async runTour(
    steps: readonly TourStep[],
    gen: number,
  ): Promise<boolean> {
    for (const step of steps) {
      if (this.isStale(gen)) return true; // stopped/superseded — resolve early
      switch (step.kind) {
        case "goto": {
          const inner = new GoTo(this.ctx);
          this.inner = inner;
          try {
            await inner.execute({ kind: "goto", target: step.target });
          } catch (error) {
            if (error instanceof PlanFailedError) {
              log.warn(
                `leg to (${step.target.x},${step.target.y}) failed: ${error.message}`,
              );
              return false;
            }
            throw error;
          } finally {
            if (this.inner === inner) this.inner = undefined;
          }
          break;
        }
        case "pickup": {
          // The GoTo leg grabs parcels opportunistically on arrival, so a
          // planned parcel may already be carried — that is success, not
          // staleness. Only a stop whose parcels are neither free nor carried
          // (taken/expired while we walked) invalidates the tour.
          if (step.parcelIds.some((id) => this.ctx.isParcelFree(id))) {
            const picked = await this.ctx.emitPickup();
            this.ctx.applyPickup(picked.map((p) => p.id));
            log.info(`picked up [${picked.map((p) => p.id).join(",")}]`);
            break;
          }
          const carried = new Set(this.ctx.carriedParcelIds());
          if (step.parcelIds.some((id) => carried.has(id))) break;
          log.warn(
            `planned parcels [${step.parcelIds.join(",")}] no longer exist`,
          );
          return false;
        }
        case "putdown": {
          const carried = this.ctx.carriedParcelIds();
          if (carried.length === 0) {
            log.warn("nothing to put down (beliefs changed mid-tour)");
            return false;
          }
          await this.ctx.emitPutdown();
          this.ctx.applyDelivered(carried);
          log.info(`delivered [${carried.join(",")}]`);
          break;
        }
      }
    }
    return true;
  }

  /** Hand the intention to the reactive library (PDDL could not serve it). */
  private async runFallback(
    intention: Intention,
    reason: string,
    gen: number,
  ): Promise<void> {
    if (this.isStale(gen)) return;
    log.warn(`falling back to reactive plan: ${reason}`);
    const plan = this.fallback.select(intention);
    if (plan === undefined) {
      throw new PlanFailedError(
        `PddlPlan: ${reason}, and no reactive fallback applies to "${intention.kind}"`,
      );
    }
    this.activeFallback = plan;
    try {
      await plan.execute(intention);
    } finally {
      if (this.activeFallback === plan) this.activeFallback = undefined;
    }
  }
}
