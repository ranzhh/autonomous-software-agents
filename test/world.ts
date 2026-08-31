import { type Beliefs, believe, type ParcelBelief } from "../src/beliefs.js";
import { type Grid, grid } from "../src/grid.js";
import type {
  IOAgent,
  IOConfig,
  IOParcel,
  IOTile,
  Position,
} from "../src/sdk.js";

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

// One reward point per step, so every worth below is a round number.
export const config = {
  CLOCK: 50,
  GAME: {
    parcels: {
      decaying_event: "1s",
      generation_event: "1s",
      reward_avg: 30,
      max: 25,
    },
    player: { movement_duration: 1_000 },
  },
} as unknown as IOConfig;

export const me = (x: number, y: number): IOAgent => ({
  id: "me",
  name: "tester",
  teamId: "t",
  teamName: "team",
  score: 0,
  penalty: 0,
  x,
  y,
});

export function setup(
  rows: string[],
  at: Position,
  parcels: Partial<IOParcel>[] = [],
  rivals: Partial<IOAgent>[] = [],
): { beliefs: Beliefs; board: Grid } {
  const tiles = tilesOf(rows);
  const beliefs = believe({ me: me(at.x, at.y), tiles, config });
  beliefs.seen(
    {
      positions: [],
      agents: rivals.map((rival, i) => ({
        ...me(0, 0),
        id: `r${i}`,
        ...rival,
      })),
      crates: [],
      parcels: parcels.map((p, i) => ({
        id: `p${i}`,
        x: 0,
        y: 0,
        reward: 30,
        ...p,
      })),
    },
    0,
  );
  return { beliefs, board: grid(tiles) };
}
