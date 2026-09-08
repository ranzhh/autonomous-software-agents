import { run } from "../agent.js";
import { randomStream } from "../random.js";
import { DIRECTIONS, type Direction, type IOSensing } from "../sdk.js";

await run(async (game, { me, tiles, config }) => {
  const pace = config.GAME.player.movement_duration;
  const random = randomStream("dumb-walk");
  const deliveries = tiles.filter((tile) => tile.type === "2");

  let sensing: IOSensing | undefined;
  game.onSensing((next) => {
    sensing = next;
  });

  while (true) {
    const at = game.me();
    const here = (p: { x: number; y: number }) =>
      p.x === at?.x && p.y === at?.y;
    const parcels = sensing?.parcels ?? [];
    const carrying = parcels.some((p) => p.carriedBy === me.id);
    const underfoot = parcels.some((p) => !p.carriedBy && here(p));

    if (carrying && deliveries.some(here)) await game.putdown();
    else if (underfoot) await game.pickup();
    else {
      const index = Math.floor(random() * DIRECTIONS.length);
      await game.move(DIRECTIONS[index] as Direction);
    }
    await new Promise((resolve) => setTimeout(resolve, pace));
  }
});
