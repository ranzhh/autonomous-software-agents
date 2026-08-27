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
