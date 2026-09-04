import { run } from "../agent.js";
import { believe } from "../beliefs.js";
import { env } from "../env.js";
import { executive } from "../executive.js";
import { grid } from "../grid.js";
import { openaiChat } from "../llm.js";
import { missions, type View } from "../mission.js";
import { orders } from "../policy.js";
import { team } from "../team.js";

const REPEAT_MS = 5_000;

await run(async (game, world) => {
  if (env.LLM_URL === undefined) throw new Error("LLM_URL is not set");
  const chat = openaiChat(env.LLM_URL, env.LLM_MODEL, env.LLM_KEY);
  const beliefs = believe(world);
  const standing = orders();
  const mates = env.TEAM_SECRET
    ? team(game, world.me.id, env.TEAM_SECRET)
    : undefined;

  const board = grid(world.tiles);
  const width = 1 + Math.max(0, ...board.walkables.map((t) => t.x));
  const height = 1 + Math.max(0, ...board.walkables.map((t) => t.y));
  const view = (): View => {
    const carrying = beliefs.carrying();
    const mate = mates?.mate();
    return {
      carrying: carrying.length,
      worth: carrying.reduce((sum, p) => sum + p.reward, 0),
      score: game.me()?.score ?? 0,
      mate: mate && beliefs.agents().find((a) => a.id === mate.id),
      deliveries: board.deliveries,
      reward: world.config.GAME.parcels.reward_avg,
      width,
      height,
    };
  };
  // The game master has no position, so anyone ever seen on the map is not it.
  const player = (id: string): boolean =>
    beliefs.agents().some((a) => a.id === id);
  const hear = missions(
    chat,
    standing,
    view,
    (to, text) => void game.say(to, text),
    player,
  );
  game.onMessage((message) => void hear(message));

  // The teammate may pair after the orders were issued, so they are repeated.
  const tell = (): void => mates?.tell({ policy: standing.policy() });
  standing.onIssue(tell);
  setInterval(tell, REPEAT_MS).unref();

  await executive(game, world, beliefs, standing, mates);
});
