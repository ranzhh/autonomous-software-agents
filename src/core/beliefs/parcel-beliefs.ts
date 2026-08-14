/**
 * Per-parcel belief revision. Revision rule: if a parcel's position is in the
 * visible-tile set (`sensing.positions`) but the parcel is absent from
 * `sensing.parcels`, it is gone — forget it. Out-of-view parcels are kept
 * and their reward decays locally. Carried-by-me parcels always sit on my
 * visible tile, so the same rule is the phantom-carry guard (CLAUDE.md §6):
 * after delivery I no longer sense the parcel → forget it → the deliver
 * intention cannot pin forever.
 *
 * Decay math: `Math.floor(reward − 1)` per `decayMs` interval; expires at 0.
 * `decayMs = +Infinity` (the `'infinite'` event) means no decay.
 */

export interface ParcelEntry {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly carriedBy: string | undefined;
  /** Last-seen reward (integer, ≥ 0). */
  readonly reward: number;
  /** Timestamp of last sensing update (`now()` at the moment of upsert). */
  readonly updatedAt: number;
}

type RawParcel = {
  id: string;
  x: number;
  y: number;
  carriedBy?: string | undefined;
  reward: number;
};

export interface ParcelBeliefs {
  /**
   * Revise beliefs from one sensing snapshot.
   * @param parcels  The parcels from `IOSensing`.
   * @param visible  Currently-visible tile positions as `"x,y"` strings.
   * @param myId     My agent id — classifies carried-by-me parcels.
   * @param now      Current timestamp in ms (injectable for tests).
   */
  revise(
    parcels: ReadonlyArray<RawParcel>,
    visible: ReadonlySet<string>,
    myId: string,
    now: number,
  ): void;

  /**
   * Remaining reward for parcel `id`, accounting for local decay since
   * `updatedAt`. Returns `undefined` if the parcel is not believed.
   */
  remainingReward(id: string, now: number): number | undefined;

  /**
   * Optimistically mark parcels `ids` as carried by `myId`, from an `emitPickup`
   * ack — so the next deliberation sees the pickup immediately instead of waiting
   * for the following sensing tick (which would otherwise let it re-commit to the
   * same now-stale pickup). Unknown ids are ignored. The next `revise` reconciles
   * against the server's truth.
   */
  applyPickup(ids: readonly string[], myId: string, now: number): void;

  /**
   * Drop parcels `ids` outright — the caller has direct evidence they are not
   * where we believed. In practice: an `emitPickup` that returned nothing on a
   * tile where we believed free parcels sat (they were taken, expired, or we
   * already carry them). Sensing is still the source of truth and re-adds them
   * on the next tick if they do exist; this only stops deliberation from
   * re-targeting a phantom in the meantime.
   */
  forget(ids: readonly string[]): void;

  /** Parcels not being carried by anyone (free to pick up). */
  free(): readonly ParcelEntry[];

  /** Parcels I am currently carrying. */
  carriedByMe(): readonly ParcelEntry[];

  /** Parcels carried by another agent (rivals or teammates). */
  carriedByOther(): readonly ParcelEntry[];

  /** All believed parcels (free + carried). */
  all(): readonly ParcelEntry[];
}

/**
 * Create a mutable `ParcelBeliefs` store.
 * @param decayMs  Decay interval in ms (`+Infinity` = no decay); from `Settings.parcelDecayMs`.
 */
export function createParcelBeliefs(decayMs: number): ParcelBeliefs {
  const store = new Map<string, ParcelEntry>();
  let myIdRef: string | undefined;

  function remainingReward(id: string, now: number): number | undefined {
    const e = store.get(id);
    if (e === undefined) return undefined;
    if (!Number.isFinite(decayMs)) return e.reward;
    const elapsed = Math.max(0, now - e.updatedAt);
    const ticks = Math.floor(elapsed / decayMs);
    return Math.max(0, e.reward - ticks);
  }

  function revise(
    parcels: ReadonlyArray<RawParcel>,
    visible: ReadonlySet<string>,
    myId: string,
    now: number,
  ): void {
    myIdRef = myId;

    // Upsert every sensed parcel, re-syncing reward to the server's truth.
    const sensedIds = new Set<string>();
    for (const p of parcels) {
      sensedIds.add(p.id);
      store.set(p.id, {
        id: p.id,
        x: p.x,
        y: p.y,
        carriedBy: p.carriedBy ?? undefined,
        reward: p.reward,
        updatedAt: now,
      });
    }

    // Forget parcels absent from this sensing snapshot.
    //   - Carried-by-me parcels: I always perceive what I carry, so absence
    //     means the parcel was delivered or lost. Forget unconditionally —
    //     do NOT gate on the stored tile being visible, because a carried
    //     parcel keeps its last-sensed position (typically the pickup tile),
    //     which is no longer in view once I walk to a distant delivery tile.
    //     This is the phantom-carry guard (CLAUDE.md §6): without it `deliver`
    //     pins forever and the agent freezes on the delivery tile.
    //   - Other parcels (free / carried-by-others): only forget when their
    //     tile is currently visible (picked up / expired server-side); an
    //     out-of-view parcel is kept and decays locally.
    for (const [id, entry] of store) {
      if (sensedIds.has(id)) continue;
      if (entry.carriedBy === myId || visible.has(`${entry.x},${entry.y}`)) {
        store.delete(id);
      }
    }

    // Drop out-of-view parcels whose locally-computed reward has hit 0.
    for (const [id] of store) {
      if (!sensedIds.has(id) && remainingReward(id, now) === 0) {
        store.delete(id);
      }
    }
  }

  function applyPickup(
    ids: readonly string[],
    myId: string,
    now: number,
  ): void {
    myIdRef = myId;
    for (const id of ids) {
      const e = store.get(id);
      if (e === undefined) continue;
      store.set(id, { ...e, carriedBy: myId, updatedAt: now });
    }
  }

  function forget(ids: readonly string[]): void {
    for (const id of ids) store.delete(id);
  }

  function all(): readonly ParcelEntry[] {
    return Array.from(store.values());
  }

  function free(): readonly ParcelEntry[] {
    return all().filter((e) => e.carriedBy === undefined);
  }

  function carriedByMe(): readonly ParcelEntry[] {
    if (myIdRef === undefined) return [];
    const id = myIdRef;
    return all().filter((e) => e.carriedBy === id);
  }

  function carriedByOther(): readonly ParcelEntry[] {
    const id = myIdRef;
    return all().filter((e) => e.carriedBy !== undefined && e.carriedBy !== id);
  }

  return {
    revise,
    remainingReward,
    applyPickup,
    forget,
    free,
    carriedByMe,
    carriedByOther,
    all,
  };
}
