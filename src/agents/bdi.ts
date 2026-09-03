import { run } from "../agent.js";
import { believe } from "../beliefs.js";
import { executive } from "../executive.js";

await run(async (game, world) => {
  await executive(game, world, believe(world));
});
