import { run } from "../agent.js";
import { DIRECTIONS, type Direction } from "../sdk.js";

await run(async (game, { config }) => {
  const pace = config.GAME.player.movement_duration;
  while (true) {
    const index = Math.floor(Math.random() * DIRECTIONS.length);
    await game.move(DIRECTIONS[index] as Direction);
    await new Promise((resolve) => setTimeout(resolve, pace));
  }
});
