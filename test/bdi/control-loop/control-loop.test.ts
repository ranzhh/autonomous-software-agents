import { describe, expect, it } from "vitest";
import {
  createControlLoop,
  type Deliberator,
} from "../../../src/bdi/control-loop/index.js";
import type { Intention } from "../../../src/bdi/intentions/index.js";
import {
  BasePlan,
  type PlanContext,
  PlanLibrary,
} from "../../../src/bdi/plans/index.js";
import {
  type BeliefSet,
  createBeliefSet,
} from "../../../src/core/beliefs/index.js";
import type {
  GameConnection,
  GameMapData,
  IOAgent,
  IOConfig,
  IOSensing,
  PickedParcel,
  Position,
} from "../../../src/core/sdk/index.js";
import {
  createLogger,
  type Logger,
  PlanFailedError,
} from "../../../src/core/util/index.js";

// ── Test doubles ──────────────────────────────────────────────────────────────

/** Minimal GameConnection — the loop only needs a BeliefSet to hang events on. */
const stubConnection: GameConnection = {
  ready: async () => undefined,
  isReady: () => true,
  config: (): IOConfig | undefined => undefined,
  map: (): GameMapData | undefined => undefined,
  me: (): IOAgent | undefined => undefined,
  onSensing: (_listener: (s: IOSensing) => void) => undefined,
  emitMove: async (): Promise<Position | false> => false,
  emitPickup: async (): Promise<readonly PickedParcel[]> => [],
  emitPutdown: async (): Promise<readonly PickedParcel[]> => [],
  disconnect: () => undefined,
};

function beliefs(): BeliefSet {
  return createBeliefSet(stubConnection);
}

/** A logger that swallows everything (the loop logs on every cycle). */
function silentLogger(): Logger {
  return createLogger({ scope: "test", level: "error", sinks: [] });
}

/**
 * A single plan instance reused for every intention — exactly how the real
 * `PlanLibrary` behaves, and the condition the generation token exists for.
 * Each `execute` parks on a promise the test resolves by hand.
 */
class ScriptedPlan extends BasePlan {
  override readonly name = "Scripted";
  readonly started: Intention[] = [];
  private release: Array<(outcome: "ok" | "fail") => void> = [];

  constructor() {
    super({} as PlanContext);
  }

  override isApplicableTo(): boolean {
    return true;
  }

  override stop(): void {
    // Cooperative: the test decides when a stopped execution unwinds.
  }

  override execute(intention: Intention): Promise<void> {
    this.started.push(intention);
    return new Promise<void>((resolve, reject) => {
      this.release.push((outcome) => {
        if (outcome === "ok") resolve();
        else reject(new PlanFailedError("scripted failure"));
      });
    });
  }

  /** Let the n-th started execution finish. */
  finish(index: number, outcome: "ok" | "fail" = "ok"): void {
    const release = this.release[index];
    if (release === undefined) throw new Error(`no execution #${index}`);
    release(outcome);
  }

  /**
   * Release every execution still parked. Resolving an already-resolved
   * promise is a no-op, so this is safe after explicit `finish` calls — it
   * just unblocks `loop.stop()`, which legitimately awaits the running plan.
   */
  finishAll(): void {
    for (const release of this.release) release("ok");
  }
}

/** Records reset() calls and returns a scripted sequence of intentions. */
class ScriptedDeliberator implements Deliberator {
  resets = 0;
  private queue: Array<Intention | undefined> = [];
  /** Returned once the queue is drained. */
  fallback: Intention | undefined = undefined;

  constructor(...intentions: Array<Intention | undefined>) {
    this.queue = intentions;
  }

  revise(): Intention | undefined {
    return this.queue.length > 0 ? this.queue.shift() : this.fallback;
  }

  reset(): void {
    this.resets += 1;
  }
}

const explore = (x: number, y: number): Intention => ({
  kind: "explore",
  target: { x, y },
});

/** Let queued microtasks (plan unwinding) run to completion. */
const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

function makeLoop(plan: ScriptedPlan, deliberator: ScriptedDeliberator) {
  return createControlLoop({
    beliefs: beliefs(),
    library: new PlanLibrary([() => plan]),
    revision: deliberator,
    logger: silentLogger(),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createControlLoop", () => {
  it("adopts an intention and runs the selected plan", async () => {
    const plan = new ScriptedPlan();
    const deliberator = new ScriptedDeliberator(explore(1, 1));
    const loop = makeLoop(plan, deliberator);

    loop.deliberateAndAct();

    expect(plan.started).toEqual([explore(1, 1)]);
    expect(loop.activePlan()).toBe(plan);
    plan.finishAll();
    await loop.stop();
  });

  it("resets the commitment and re-deliberates when a plan completes", async () => {
    const plan = new ScriptedPlan();
    const deliberator = new ScriptedDeliberator(explore(1, 1), explore(2, 2));
    const loop = makeLoop(plan, deliberator);

    loop.deliberateAndAct();
    plan.finish(0);
    await flush();

    expect(deliberator.resets).toBe(1);
    // The completion re-deliberated on its own, without a sensing event.
    expect(plan.started).toEqual([explore(1, 1), explore(2, 2)]);
    plan.finishAll();
    await loop.stop();
  });

  it("logs and resets when the running plan fails", async () => {
    const plan = new ScriptedPlan();
    const deliberator = new ScriptedDeliberator(explore(1, 1));
    const loop = makeLoop(plan, deliberator);

    loop.deliberateAndAct();
    plan.finish(0, "fail");
    await flush();

    expect(deliberator.resets).toBe(1);
    plan.finishAll();
    await loop.stop();
  });

  /**
   * The 2026-08-14 regression. Plans are singletons, so after a preemption the
   * superseded execution and its replacement share one object: an identity
   * check (`activePlan === plan`) cannot tell them apart, and the dead one
   * resets the live commitment and re-deliberates as it unwinds — 1498 spurious
   * cycles in 15s live, with overlapping actions penalised until the server
   * kicked the agent.
   */
  it("ignores a superseded execution of the same plan instance", async () => {
    const plan = new ScriptedPlan();
    const deliberator = new ScriptedDeliberator(explore(1, 1), explore(2, 2));
    const loop = makeLoop(plan, deliberator);

    loop.deliberateAndAct(); // run #0 — adopts explore(1,1)
    loop.deliberateAndAct(); // run #1 — preempts with explore(2,2)
    expect(plan.started).toEqual([explore(1, 1), explore(2, 2)]);

    // The preempted run #0 only now finishes unwinding.
    plan.finish(0);
    await flush();

    // It must touch nothing: no reset, no re-deliberation, and the live run
    // still owns activePlan.
    expect(deliberator.resets).toBe(0);
    expect(plan.started).toHaveLength(2);
    expect(loop.activePlan()).toBe(plan);

    plan.finishAll();
    await loop.stop();
  });

  it("ignores a superseded execution that fails", async () => {
    const plan = new ScriptedPlan();
    const deliberator = new ScriptedDeliberator(explore(1, 1), explore(2, 2));
    const loop = makeLoop(plan, deliberator);

    loop.deliberateAndAct();
    loop.deliberateAndAct();
    plan.finish(0, "fail");
    await flush();

    // A dead plan failing must not clear the commitment its replacement runs on.
    expect(deliberator.resets).toBe(0);
    expect(plan.started).toHaveLength(2);
    plan.finishAll();
    await loop.stop();
  });

  it("does not re-deliberate after stop()", async () => {
    const plan = new ScriptedPlan();
    const deliberator = new ScriptedDeliberator(explore(1, 1));
    deliberator.fallback = explore(9, 9);
    const loop = makeLoop(plan, deliberator);

    loop.deliberateAndAct();
    const stopping = loop.stop();
    plan.finish(0);
    await stopping;
    await flush();

    expect(plan.started).toEqual([explore(1, 1)]);
  });

  it("re-deliberates on every belief update once started", async () => {
    const plan = new ScriptedPlan();
    const deliberator = new ScriptedDeliberator(explore(1, 1));
    deliberator.fallback = undefined; // keep the current plan
    const belief = beliefs();
    const loop = createControlLoop({
      beliefs: belief,
      library: new PlanLibrary([() => plan]),
      revision: deliberator,
      logger: silentLogger(),
    });

    loop.start(); // bootstrap deliberation
    expect(plan.started).toHaveLength(1);

    plan.finishAll();
    await loop.stop();
  });
});
