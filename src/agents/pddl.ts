import { run } from "../agent.js";
import { believe } from "../beliefs.js";
import { env } from "../env.js";
import { grid } from "../grid.js";
import { log } from "../log.js";
import { planning } from "../pddl/planner.js";
import { fastDownward } from "../pddl/solver.js";
import { key } from "../position.js";
import type { Position } from "../sdk.js";
import { walker } from "../walk.js";

const CANDIDATES = 6;
const RETREAT = 3;
const DROPOUT = 30_000;

await run(async (game, world) => {
  const beliefs = believe(world);
  let tiles = world.tiles;
  let board = grid(tiles);
  game.onSensing((sensing) => beliefs.seen(sensing));
  game.onTile((tile) => {
    tiles = [
      ...tiles.filter((t) => key(t.x, t.y) !== key(tile.x, tile.y)),
      tile,
    ];
    board = grid(tiles);
    beliefs.changed(tile);
  });

  const planner = planning(fastDownward(env.DOWNWARD));
  const mine = world.me.id;
  const unreachable = new Map<string, number>();
  const handed = new Set<string>();

  const here = (): Position => {
    const me = game.me() ?? world.me;
    return { x: me.x ?? 0, y: me.y ?? 0 };
  };

  const { walk, explore } = walker({
    here,
    move: (direction) => game.move(direction),
    pace: () =>
      new Promise((resolve) =>
        setTimeout(resolve, world.config.GAME.player.movement_duration),
      ),
  });

  while (true) {
    const at = here();
    const now = Date.now();
    const sensed = beliefs.parcels();
    for (const id of handed)
      if (!sensed.some((p) => p.id === id)) handed.delete(id);
    const known = sensed.filter((p) => !handed.has(p.id));
    const nearest = known
      .filter(
        (p) => !p.carriedBy && (unreachable.get(p.id) ?? 0) < now - DROPOUT,
      )
      .map((parcel) => ({ parcel, steps: board.route(parcel).distance(at) }))
      .filter(({ steps }) => Number.isFinite(steps))
      .sort((a, b) => a.steps - b.steps)
      .slice(0, CANDIDATES)
      .map(({ parcel }) => parcel);
    const carrying = known.filter((p) => p.carriedBy === mine);
    const candidates = [...carrying, ...nearest];

    const tour =
      candidates.length > 0
        ? await planner.plan(at, candidates, board)
        : undefined;
    if (tour === undefined) {
      await explore(board);
      continue;
    }

    log.info(
      {
        stops: tour.length,
        picking: nearest.length,
        carrying: carrying.length,
      },
      "tour",
    );

    let abandoned = false;
    for (const stop of tour) {
      const gone =
        stop.action === "pickup" &&
        !beliefs.parcels().some((p) => p.id === stop.parcel);
      if (gone || !(await walk(stop.at, board))) {
        if (stop.action === "pickup") unreachable.set(stop.parcel, Date.now());
        abandoned = true;
        break;
      }

      if (stop.action === "pickup") {
        log.info({ taken: await game.pickup() }, "picked up");
      } else {
        const delivered = await game.putdown();
        log.info({ delivered }, "delivered");
        if (delivered !== undefined && delivered.length > 0)
          for (const p of beliefs.parcels())
            if (p.carriedBy === mine) handed.add(p.id);
      }
    }
    if (abandoned) for (let leg = 0; leg < RETREAT; leg++) await explore(board);
  }
});
