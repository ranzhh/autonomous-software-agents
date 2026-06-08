/**
 * Navigate to a free parcel's tile and pick it up.
 *
 * Phantom-guard pre-check: if the parcel is no longer free at execution start
 * (it was taken while we were en route to deliberation), we throw immediately
 * so the BDI loop re-deliberates rather than walking to an empty tile.
 *
 * After navigating to the target, `emitPickup` grabs every uncarried parcel on
 * that tile in one action (CLAUDE.md §6). If the parcel was snatched just before
 * we arrive, we may still pick up others on the same tile — the BDI loop will
 * re-assess the carried set on the next sensing event regardless.
 */

import { PlanFailedError } from "../../core/util/index.js";
import type { Intention } from "../intentions/index.js";
import { BasePlan } from "./base-plan.js";
import { GoTo } from "./go-to.js";

export class GoPickUp extends BasePlan {
  override readonly name = "GoPickUp";
  private inner: GoTo | undefined = undefined;
  private aborted = false;
  private generation = 0;

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
    // Reset abort state so the instance can be reused after a prior stop().
    // A generation counter guards the post-navigation emitPickup against a stale
    // execution that was stopped and replaced before it reached this point.
    this.aborted = false;
    const gen = ++this.generation;

    if (intention.kind !== "pickup") {
      throw new PlanFailedError(
        `GoPickUp cannot execute intention "${intention.kind}"`,
      );
    }

    // Phantom-guard: abort immediately if the parcel is already taken.
    if (!this.ctx.isParcelFree(intention.parcelId)) {
      throw new PlanFailedError(
        `GoPickUp: parcel ${intention.parcelId} is no longer free — re-deliberating`,
      );
    }

    const inner = new GoTo(this.ctx);
    this.inner = inner;
    await inner.execute({ kind: "goto", target: intention.target });
    if (this.inner === inner) this.inner = undefined;

    if (!this.aborted && this.generation === gen) {
      await this.ctx.emitPickup();
    }
  }
}
