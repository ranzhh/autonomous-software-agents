/**
 * Navigate to the explore target tile. No special action on arrival — the BDI
 * loop will re-deliberate on the next sensing event and may find a real
 * intention (pickup/deliver) to switch to immediately.
 *
 * `Wander` is the lowest-priority plan: `IntentionRevision` switches away from
 * `explore` to any real intention without a hysteresis guard, so this plan
 * rarely runs to completion on a map with parcels.
 */

import { PlanFailedError } from "../../core/util/index.js";
import type { Intention } from "../intentions/index.js";
import { BasePlan } from "./base-plan.js";
import { GoTo } from "./go-to.js";

export class Wander extends BasePlan {
  override readonly name = "Wander";
  private inner: GoTo | undefined = undefined;

  override isApplicableTo(intention: Intention): boolean {
    return intention.kind === "explore";
  }

  override stop(): void {
    this.inner?.stop();
  }

  override async execute(intention: Intention): Promise<void> {
    if (intention.kind !== "explore") {
      throw new PlanFailedError(
        `Wander cannot execute intention "${intention.kind}"`,
      );
    }

    this.inner = new GoTo(this.ctx);
    await this.inner.execute({ kind: "goto", target: intention.target });
    this.inner = undefined;
  }
}
