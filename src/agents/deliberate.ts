import { run } from "../agent.js";
import { believe } from "../beliefs.js";
import { grid } from "../grid.js";
import { log } from "../log.js";
import { decide, drift, type Intention, pursue } from "../plans.js";
import { key } from "../position.js";

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
  while (true) {
    if (stale) {
      stale = false;
      const choice = decide(beliefs, board, world.config, intention);
      if (choice.intention !== intention) {
        log.info(
          {
            from: intention,
            to: choice.intention,
            was: choice.heldUtility,
            now: choice.utility,
          },
          "switches",
        );
        intention = choice.intention;
      }
    }
    const action = pursue(intention, beliefs, board);
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
      // A refusal replans into the same blocked step, since the grid knows
      // nothing of whoever is in the way; sidestep and reconsider.
      if (landed === false) {
        stale = true;
        const { x, y } = beliefs.me();
        const aside = drift(board, { x, y }) ?? action;
        if ((await game.move(aside)) === false) await pace();
      }
    }
    const me = game.me();
    if (me) beliefs.moved(me);
  }
});
