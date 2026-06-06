import { DjsConnect } from "@unitn-asa/deliveroo-js-sdk";

const socket = DjsConnect();

let myPosition = { x: 0, y: 0 };

socket.on("you", (me) => {
  // x/y are optional on IOAgent (e.g. before spawn) — only track when present
  if (me.x !== undefined && me.y !== undefined) {
    myPosition = { x: me.x, y: me.y };
    console.log(`I am at (${myPosition.x}, ${myPosition.y})`);
  }
});

socket.on("map", async (_width, _height, _tiles) => {
  // Move along predefined path
  const path = [
    "right",
    "right",
    "down",
    "down",
    "left",
    "left",
    "up",
    "up",
  ] as const;

  for (const direction of path) {
    const result = await socket.emitMove(direction);
    if (!result) {
      console.log(`Move ${direction} failed, retrying...`);
      await new Promise((r) => setTimeout(r, 100));
      // Retry logic here
    }
  }

  // Pickup parcels
  await socket.emitPickup();
});
