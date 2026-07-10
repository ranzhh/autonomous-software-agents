import { describe, expect, it } from "vitest";
import type { Intention } from "../../src/bdi/intentions/index.js";
import type { PlanContext } from "../../src/bdi/plans/index.js";
import { BasePlan, PlanLibrary } from "../../src/bdi/plans/index.js";
import {
  buildGameMap,
  type GameMap,
  type Pos,
} from "../../src/core/beliefs/index.js";
import type {
  Direction,
  IOTile,
  IOTileType,
} from "../../src/core/sdk/index.js";
import { PlanFailedError, PlannerError } from "../../src/core/util/index.js";
import { PddlPlan, type PddlStep, type Solver } from "../../src/pddl/index.js";

// ---------------------------------------------------------------------------
// Test world: a tiny mutable state behind a fully-typed PlanContext
// ---------------------------------------------------------------------------

function lineMap(types: readonly IOTileType[]): GameMap {
  const tiles: IOTile[] = types.map((type, x) => ({ x, y: 0, type }));
  return buildGameMap(types.length, 1, tiles);
}

function applyDir(p: Pos, dir: Direction): Pos {
  switch (dir) {
    case "up":
      return { x: p.x, y: p.y + 1 };
    case "down":
      return { x: p.x, y: p.y - 1 };
    case "left":
      return { x: p.x - 1, y: p.y };
    case "right":
      return { x: p.x + 1, y: p.y };
  }
}

interface FreeParcel {
  id: string;
  x: number;
  y: number;
  reward: number;
  updatedAt: number;
}

class World {
  pos: { x: number; y: number };
  readonly free = new Map<string, FreeParcel>();
  readonly carried = new Map<
    string,
    { id: string; reward: number; updatedAt: number }
  >();
  putdowns = 0;
  moveBlocked = false;
  onMove: (() => void) | undefined;

  constructor(start: Pos) {
    this.pos = start;
  }

  addFree(id: string, x: number, reward = 10): void {
    this.free.set(id, { id, x, y: 0, reward, updatedAt: 0 });
  }

  addCarried(id: string, reward = 10): void {
    this.carried.set(id, { id, reward, updatedAt: 0 });
  }
}

function makeCtx(map: GameMap, world: World): PlanContext {
  return {
    map,
    moveDurationMs: 10,
    parcelDecayMs: Number.POSITIVE_INFINITY,
    now: () => 0,
    wait: async () => {},
    myPosition: () => ({
      x: Math.round(world.pos.x),
      y: Math.round(world.pos.y),
    }),
    myExactPosition: () => world.pos,
    isBlocked: () => false,
    emitMove: async (dir) => {
      if (world.moveBlocked) return false;
      world.pos = applyDir({ x: world.pos.x, y: world.pos.y }, dir);
      world.onMove?.();
      return { x: world.pos.x, y: world.pos.y };
    },
    emitPickup: async () =>
      [...world.free.values()]
        .filter((p) => p.x === world.pos.x && p.y === world.pos.y)
        .map((p) => ({ id: p.id })),
    emitPutdown: async () => {
      world.putdowns++;
      const out = [...world.carried.values()].map((p) => ({ id: p.id }));
      world.carried.clear();
      return out;
    },
    carriedParcelIds: () => [...world.carried.keys()],
    isParcelFree: (id) => world.free.has(id),
    freeParcelIdsAt: (p) =>
      [...world.free.values()]
        .filter((f) => f.x === p.x && f.y === p.y)
        .map((f) => f.id),
    applyPickup: (ids) => {
      for (const id of ids) {
        const p = world.free.get(id);
        if (p !== undefined) {
          world.free.delete(id);
          world.carried.set(id, {
            id,
            reward: p.reward,
            updatedAt: p.updatedAt,
          });
        }
      }
    },
    applyDelivered: (ids) => {
      for (const id of ids) world.carried.delete(id);
    },
    freeParcels: () => [...world.free.values()],
    carriedParcels: () => [...world.carried.values()],
  };
}

class FakeSolver implements Solver {
  readonly name = "fake";
  readonly problems: string[] = [];
  private readonly script: Array<readonly PddlStep[] | null | Error>;

  constructor(script: Array<readonly PddlStep[] | null | Error>) {
    this.script = script;
  }

  async solve(
    _domain: string,
    problem: string,
  ): Promise<readonly PddlStep[] | null> {
    this.problems.push(problem);
    const next = this.script.shift();
    if (next instanceof Error) throw next;
    return next ?? null;
  }
}

class RecordingFallback extends BasePlan {
  override readonly name = "RecordingFallback";
  readonly executed: Intention[] = [];
  stopped = false;

  override isApplicableTo(): boolean {
    return true;
  }

  override async execute(intention: Intention): Promise<void> {
    this.executed.push(intention);
  }

  override stop(): void {
    this.stopped = true;
  }
}

function makePlan(
  ctx: PlanContext,
  solver: Solver,
): { plan: PddlPlan; fallback: RecordingFallback } {
  const fallback = new RecordingFallback(ctx);
  const plan = new PddlPlan(ctx, {
    solver,
    fallback: new PlanLibrary([fallback]),
  });
  return { plan, fallback };
}

const pickupIntent = (id: string, target: Pos): Intention => ({
  kind: "pickup",
  parcelId: id,
  target,
});

// ---------------------------------------------------------------------------

describe("PddlPlan — applicability", () => {
  it("applies to in-bounds pickup and deliver, not goto/explore", () => {
    const map = lineMap(["3", "3", "2"]);
    const { plan } = makePlan(
      makeCtx(map, new World({ x: 0, y: 0 })),
      new FakeSolver([]),
    );
    expect(plan.isApplicableTo(pickupIntent("p", { x: 1, y: 0 }))).toBe(true);
    expect(
      plan.isApplicableTo({ kind: "deliver", target: { x: 2, y: 0 } }),
    ).toBe(true);
    expect(plan.isApplicableTo(pickupIntent("p", { x: 9, y: 9 }))).toBe(false);
    expect(plan.isApplicableTo({ kind: "goto", target: { x: 1, y: 0 } })).toBe(
      false,
    );
    expect(
      plan.isApplicableTo({ kind: "explore", target: { x: 1, y: 0 } }),
    ).toBe(false);
  });
});

describe("PddlPlan — executes a solved batched tour", () => {
  it("runs move/pickup/move/pickup/move/deliver-all against the world", async () => {
    //  x:  0(me) 1  2(p1) 3  4(p2) 5(delivery)
    const map = lineMap(["3", "3", "3", "3", "3", "2"]);
    const world = new World({ x: 0, y: 0 });
    world.addFree("p1", 2);
    world.addFree("p2", 4);
    const solver = new FakeSolver([
      [
        { action: "move", args: ["l_0_0", "l_2_0"] },
        { action: "pickup", args: ["p_p1", "l_2_0"] },
        { action: "move", args: ["l_2_0", "l_4_0"] },
        { action: "pickup", args: ["p_p2", "l_4_0"] },
        { action: "move", args: ["l_4_0", "l_5_0"] },
        { action: "deliver", args: ["p_p1", "l_5_0"] },
        { action: "deliver", args: ["p_p2", "l_5_0"] },
      ],
    ]);
    const { plan, fallback } = makePlan(makeCtx(map, world), solver);

    await plan.execute(pickupIntent("p1", { x: 2, y: 0 }));

    expect(world.pos).toEqual({ x: 5, y: 0 });
    expect(world.putdowns).toBe(1); // consecutive delivers collapsed
    expect(world.carried.size).toBe(0);
    expect(world.free.size).toBe(0);
    expect(fallback.executed).toHaveLength(0);
    // The problem the solver saw was built from live beliefs.
    expect(solver.problems[0]).toContain("p_p1");
    expect(solver.problems[0]).toContain("(delivery l_5_0)");
  });

  it("treats a parcel already grabbed en route by GoTo as picked, not stale", async () => {
    const map = lineMap(["3", "3", "3", "2"]);
    const world = new World({ x: 0, y: 0 });
    world.addFree("p1", 1);
    // The solver plans an explicit pickup at l_1_0, but GoTo's opportunistic
    // grab on arrival will already have taken it.
    const solver = new FakeSolver([
      [
        { action: "move", args: ["l_0_0", "l_1_0"] },
        { action: "pickup", args: ["p_p1", "l_1_0"] },
        { action: "move", args: ["l_1_0", "l_3_0"] },
        { action: "deliver", args: ["p_p1", "l_3_0"] },
      ],
    ]);
    const { plan, fallback } = makePlan(makeCtx(map, world), solver);

    await plan.execute(pickupIntent("p1", { x: 1, y: 0 }));

    expect(solver.problems).toHaveLength(1); // no spurious replan
    expect(world.putdowns).toBe(1);
    expect(fallback.executed).toHaveLength(0);
  });
});

describe("PddlPlan — reactive fallback", () => {
  it("falls back when the solver finds no plan", async () => {
    const map = lineMap(["3", "3", "2"]);
    const world = new World({ x: 0, y: 0 });
    world.addFree("p1", 1);
    const { plan, fallback } = makePlan(
      makeCtx(map, world),
      new FakeSolver([null]),
    );

    await plan.execute(pickupIntent("p1", { x: 1, y: 0 }));

    expect(fallback.executed).toEqual([pickupIntent("p1", { x: 1, y: 0 })]);
  });

  it("falls back when the solver throws PlannerError", async () => {
    const map = lineMap(["3", "3", "2"]);
    const world = new World({ x: 0, y: 0 });
    world.addFree("p1", 1);
    const { plan, fallback } = makePlan(
      makeCtx(map, world),
      new FakeSolver([new PlannerError("solver unreachable")]),
    );

    await plan.execute(pickupIntent("p1", { x: 1, y: 0 }));

    expect(fallback.executed).toHaveLength(1);
  });

  it("falls back when no tour is plannable (no reachable delivery)", async () => {
    const map = lineMap(["3", "3", "3"]); // no delivery tile at all
    const world = new World({ x: 0, y: 0 });
    world.addCarried("c1");
    const solver = new FakeSolver([]);
    const { plan, fallback } = makePlan(makeCtx(map, world), solver);

    await plan.execute({ kind: "deliver", target: { x: 2, y: 0 } });

    expect(solver.problems).toHaveLength(0); // never solved
    expect(fallback.executed).toHaveLength(1);
  });

  it("falls back when my position never settles on a tile", async () => {
    const map = lineMap(["3", "3", "2"]);
    const world = new World({ x: 0.6, y: 0 }); // permanently mid-move
    world.addFree("p1", 1);
    const solver = new FakeSolver([]);
    const { plan, fallback } = makePlan(makeCtx(map, world), solver);

    await plan.execute(pickupIntent("p1", { x: 1, y: 0 }));

    expect(solver.problems).toHaveLength(0);
    expect(fallback.executed).toHaveLength(1);
  });
});

describe("PddlPlan — replanning", () => {
  it("replans when a leg fails, then falls back once replans are exhausted", async () => {
    const map = lineMap(["3", "3", "2"]);
    const world = new World({ x: 0, y: 0 });
    world.addFree("p1", 1);
    world.moveBlocked = true; // every emitMove returns false → GoTo gives up
    const tourSteps: readonly PddlStep[] = [
      { action: "move", args: ["l_0_0", "l_1_0"] },
      { action: "pickup", args: ["p_p1", "l_1_0"] },
    ];
    const solver = new FakeSolver([tourSteps, tourSteps, tourSteps]);
    const { plan, fallback } = makePlan(makeCtx(map, world), solver);

    await plan.execute(pickupIntent("p1", { x: 1, y: 0 }));

    expect(solver.problems).toHaveLength(3); // initial + 2 replans
    expect(fallback.executed).toHaveLength(1);
  });

  it("replans when planned parcels vanished (belief change)", async () => {
    const map = lineMap(["3", "3", "2"]);
    const world = new World({ x: 0, y: 0 });
    world.addFree("p1", 1);
    world.addFree("gone", 1);
    // First plan only picks "gone"; the world loses it as soon as we move.
    const solver = new FakeSolver([
      [
        { action: "move", args: ["l_0_0", "l_1_0"] },
        { action: "pickup", args: ["p_gone", "l_1_0"] },
      ],
      null, // second solve finds nothing → fallback
    ]);
    const ctx = makeCtx(map, world);
    // "gone" vanishes as soon as we move; p1 stays (and is grabbed on arrival
    // by GoTo), so round 2 still has a plannable carried-only tour.
    world.onMove = () => world.free.delete("gone");
    const { plan, fallback } = makePlan(ctx, solver);

    await plan.execute(pickupIntent("p1", { x: 1, y: 0 }));

    expect(solver.problems).toHaveLength(2);
    expect(fallback.executed).toHaveLength(1);
  });
});

describe("PddlPlan — pre-checks and stop", () => {
  it("throws PlanFailedError when the pickup target is no longer free", async () => {
    const map = lineMap(["3", "3", "2"]);
    const world = new World({ x: 0, y: 0 });
    const { plan } = makePlan(makeCtx(map, world), new FakeSolver([]));
    await expect(
      plan.execute(pickupIntent("taken", { x: 1, y: 0 })),
    ).rejects.toBeInstanceOf(PlanFailedError);
  });

  it("throws PlanFailedError on deliver with nothing carried", async () => {
    const map = lineMap(["3", "3", "2"]);
    const world = new World({ x: 0, y: 0 });
    const { plan } = makePlan(makeCtx(map, world), new FakeSolver([]));
    await expect(
      plan.execute({ kind: "deliver", target: { x: 2, y: 0 } }),
    ).rejects.toBeInstanceOf(PlanFailedError);
  });

  it("stop() aborts the tour without falling back", async () => {
    const map = lineMap(["3", "3", "3", "3", "3", "2"]);
    const world = new World({ x: 0, y: 0 });
    world.addFree("p1", 4);
    const solver = new FakeSolver([
      [
        { action: "move", args: ["l_0_0", "l_4_0"] },
        { action: "pickup", args: ["p_p1", "l_4_0"] },
        { action: "move", args: ["l_4_0", "l_5_0"] },
        { action: "deliver", args: ["p_p1", "l_5_0"] },
      ],
    ]);
    const ctx = makeCtx(map, world);
    const { plan, fallback } = makePlan(ctx, solver);
    world.onMove = () => plan.stop(); // abort after the first real move

    await plan.execute(pickupIntent("p1", { x: 4, y: 0 }));

    expect(world.putdowns).toBe(0);
    expect(fallback.executed).toHaveLength(0);
  });

  it("is reusable after a prior stop()", async () => {
    const map = lineMap(["3", "3", "2"]);
    const world = new World({ x: 0, y: 0 });
    world.addFree("p1", 1);
    const solver = new FakeSolver([
      [
        { action: "move", args: ["l_0_0", "l_1_0"] },
        { action: "pickup", args: ["p_p1", "l_1_0"] },
      ],
    ]);
    const { plan } = makePlan(makeCtx(map, world), solver);
    plan.stop();
    await plan.execute(pickupIntent("p1", { x: 1, y: 0 }));
    expect(world.carried.has("p1")).toBe(true);
  });
});
