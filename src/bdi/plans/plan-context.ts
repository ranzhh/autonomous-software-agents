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

/** Free-parcel snapshot for tour planning (position + decay inputs). */
export interface ParcelSnapshot {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly reward: number;
  readonly updatedAt: number;
}

/** Carried-parcel snapshot (no position — it moves with me). */
export interface CarriedParcelSnapshot {
  readonly id: string;
  readonly reward: number;
  readonly updatedAt: number;
}

export interface PlanContext {
  /** My current tile (rounded), or `undefined` if my position is unknown. */
  myPosition(): Pos | undefined;
  /**
   * My raw position — fractional while a move is in flight (CLAUDE.md §6) —
   * or `undefined` if unknown. PDDL planning starts from a settled tile only.
   */
  myExactPosition(): { x: number; y: number } | undefined;
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
  /** Parcel decay interval (ms; `+Infinity` = no decay) — for value math. */
  readonly parcelDecayMs: number;
  /** Current time (ms); injectable for deterministic tests. */
  now(): number;
  /** Sleep `ms`; injectable so tests resolve instantly. */
  wait(ms: number): Promise<void>;
  /** IDs of parcels I am currently carrying (live query from beliefs). */
  carriedParcelIds(): readonly string[];
  /** Snapshot of free parcels believed to exist (for tour planning). */
  freeParcels(): readonly ParcelSnapshot[];
  /** Snapshot of the parcels I carry (for tour planning). */
  carriedParcels(): readonly CarriedParcelSnapshot[];
  /** True iff parcel `id` is believed to be free (not carried by anyone). */
  isParcelFree(id: string): boolean;
  /** IDs of free (uncarried) parcels believed to be sitting on tile `p`. */
  freeParcelIdsAt(p: Pos): readonly string[];
  /**
   * Optimistically record an `emitPickup` ack: mark `ids` carried-by-me in beliefs
   * now, so the next deliberation reflects the pickup without waiting for sensing
   * (prevents re-committing to the just-picked parcel). No-op without a known self id.
   */
  applyPickup(ids: readonly string[]): void;
  /** Optimistically record a delivery (`emitPutdown` on a delivery tile): forget `ids`. */
  applyDelivered(ids: readonly string[]): void;
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
    parcelDecayMs: settings.parcelDecayMs,
    now: () => Date.now(),
    wait,
    myPosition() {
      const me = beliefs.me;
      if (me === undefined) return undefined;
      const { x, y } = me;
      if (x === undefined || y === undefined) return undefined;
      return { x: Math.round(x), y: Math.round(y) };
    },
    myExactPosition() {
      const me = beliefs.me;
      if (me?.x === undefined || me.y === undefined) return undefined;
      return { x: me.x, y: me.y };
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
    carriedParcelIds() {
      return beliefs.parcels.carriedByMe().map((p) => p.id);
    },
    freeParcels() {
      return beliefs.parcels.free();
    },
    carriedParcels() {
      return beliefs.parcels.carriedByMe();
    },
    isParcelFree(id) {
      return beliefs.parcels.free().some((p) => p.id === id);
    },
    freeParcelIdsAt(p) {
      return beliefs.parcels
        .free()
        .filter((parcel) => parcel.x === p.x && parcel.y === p.y)
        .map((parcel) => parcel.id);
    },
    applyPickup(ids) {
      const myId = beliefs.me?.id;
      if (myId === undefined || ids.length === 0) return;
      beliefs.parcels.applyPickup(ids, myId, Date.now());
    },
    applyDelivered(ids) {
      if (ids.length === 0) return;
      beliefs.parcels.applyDelivered(ids);
    },
  };
}
