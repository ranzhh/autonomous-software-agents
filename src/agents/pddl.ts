import { run } from "../agent.js";
import { believe } from "../beliefs.js";
import { grid } from "../grid.js";
import { log } from "../log.js";
import { plan } from "../pddl.js";
import { type Action, deliberate, drift, type Intention } from "../plans.js";
import { key, sameTile } from "../position.js";

// Runs deliberate() like agents/deliberate.ts, but executes whole plans from
// the PDDL solver. A plan is dropped when the intention changes or a move is
// refused.
await run(async (game, world) => {
  const beliefs = believe(world);
  let tiles = world.tiles;
  let board = grid(tiles);
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
    beliefs.changed(tile);
    stale = true;
  });

  const pace = () =>
    new Promise((resolve) =>
      setTimeout(resolve, world.config.GAME.player.movement_duration),
    );

  let intention: Intention = { kind: "explore" };
  let queue: Action[] = [];
  while (true) {
    if (stale) {
      stale = false;
      const next = deliberate(beliefs, board, world.config, intention);
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
        if (planned) {
          queue = planned;
          log.info({ intention, steps: queue.length }, "planned");
        } else {
          const step =
            board.route(...board.spawners).step(at) ?? drift(board, at);
          queue = step ? [step] : [];
        }
      } catch (error) {
        log.error({ err: error }, "planning failed");
        await pace();
        continue;
      }
    }

    const action = queue.shift();
    if (action === undefined) {
      await pace();
    } else if (action === "pickup") {
      const taken = await game.pickup();
      beliefs.took(taken);
      stale = true;
      log.info({ taken }, "picked up");
    } else if (action === "putdown") {
      const delivered = await game.putdown();
      beliefs.gave();
      stale = true;
      log.info({ delivered }, "delivered");
    } else {
      const landed = await game.move(action);
      // After a refusal the rest of the plan starts from a tile we never
      // reached: drop it, sidestep, replan.
      if (landed === false) {
        stale = true;
        queue = [];
        const aside = drift(board, at) ?? action;
        if ((await game.move(aside)) === false) await pace();
      }
    }
    const now = game.me();
    if (now) beliefs.moved(now);
  }
});
