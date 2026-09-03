import { MOVES } from "./position.js";
import type { Direction, IOTile, Position } from "./sdk.js";

export interface Route {
  /** Steps from `from` to the nearest target; Infinity when unreachable. */
  distance(from: Position): number;
  /** The move to make now; undefined on a target or off the route. */
  step(from: Position): Direction | undefined;
}

export interface Grid {
  walkable(p: Position): boolean;
  /** Every tile that can be stood on. */
  tiles: Position[];
  /** The steps the server allows out of `at`, and where each lands. */
  exits(at: Position): [Direction, Position][];
  deliveries: Position[];
  spawners: Position[];
  /** One breadth-first search toward the nearest of the targets. */
  route(...targets: Position[]): Route;
}

// An arrow refuses only the step entering it against itself (Tile.js:90).
const AGAINST: Partial<Record<IOTile["type"], Direction>> = {
  "↑": "down",
  "↓": "up",
  "→": "left",
  "←": "right",
};

const WALL = 0;
const OPEN = 1;
const NOWHERE = -1;

const MEMO = 128;

const STEPS = Object.entries(MOVES) as [
  Direction,
  { dx: number; dy: number },
][];
const DX = Int8Array.from(STEPS, ([, move]) => move.dx);
const DY = Int8Array.from(STEPS, ([, move]) => move.dy);

type Cells = Int32Array | Int8Array | Uint8Array;

const read = (cells: Cells, at: number): number => cells[at] as number;

export function grid(tiles: IOTile[]): Grid {
  let width = 0;
  let height = 0;
  for (const tile of tiles) {
    width = Math.max(width, Math.round(tile.x) + 1);
    height = Math.max(height, Math.round(tile.y) + 1);
  }
  const size = width * height;

  const kind = new Uint8Array(size);
  // The direction this tile refuses to be entered from, as an index into STEPS.
  const refuses = new Int8Array(size).fill(NOWHERE);
  const walkables: Position[] = [];
  const deliveries: Position[] = [];
  const spawners: Position[] = [];

  for (const tile of tiles) {
    if (tile.type === "0") continue;
    const x = Math.round(tile.x);
    const y = Math.round(tile.y);
    if (x < 0 || y < 0 || x >= width || y >= height) continue;

    const at = y * width + x;
    const first = read(kind, at) === WALL;
    const against = AGAINST[tile.type];
    refuses[at] =
      against === undefined ? NOWHERE : STEPS.findIndex(([d]) => d === against);
    kind[at] = OPEN;
    if (!first) continue;
    walkables.push({ x, y });
    if (tile.type === "2") deliveries.push({ x, y });
    else if (tile.type === "1") spawners.push({ x, y });
  }

  const index = ({ x, y }: Position): number => {
    const cx = Math.round(x);
    const cy = Math.round(y);
    return cx < 0 || cy < 0 || cx >= width || cy >= height
      ? NOWHERE
      : cy * width + cx;
  };

  const spot = (cell: number): Position => {
    const x = cell % width;
    return { x, y: (cell - x) / width };
  };

  const open = (at: number): boolean =>
    at !== NOWHERE && read(kind, at) !== WALL;

  const exit = (x: number, y: number, d: number): number => {
    const tx = x + read(DX, d);
    const ty = y + read(DY, d);
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return NOWHERE;
    const to = ty * width + tx;
    return read(kind, to) === WALL || read(refuses, to) === d ? NOWHERE : to;
  };

  const eachExit = (visit: (from: number, to: number) => void): void => {
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const from = y * width + x;
        if (read(kind, from) === WALL) continue;
        for (let d = 0; d < STEPS.length; d++) {
          const to = exit(x, y, d);
          if (to !== NOWHERE) visit(from, to);
        }
      }
  };

  // In-edges per tile: one flat array, with a slice per tile.
  const slices = new Int32Array(size + 1);
  eachExit((_, to) => {
    slices[to + 1] = read(slices, to + 1) + 1;
  });
  for (let at = 0; at < size; at++)
    slices[at + 1] = read(slices, at + 1) + read(slices, at);
  const enters = new Int32Array(read(slices, size));
  const filled = Int32Array.from(slices.subarray(0, size));
  eachExit((from, to) => {
    const slot = read(filled, to);
    enters[slot] = from;
    filled[to] = slot + 1;
  });

  // Tile changes build a new grid; nothing rewrites this one in place.
  const fields = new Map<string, Route>();

  function route(...targets: Position[]): Route {
    const seeds = targets
      .map(index)
      .filter(open)
      .sort((a, b) => a - b);
    const at = seeds.join(" ");
    const cached = fields.get(at);
    if (cached) {
      // Re-inserting makes the Map's insertion order a least-recently-used one.
      fields.delete(at);
      fields.set(at, cached);
      return cached;
    }
    const built = build(seeds);
    fields.set(at, built);
    if (fields.size > MEMO) {
      const coldest = fields.keys().next().value;
      if (coldest !== undefined) fields.delete(coldest);
    }
    return built;
  }

  function build(seeds: number[]): Route {
    // Flood backwards along the in-edges to give every tile its distance to a target.
    const steps = new Int32Array(size).fill(NOWHERE);
    const queue = new Int32Array(size);
    let tail = 0;
    for (const seed of seeds)
      if (read(steps, seed) === NOWHERE) {
        steps[seed] = 0;
        queue[tail++] = seed;
      }

    for (let head = 0; head < tail; head++) {
      const at = read(queue, head);
      const next = read(steps, at) + 1;
      const last = read(slices, at + 1);
      for (let e = read(slices, at); e < last; e++) {
        const from = read(enters, e);
        if (read(steps, from) === NOWHERE) {
          steps[from] = next;
          queue[tail++] = from;
        }
      }
    }

    const reached = (at: number): number =>
      at === NOWHERE || read(steps, at) === NOWHERE
        ? Infinity
        : read(steps, at);

    return {
      distance: (from) => reached(index(from)),
      step(from) {
        const at = index(from);
        const here = reached(at);
        if (here === 0 || here === Infinity) return undefined;
        const { x, y } = spot(at);
        for (const [d, [direction]] of STEPS.entries())
          if (reached(exit(x, y, d)) === here - 1) return direction;
        return undefined;
      },
    };
  }

  return {
    walkable: (p) => open(index(p)),
    tiles: walkables,
    exits(at) {
      const from = index(at);
      if (!open(from)) return [];
      const { x, y } = spot(from);
      const out: [Direction, Position][] = [];
      for (const [d, [direction]] of STEPS.entries()) {
        const to = exit(x, y, d);
        if (to !== NOWHERE) out.push([direction, spot(to)]);
      }
      return out;
    },
    deliveries,
    spawners,
    route,
  };
}
