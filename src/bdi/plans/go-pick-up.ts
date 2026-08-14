/**
 * Navigate to a free parcel's tile and pick it up.
 *
 * Phantom-guard pre-check: if the parcel is no longer free at execution start
 * (it was taken while we were en route to deliberation), we throw immediately
 * so the BDI loop re-deliberates rather than walking to an empty tile.
 *
 * `GoTo` grabs parcels opportunistically on every tile it steps onto, arrival
 * included, so by the time we get here the parcel is usually already ours and
 * `pickUpHere` is a no-op. Failing to find it either way means beliefs were
 * stale — re-deliberate.
 */

import { PlanFailedError } from "../../core/util/index.js";
import type { Intention } from "../intentions/index.js";
import { BasePlan } from "./base-plan.js";
import { GoTo } from "./go-to.js";

export class GoPickUp extends BasePlan {
  override readonly name = "GoPickUp";
  private inner: GoTo | undefined = undefined;
  private aborted = false;

  override isApplicableTo(intention: Intention): boolean {
    return (
      intention.kind === "pickup" && this.ctx.map.inBounds(intention.target)
    );
  }

  override stop(): void {
    this.aborted = true;
    this.inner?.stop();
  }

  override async execute(intention: Intention): Promise<void> {
    if (intention.kind !== "pickup") {
      throw new PlanFailedError(
        `GoPickUp cannot execute intention "${intention.kind}"`,
      );
    }

    if (this.aborted) return;

    if (!this.ctx.isParcelFree(intention.parcelId)) {
      throw new PlanFailedError(
        `GoPickUp: parcel ${intention.parcelId} is no longer free — re-deliberating`,
      );
    }

    this.inner = new GoTo(this.ctx);
    await this.inner.execute({ kind: "goto", target: intention.target });
    this.inner = undefined;
    if (this.aborted) return;

    if ((await this.ctx.pickUpHere()).length > 0) return;
    if (this.ctx.carriedParcelIds().includes(intention.parcelId)) return;

    throw new PlanFailedError(
      `GoPickUp: parcel ${intention.parcelId} was not at ` +
        `(${intention.target.x},${intention.target.y}) — stale beliefs`,
    );
  }
}
