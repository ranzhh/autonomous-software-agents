import { run } from "../agent.js";
import { believe } from "../beliefs.js";
import { grid } from "../grid.js";
import { log } from "../log.js";
import { plan, type Step } from "../pddl.js";
import { deliberate, drift, type Intention } from "../plans.js";
import { key, MOVES, sameTile } from "../position.js";

// Runs deliberate() like agents/deliberate.ts, but executes whole plans from
// the PDDL solver. A plan is dropped when the intention changes, when a crate
// is not where the plan assumed, or when a move is refused.
await run(async (game, world) => {
  const beliefs = believe(world);
  let tiles = world.tiles;
  let board = grid(tiles);
  let boards = 0;
  let stale = true;
  game.onSensing((sensing) => {
    beliefs.seen(sensing);
    stale = true;
  });
  game.onTile((tile) => {
    tiles = [
      ...tiles.filter((t) => key(t.x, t.y) !== key(tile.x, tile.y)),
      tile,
    ];
    board = grid(tiles);
    boards++;
    beliefs.changed(tile);
    stale = true;
  });

  const pace = () =>
    new Promise((resolve) =>
      setTimeout(resolve, world.config.GAME.player.movement_duration),
    );

  let intention: Intention = { kind: "explore" };
  let queue: Step[] = [];
  let fromSolver = false;
  // Intentions the solver found no plan for, under the current crate layout.
  const vetoed = new Set<string>();
  const named = (i: Intention): string =>
    i.kind === "fetch"
      ? `fetch ${i.id}`
      : i.kind === "scout"
        ? `scout ${i.x},${i.y}`
        : i.kind;
  let layout = "";
  while (true) {
    const crates = beliefs
      .crates()
      .map((c) => `${c.id}@${key(c.x, c.y)}`)
      .sort()
      .join(" ");
    const seen = `${boards} ${crates}`;
    if (seen !== layout) {
      layout = seen;
      if (vetoed.size > 0) {
        vetoed.clear();
        stale = true;
      }
    }
    if (stale) {
      stale = false;
      const next = deliberate(
        beliefs,
        board,
        world.config,
        intention,
        Date.now(),
        (i) => vetoed.has(named(i)),
      );
      // deliberate() returns the held object when it keeps the intention.
      if (next !== intention) {
        intention = next;
        queue = [];
        log.info({ intention }, "intends");
      }
    }
    const me = beliefs.me();
    const at = { x: me.x ?? 0, y: me.y ?? 0 };

    // Grab loose parcels underfoot first; it costs no steps.
    const loose = beliefs.parcels().filter((p) => !p.carriedBy);
    if (loose.some((p) => sameTile(p, at))) {
      const taken = await game.pickup();
      beliefs.took(taken);
      stale = true;
      log.info({ taken }, "picked up");
      continue;
    }

    if (queue.length === 0) {
      try {
        const planned = await plan(intention, beliefs, board);
        if (Array.isArray(planned)) {
          queue = planned;
          fromSolver = true;
          log.info({ intention, steps: queue.length }, "planned");
        } else if (planned === "no plan") {
          vetoed.add(named(intention));
          stale = true;
          log.info({ intention }, "no plan");
          continue;
        } else if (intention.kind === "explore") {
          const step =
            board.route(...board.spawners).step(at) ?? drift(board, at);
          queue = step ? [{ do: step, push: false }] : [];
          fromSolver = false;
        } else {
          // The goal already holds or its target is gone: wait for fresh
          // beliefs, as pursue() does. Drifting off a spawner walks back to it.
          await pace();
          continue;
        }
      } catch (error) {
        log.error({ err: error }, "planning failed");
        await pace();
        continue;
      }
    }

    const step = queue.shift();
    if (step === undefined) {
      await pace();
    } else if (step.do === "pickup") {
      const taken = await game.pickup();
      beliefs.took(taken);
      stale = true;
      log.info({ taken }, "picked up");
    } else if (step.do === "putdown") {
      const delivered = await game.putdown();
      beliefs.gave();
      stale = true;
      log.info({ delivered }, "delivered");
    } else {
      // The step assumed a crate layout; when beliefs disagree, replan
      // instead of pushing a crate the plan never chose.
      if (fromSolver) {
        const target = {
          x: at.x + MOVES[step.do].dx,
          y: at.y + MOVES[step.do].dy,
        };
        const crated = beliefs.crates().some((c) => sameTile(c, target));
        if (crated !== step.push) {
          queue = [];
          stale = true;
          log.info({ step, crated }, "plan diverged");
          continue;
        }
      }
      const landed = await game.move(step.do);
      // After a refusal the rest of the plan starts from a tile we never
      // reached: drop it, sidestep, replan.
      if (landed === false) {
        stale = true;
        queue = [];
        const aside = drift(board, at) ?? step.do;
        if ((await game.move(aside)) === false) await pace();
      } else if (landed === undefined) {
        // A lost ack leaves the position unknown; the rest of the plan may
        // start from the wrong tile. Drop it and replan from fresh beliefs.
        stale = true;
        queue = [];
      }
    }
    const now = game.me();
    if (now) beliefs.moved(now);
  }
});
