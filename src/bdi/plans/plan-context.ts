/**
 * The narrow runtime view a `Plan` executes against — self position, the static
 * map, a dynamic blocker predicate, the SDK action emitters, the move duration,
 * and an injectable `wait`. Keeping it narrow (rather than handing plans the whole
 * `BeliefSet` + `GameConnection`) makes plans unit-testable with a tiny
 * plain-object stub. `createPlanContext` bridges the real runtime into this view.
 *
 * Blockers are other agents' tiles, rounded from their last-known (possibly
 * fractional, mid-move) coordinates. A plan re-evaluates `isBlocked`/`myPosition`
 * each step, so this view stays live as beliefs are revised.
 */

import type { BeliefSet, GameMap, Pos } from "../../core/beliefs/index.js";
import type {
  Direction,
  GameConnection,
  PickedParcel,
  Position,
} from "../../core/sdk/index.js";
import { PlanFailedError } from "../../core/util/index.js";

export interface PlanContext {
  /** My current tile (rounded), or `undefined` if my position is unknown. */
  myPosition(): Pos | undefined;
  /** The static map model. */
  readonly map: GameMap;
  /** True if tile `p` is currently occupied by another agent. */
  isBlocked(p: Pos): boolean;
  /** Move one tile; resolves to the new position or `false` if it was occupied. */
  emitMove(direction: Direction): Promise<Position | false>;
  /** Pick up every uncarried parcel on the current tile. */
  emitPickup(): Promise<readonly PickedParcel[]>;
  /** Put down parcels (omit/`[]` drops ALL). */
  emitPutdown(ids?: readonly string[]): Promise<readonly PickedParcel[]>;
  /** `movement_duration` (ms) — the unit of the wait-and-retry backoff. */
  readonly moveDurationMs: number;
  /** Sleep `ms`; injectable so tests resolve instantly. */
  wait(ms: number): Promise<void>;
}

export interface PlanContextOptions {
  /** Override the sleep used for retry backoff (tests pass an instant resolver). */
  readonly wait?: (ms: number) => Promise<void>;
}

function defaultWait(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Build a `PlanContext` from the live `BeliefSet` + `GameConnection`. Throws a
 * `PlanFailedError` if beliefs are not ready yet (no map / settings), since a
 * plan cannot navigate without them.
 */
export function createPlanContext(
  beliefs: BeliefSet,
  connection: GameConnection,
  options: PlanContextOptions = {},
): PlanContext {
  const map = beliefs.gameMap;
  const settings = beliefs.settings;
  if (map === undefined || settings === undefined) {
    throw new PlanFailedError(
      "createPlanContext: beliefs not ready (map or settings missing)",
    );
  }

  const moveDurationMs = settings.movementDurationMs;
  const wait = options.wait ?? defaultWait;

  return {
    map,
    moveDurationMs,
    wait,
    myPosition() {
      const me = beliefs.me;
      if (me === undefined) return undefined;
      const { x, y } = me;
      if (x === undefined || y === undefined) return undefined;
      return { x: Math.round(x), y: Math.round(y) };
    },
    isBlocked(p) {
      for (const a of beliefs.agents.all()) {
        if (a.x === undefined || a.y === undefined) continue;
        if (Math.round(a.x) === p.x && Math.round(a.y) === p.y) return true;
      }
      return false;
    },
    emitMove: (direction) => connection.emitMove(direction),
    emitPickup: () => connection.emitPickup(),
    emitPutdown: (ids) => connection.emitPutdown(ids),
  };
}
