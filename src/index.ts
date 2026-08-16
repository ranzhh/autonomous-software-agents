import { connect, type Direction, ready } from "./sdk.js";

const socket = connect();
const { me, tiles } = await ready(socket);

console.log(`${me.name} at (${me.x}, ${me.y}) on ${tiles.length} tiles`);

const path: Direction[] = ["right", "right", "down", "down"];

for (const direction of path) {
  const moved = await socket.emitMove(direction);
  if (!moved) {
    console.log(`${direction} blocked`);
  }
}

await socket.emitPickup();
