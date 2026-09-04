import { run } from "../agent.js";
import { believe } from "../beliefs.js";
import { env } from "../env.js";
import { executive } from "../executive.js";
import { orders, Policy, react } from "../policy.js";
import { fields } from "../sdk.js";
import { team } from "../team.js";

await run(async (game, world) => {
  const beliefs = believe(world);
  const standing = orders();
  const mates = env.TEAM_SECRET
    ? team(game, world.me.id, env.TEAM_SECRET)
    : undefined;

  mates?.onTell((payload) => {
    const told = Policy.safeParse(fields(payload)?.policy);
    if (told.success) standing.issue(told.data);
  });
  // A rule the teammate set fires here as well, without waiting for its word.
  game.onMessage(({ from, payload }) => {
    if (typeof payload !== "string") return;
    if (beliefs.agents().some((a) => a.id === from.id)) return;
    const next = react(standing.policy(), payload);
    if (next !== undefined) standing.issue(next);
  });

  await executive(game, world, beliefs, standing, mates);
});
