import { run } from "../agent.js";
import { believe } from "../beliefs.js";
import { grid } from "../grid.js";
import { log } from "../log.js";
import { naive } from "../plans.js";
import { key } from "../position.js";

await run(async (game, world) => {
  const beliefs = believe(world);
  let tiles = world.tiles;
  let board = grid(tiles);
  game.onSensing((sensing) => beliefs.seen(sensing));
  game.onTile((tile) => {
    tiles = [
      ...tiles.filter((t) => key(t.x, t.y) !== key(tile.x, tile.y)),
      tile,
    ];
    board = grid(tiles);
    beliefs.changed(tile);
  });

  const pace = () =>
    new Promise((resolve) =>
      setTimeout(resolve, world.config.GAME.player.movement_duration),
    );

  while (true) {
    const action = naive(beliefs, board);
    if (action === undefined) {
      await pace();
    } else if (action === "pickup") {
      const taken = await game.pickup();
      log.info({ taken }, "picked up");
    } else if (action === "putdown") {
      const delivered = await game.putdown();
      log.info({ delivered }, "delivered");
    } else {
      // A refused move means something is in the way; look again after one beat.
      const landed = await game.move(action);
      if (landed === false) await pace();
    }
    const me = game.me();
    if (me) beliefs.moved(me);
  }
});
