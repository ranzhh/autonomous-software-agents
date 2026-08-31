import type { ParcelBelief } from "../src/beliefs.js";
import type { IOTile } from "../src/sdk.js";

// The first row is the top of the map: y counts upward, like the game.
export const tilesOf = (rows: string[]): IOTile[] =>
  rows.flatMap((row, r) =>
    [...row].map((type, x) => ({
      x,
      y: rows.length - 1 - r,
      type: type as IOTile["type"],
    })),
  );

export const parcelOf = (id: string, x: number, y = 0): ParcelBelief => ({
  id,
  x,
  y,
  reward: 30,
  seenAt: 0,
});
