/**
 * Navigate to a delivery tile and put down all currently-carried parcels.
 *
 * `isApplicableTo` guards on `carriedParcelIds().length > 0` so the plan is
 * never selected when there is nothing to deliver; `putDownAll` drops the whole
 * stack in one action and forgets it. Scoring happens server-side.
 */

import { PlanFailedError } from "../../core/util/index.js";
import type { Intention } from "../intentions/index.js";
import { BasePlan } from "./base-plan.js";
import { GoTo } from "./go-to.js";

export class Deliver extends BasePlan {
  override readonly name = "Deliver";
  private inner: GoTo | undefined = undefined;
  private aborted = false;

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
    if (intention.kind !== "deliver") {
      throw new PlanFailedError(
        `Deliver cannot execute intention "${intention.kind}"`,
      );
    }

    if (this.aborted) return;

    this.inner = new GoTo(this.ctx);
    await this.inner.execute({ kind: "goto", target: intention.target });
    this.inner = undefined;
    if (this.aborted) return;

    if ((await this.ctx.putDownAll()).length === 0) {
      // Beliefs were stale when deliberation selected this plan — the parcels
      // were already delivered. Re-deliberate rather than idling here.
      throw new PlanFailedError(
        "Deliver: no parcels to put down (stale beliefs)",
      );
    }
  }
}
