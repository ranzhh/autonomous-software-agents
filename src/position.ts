import type { Direction, Position } from "./sdk.js";

// Coordinates are fractional mid-move, carried parcels included; round to the tile.
export const key = (x: number, y: number): string =>
  `${Math.round(x)},${Math.round(y)}`;

export const sameTile = (a: Position, b: Position): boolean =>
  key(a.x, a.y) === key(b.x, b.y);

export const MOVES: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: 1 },
  down: { dx: 0, dy: -1 },
  right: { dx: 1, dy: 0 },
  left: { dx: -1, dy: 0 },
};
