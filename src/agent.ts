import { log } from "./log.js";
import { type Connection, connect, type World } from "./sdk.js";

export type AgentRuntime = (game: Connection, world: World) => Promise<void>;

/**
 * Everything around an agent that every agent shares: connect, await the world,
 * die on a lost connection or a signal, log the score as it changes (the
 * benchmark reads it).
 */
export async function run(
  agent: AgentRuntime,
  game: Connection = connect(),
): Promise<void> {
  const world = await game.ready();
  log.info({ agent: world.me.name, x: world.me.x, y: world.me.y }, "spawned");

  game.onLost(() => {
    log.error("connection lost");
    process.exit(1);
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      log.info({ signal }, "disconnecting");
      game.disconnect();
      process.exit(0);
    });
  }

  let score = world.me.score;
  log.info({ score }, "score");
  setInterval(() => {
    const current = game.me()?.score;
    if (current === undefined || current === score) return;
    score = current;
    log.info({ score }, "score");
  }, 1_000).unref();

  await agent(game, world);
}
