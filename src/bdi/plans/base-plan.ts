/**
 * The contract every reactive plan implements. A plan is constructed with a
 * `PlanContext` (its live view of the world + the action emitters) and serves an
 * `Intention`: `isApplicableTo` tells the `PlanLibrary` whether this plan can
 * achieve a given intention; `execute` carries it out, resolving on success or
 * throwing a `PlanFailedError` when it gives up; `stop` cooperatively aborts an
 * in-flight `execute` (the loop checks the flag and resolves early).
 *
 * Phase 2 ships one concrete plan (`GoTo`); Phase 3 adds GoPickUp/Deliver/Wander,
 * all sharing this contract and reusing `GoTo` for the navigation legs.
 */

import type { Intention } from "../intentions/index.js";
import type { PlanContext } from "./plan-context.js";

export abstract class BasePlan {
  constructor(protected readonly ctx: PlanContext) {}

  /** Stable identifier for logging / plan selection. */
  abstract readonly name: string;

  /** Can this plan achieve `intention` under the current beliefs? */
  abstract isApplicableTo(intention: Intention): boolean;

  /** Execute toward `intention`; resolves on success, throws on give-up. */
  abstract execute(intention: Intention): Promise<void>;

  /** Cooperatively abort an in-flight `execute`. */
  abstract stop(): void;
}
