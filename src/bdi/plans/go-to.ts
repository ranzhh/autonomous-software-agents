/**
 * Navigate to a target tile, coping with moving agents. Re-paths with A* every
 * step (so a blocker that appears or clears is handled the next tick), turns the
 * first path step into an `emitMove`, and on a failed move (`false` — the tile got
 * occupied) or a transiently-unreachable target waits one move-duration and
 * re-paths. Gives up after `maxFailures` consecutive failures with a
 * `PlanFailedError`; a successful move resets the counter.
 *
 * The target tile is exempted from blocking during pathing: a rival standing on
 * the goal should not null the path — we arrive once it moves. `stop()` is
 * terminal for the instance (the loop checks it and resolves early); create a
 * fresh `GoTo` to retry.
 */

import type { Pos } from "../../core/beliefs/index.js";
import { astar, directionTo, samePos } from "../../core/pathfinding/index.js";
import { PlanFailedError } from "../../core/util/index.js";
import type { Intention } from "../intentions/index.js";
import { BasePlan } from "./base-plan.js";
import type { PlanContext } from "./plan-context.js";

const DEFAULT_MAX_FAILURES = 8;

export interface GoToOptions {
  /** Consecutive failed/blocked moves tolerated before giving up. Default 8. */
  readonly maxFailures?: number;
}

export class GoTo extends BasePlan {
  override readonly name = "GoTo";
  private readonly maxFailures: number;
  private aborted = false;

  constructor(ctx: PlanContext, options: GoToOptions = {}) {
    super(ctx);
    this.maxFailures = options.maxFailures ?? DEFAULT_MAX_FAILURES;
  }

  override isApplicableTo(intention: Intention): boolean {
    return intention.kind === "goto" && this.ctx.map.inBounds(intention.target);
  }

  override stop(): void {
    this.aborted = true;
  }

  override async execute(intention: Intention): Promise<void> {
    this.aborted = false; // reset so this instance can be reused after a prior stop()
    if (intention.kind !== "goto") {
      throw new PlanFailedError(
        `GoTo cannot execute intention "${intention.kind}"`,
      );
    }
    const target = intention.target;

    let cur = this.ctx.myPosition();
    if (cur === undefined) {
      throw new PlanFailedError("GoTo: current position unknown");
    }

    // Exempt the target tile from blocking: a mover sitting on the goal must not
    // null the path — we'll arrive once it clears (retry covers the wait).
    const isBlocked = (p: Pos): boolean =>
      !samePos(p, target) && this.ctx.isBlocked(p);

    // Opportunistically grab any free parcel already on the start tile.
    await this.grabHere(cur);

    let failures = 0;
    // The tile we were on before the last successful move — used to damp the
    // back-and-forth oscillation that a rival shuffling on the shortest path can
    // induce (we re-path every step, so the chosen step can flip each tick).
    let prev: Pos | undefined;
    while (!samePos(cur, target)) {
      if (this.aborted) return;
      if (failures >= this.maxFailures) {
        throw new PlanFailedError(
          `GoTo: gave up after ${failures} failed moves toward (${target.x},${target.y})`,
        );
      }

      let next = astar(this.ctx.map, cur, target, { isBlocked })?.[1];
      if (next === undefined) {
        // Transiently unreachable (blocked) — wait a move-duration and re-path.
        failures++;
        await this.ctx.wait(this.ctx.moveDurationMs);
        cur = this.ctx.myPosition() ?? cur;
        continue;
      }

      // Anti-oscillation: if the next step would walk straight back to where we
      // just came from, prefer an equal-or-longer route that doesn't reverse —
      // but only if one exists (else the reversal is the genuine only way).
      if (prev !== undefined && samePos(next, prev)) {
        const backFrom = prev;
        const noBacktrack = (p: Pos): boolean =>
          isBlocked(p) || (!samePos(p, target) && samePos(p, backFrom));
        const altNext = astar(this.ctx.map, cur, target, {
          isBlocked: noBacktrack,
        })?.[1];
        if (altNext !== undefined) next = altNext;
      }

      const direction = directionTo(cur, next);
      if (direction === undefined) {
        throw new PlanFailedError(
          `GoTo: path step (${cur.x},${cur.y})→(${next.x},${next.y}) is not adjacent`,
        );
      }

      const result = await this.ctx.emitMove(direction);
      if (result === false) {
        // The tile got occupied between pathing and moving — re-path around it.
        failures++;
        await this.ctx.wait(this.ctx.moveDurationMs);
        cur = this.ctx.myPosition() ?? cur;
        continue;
      }

      prev = cur;
      cur = { x: result.x, y: result.y };
      failures = 0;
      // Grab any free parcel sitting on the tile we just stepped onto. There is
      // no capacity limit, so collecting a parcel we pass over is free value
      // regardless of the current goal (pickup / deliver / explore).
      await this.grabHere(cur);
    }
  }

  /**
   * If free parcels sit on tile `at`, pick them all up and reflect it in beliefs
   * immediately (so deliberation re-assesses with the larger carried set).
   */
  private async grabHere(at: Pos): Promise<void> {
    if (this.aborted) return;
    if (this.ctx.freeParcelIdsAt(at).length === 0) return;
    const picked = await this.ctx.emitPickup();
    this.ctx.applyPickup(picked.map((p) => p.id));
  }
}
