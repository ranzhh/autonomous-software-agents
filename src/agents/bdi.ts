import { run } from "../agent.js";
import { believe } from "../beliefs.js";
import { env } from "../env.js";
import { executive } from "../executive.js";
import { orders, policyOf, react } from "../policy.js";
import { team } from "../team.js";

await run(async (game, world) => {
  const mates = env.TEAM_SECRET
    ? team(game, world.me.id, env.TEAM_SECRET)
    : undefined;
  const standing = orders();

  mates?.onTell((payload) => {
    const policy = policyOf((payload as { policy?: unknown })?.policy);
    if (policy !== undefined) standing.issue(policy);
  });
  // A rule the teammate set fires here as well, without waiting for its word.
  game.onMessage(({ payload }) => {
    if (typeof payload !== "string") return;
    const next = react(standing.policy(), payload);
    if (next !== undefined) standing.issue(next);
  });

  await executive(game, world, believe(world), mates, standing);
});
