import { connect, type Direction } from "./sdk.js";

const game = connect();
const { me, tiles } = await game.ready();

console.log(`${me.name} at (${me.x}, ${me.y}) on ${tiles.length} tiles`);

const path: Direction[] = ["right", "right", "down", "down"];

for (const direction of path) {
  const moved = await game.move(direction);
  if (moved === false) {
    console.log(`${direction} refused`);
  } else if (moved === undefined) {
    console.log(`${direction} unacknowledged`);
  }
}

await game.pickup();
game.disconnect();
