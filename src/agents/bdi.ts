import { run } from "../agent.js";
import { believe } from "../beliefs.js";
import { env } from "../env.js";
import { executive } from "../executive.js";
import { team } from "../team.js";

await run(async (game, world) => {
  const mates = env.TEAM_SECRET
    ? team(game, world.me.id, env.TEAM_SECRET)
    : undefined;
  await executive(game, world, believe(world), mates);
});
