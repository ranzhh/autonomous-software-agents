import { describe, expect, it } from "vitest";
import type { Intention } from "../../../src/bdi/intentions/index.js";
import { GoTo, type PlanContext } from "../../../src/bdi/plans/index.js";
import {
  buildGameMap,
  type GameMap,
  type Pos,
} from "../../../src/core/beliefs/index.js";
import type { Direction, IOTile } from "../../../src/core/sdk/index.js";
import { PlanFailedError } from "../../../src/core/util/index.js";
import { applyDir, stubPlanContext } from "../../helpers/plan-context.js";

/** Build a width×height all-walkable map ("3") minus the given wall tiles ("0"). */
function gridMap(
  width: number,
  height: number,
  walls: ReadonlyArray<Pos> = [],
): GameMap {
  const wallSet = new Set(walls.map((p) => `${p.x},${p.y}`));
  const tiles: IOTile[] = [];
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      tiles.push({ x, y, type: wallSet.has(`${x},${y}`) ? "0" : "3" });
    }
  }
  return buildGameMap(width, height, tiles);
}

interface SimParams {
  readonly map: GameMap;
  readonly start: Pos;
  /** Tiles believed occupied by other agents. */
  readonly blocked?: ReadonlyArray<Pos>;
  /** Return true to make the n-th emitMove (1-based) resolve to `false`. */
  readonly failMove?: (attempt: number, dir: Direction) => boolean;
  /**
   * With `failMove`, still advance the position on a failed move — simulates
   * the SDK ack-timeout where the move executed server-side but the wrapper
   * reports `false` (CLAUDE.md §6).
   */
  readonly falseButExecutes?: boolean;
  /** Free parcels lying on the grid (collected when the agent steps on them). */
  readonly parcels?: ReadonlyArray<{ x: number; y: number; id: string }>;
}

interface Sim {
  readonly ctx: PlanContext;
  readonly emitted: Direction[];
  readonly visited: Pos[];
  readonly applied: string[];
  pos(): Pos;
  waits(): number;
}

/** A `PlanContext` that simulates a walking agent over a grid. */
function createSim(params: SimParams): Sim {
  const blockedSet = new Set(
    (params.blocked ?? []).map((p) => `${p.x},${p.y}`),
  );
  let position: Pos = params.start;
  const emitted: Direction[] = [];
  const visited: Pos[] = [params.start];
  const applied: string[] = [];
  // Mutable free-parcel store keyed by "x,y" → ids on that tile.
  const parcelTiles = new Map<string, string[]>();
  for (const p of params.parcels ?? []) {
    const key = `${p.x},${p.y}`;
    parcelTiles.set(key, [...(parcelTiles.get(key) ?? []), p.id]);
  }
  let attempts = 0;
  let waitCount = 0;

  const ctx: PlanContext = {
    map: params.map,
    moveDurationMs: 10,
    parcelDecayMs: Number.POSITIVE_INFINITY,
    now: () => 0,
    myPosition: () => position,
    myExactPosition: () => position,
    freeParcels: () => [],
    carriedParcels: () => [],
    isBlocked: (p) => blockedSet.has(`${p.x},${p.y}`),
    emitMove: async (dir) => {
      attempts++;
      emitted.push(dir);
      if (params.failMove?.(attempts, dir) === true) {
        if (params.falseButExecutes === true) {
          position = applyDir(position, dir);
          visited.push(position);
        }
        return false;
      }
      position = applyDir(position, dir);
      visited.push(position);
      return position;
    },
    // How the ack is interpreted is `PlanContext`'s job (see its own tests);
    // here it just yields whatever the tile holds, so GoTo's contract — call it
    // on every tile stepped onto — is what gets asserted.
    pickUpHere: async () => {
      const key = `${position.x},${position.y}`;
      const ids = parcelTiles.get(key) ?? [];
      parcelTiles.delete(key);
      applied.push(...ids);
      return ids;
    },
    putDownAll: async () => [],
    wait: async () => {
      waitCount++;
    },
    carriedParcelIds: () => [],
    isParcelFree: () => true,
  };

  return {
    ctx,
    emitted,
    visited,
    applied,
    pos: () => position,
    waits: () => waitCount,
  };
}

const goto = (target: Pos): Intention => ({ kind: "goto", target });

describe("GoTo — arrival", () => {
  it("walks a straight corridor and emits the step directions in order", async () => {
    const sim = createSim({ map: gridMap(4, 1), start: { x: 0, y: 0 } });
    await new GoTo(sim.ctx).execute(goto({ x: 3, y: 0 }));
    expect(sim.pos()).toEqual({ x: 3, y: 0 });
    expect(sim.emitted).toEqual(["right", "right", "right"]);
  });

  it("resolves immediately when already on the target", async () => {
    const sim = createSim({ map: gridMap(3, 3), start: { x: 1, y: 1 } });
    await new GoTo(sim.ctx).execute(goto({ x: 1, y: 1 }));
    expect(sim.emitted).toEqual([]);
  });
});

describe("GoTo — opportunistic pickup", () => {
  it("grabs a free parcel it walks over en route to the target", async () => {
    const sim = createSim({
      map: gridMap(4, 1),
      start: { x: 0, y: 0 },
      parcels: [{ x: 2, y: 0, id: "p9" }], // sits on the path to (3,0)
    });
    await new GoTo(sim.ctx).execute(goto({ x: 3, y: 0 }));
    expect(sim.pos()).toEqual({ x: 3, y: 0 });
    expect(sim.applied).toContain("p9");
  });

  it("does not pick up on a tile with no free parcel", async () => {
    const sim = createSim({ map: gridMap(4, 1), start: { x: 0, y: 0 } });
    await new GoTo(sim.ctx).execute(goto({ x: 3, y: 0 }));
    expect(sim.applied).toEqual([]);
  });
});

describe("GoTo — detours", () => {
  it("routes around a static wall", async () => {
    const map = gridMap(3, 3, [
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]);
    const sim = createSim({ map, start: { x: 0, y: 0 } });
    await new GoTo(sim.ctx).execute(goto({ x: 2, y: 0 }));
    expect(sim.pos()).toEqual({ x: 2, y: 0 });
    expect(sim.visited).toContainEqual({ x: 1, y: 2 }); // through the only gap
  });

  it("routes around a tile occupied by another agent", async () => {
    const map = gridMap(3, 3);
    const sim = createSim({
      map,
      start: { x: 0, y: 0 },
      blocked: [{ x: 1, y: 0 }],
    });
    await new GoTo(sim.ctx).execute(goto({ x: 2, y: 0 }));
    expect(sim.pos()).toEqual({ x: 2, y: 0 });
    expect(sim.visited).not.toContainEqual({ x: 1, y: 0 });
  });
});

describe("GoTo — failure handling", () => {
  it("recovers from a transient blocked move (waits, re-paths, completes)", async () => {
    const sim = createSim({
      map: gridMap(3, 1),
      start: { x: 0, y: 0 },
      failMove: (attempt) => attempt === 1, // first move bounces off an occupied tile
    });
    await new GoTo(sim.ctx).execute(goto({ x: 2, y: 0 }));
    expect(sim.pos()).toEqual({ x: 2, y: 0 });
    expect(sim.waits()).toBeGreaterThanOrEqual(1);
  });

  it("treats a false move with observed progress as a successful step (ack timeout)", async () => {
    // Every ack "fails" but the move executes server-side — with maxFailures 3
    // and a 5-step route, only progress-detection lets the plan complete.
    const sim = createSim({
      map: gridMap(6, 1),
      start: { x: 0, y: 0 },
      failMove: () => true,
      falseButExecutes: true,
    });
    await new GoTo(sim.ctx, { maxFailures: 3 }).execute(goto({ x: 5, y: 0 }));
    expect(sim.pos()).toEqual({ x: 5, y: 0 });
  });

  it("still gives up after maxFailures consecutive no-progress moves", async () => {
    const sim = createSim({
      map: gridMap(3, 1),
      start: { x: 0, y: 0 },
      failMove: () => true, // blocked forever, no progress
    });
    await expect(
      new GoTo(sim.ctx, { maxFailures: 3 }).execute(goto({ x: 2, y: 0 })),
    ).rejects.toBeInstanceOf(PlanFailedError);
    expect(sim.emitted.length).toBe(3);
  });

  it("gives up with a PlanFailedError when the target is unreachable", async () => {
    const map = gridMap(3, 1, [{ x: 1, y: 0 }]); // wall severs the corridor
    const sim = createSim({ map, start: { x: 0, y: 0 } });
    await expect(
      new GoTo(sim.ctx, { maxFailures: 3 }).execute(goto({ x: 2, y: 0 })),
    ).rejects.toBeInstanceOf(PlanFailedError);
    expect(sim.emitted).toEqual([]); // never even attempted a move
  });

  it("throws when the current position is unknown", async () => {
    const map = gridMap(3, 1);
    const ctx = stubPlanContext({
      map,
      myPosition: () => undefined,
      myExactPosition: () => undefined,
    });
    await expect(
      new GoTo(ctx).execute(goto({ x: 2, y: 0 })),
    ).rejects.toBeInstanceOf(PlanFailedError);
  });
});

describe("GoTo — stop() is terminal", () => {
  it("does not move after stop(); a retry needs a fresh instance", async () => {
    const sim = createSim({ map: gridMap(5, 1), start: { x: 0, y: 0 } });
    const plan = new GoTo(sim.ctx);
    plan.stop();

    await plan.execute(goto({ x: 4, y: 0 }));
    expect(sim.pos()).toEqual({ x: 0, y: 0 });
    expect(sim.emitted).toEqual([]);

    // `PlanLibrary` hands out a fresh instance per selection, which navigates.
    await new GoTo(sim.ctx).execute(goto({ x: 4, y: 0 }));
    expect(sim.pos()).toEqual({ x: 4, y: 0 });
  });
});

describe("GoTo — applicability", () => {
  it("is applicable to an in-bounds goto intention only", () => {
    const sim = createSim({ map: gridMap(3, 3), start: { x: 0, y: 0 } });
    const plan = new GoTo(sim.ctx);
    expect(plan.isApplicableTo(goto({ x: 2, y: 2 }))).toBe(true);
    expect(plan.isApplicableTo(goto({ x: 9, y: 9 }))).toBe(false);
  });
});
