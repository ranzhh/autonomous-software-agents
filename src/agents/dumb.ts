import { log } from "../log.js";
import { connect, DIRECTIONS, type Direction } from "../sdk.js";

const game = connect();
const { me, config } = await game.ready();
log.info({ agent: me.name, x: me.x, y: me.y }, "spawned");

game.onLost(() => process.exit(1));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    log.info({ signal }, "disconnecting");
    game.disconnect();
    process.exit(0);
  });
}

const pace = config.GAME.player.movement_duration;

while (true) {
  const index = Math.floor(Math.random() * DIRECTIONS.length);
  await game.move(DIRECTIONS[index] as Direction);
  await new Promise((resolve) => setTimeout(resolve, pace));
}
