/**
 * Navigate to a delivery tile and put down all currently-carried parcels.
 *
 * `isApplicableTo` guards on `carriedParcelIds().length > 0` so the plan is
 * never selected when there is nothing to deliver. `emitPutdown()` with no
 * arguments drops ALL carried parcels in a single action (CLAUDE.md §6);
 * scoring happens server-side on a delivery tile.
 */

import { PlanFailedError } from "../../core/util/index.js";
import type { Intention } from "../intentions/index.js";
import { BasePlan } from "./base-plan.js";
import { GoTo } from "./go-to.js";

export class Deliver extends BasePlan {
  override readonly name = "Deliver";
  private inner: GoTo | undefined = undefined;
  private aborted = false;
  private generation = 0;

  override isApplicableTo(intention: Intention): boolean {
    return (
      intention.kind === "deliver" &&
      this.ctx.map.inBounds(intention.target) &&
      this.ctx.carriedParcelIds().length > 0
    );
  }

  override stop(): void {
    this.aborted = true;
    this.inner?.stop();
  }

  override async execute(intention: Intention): Promise<void> {
    // Reset abort state so the instance can be reused after a prior stop().
    // Generation counter guards emitPutdown against a stale stopped execution.
    this.aborted = false;
    const gen = ++this.generation;

    if (intention.kind !== "deliver") {
      throw new PlanFailedError(
        `Deliver cannot execute intention "${intention.kind}"`,
      );
    }

    const inner = new GoTo(this.ctx);
    this.inner = inner;
    await inner.execute({ kind: "goto", target: intention.target });
    if (this.inner === inner) this.inner = undefined;

    if (!this.aborted && this.generation === gen) {
      await this.ctx.emitPutdown();
    }
  }
}
