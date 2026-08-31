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

  const here = (): Position => beliefs.me();

  const { walk, explore } = walker({
    here,
    move: async (direction) => {
      const landed = await game.move(direction);
      const me = game.me();
      if (me) beliefs.moved(me);
      return landed;
    },
    pace: () =>
      new Promise((resolve) =>
        setTimeout(resolve, world.config.GAME.player.movement_duration),
      ),
  });

  while (true) {
    const at = here();
    const now = Date.now();
    const known = beliefs.parcels();
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
        const taken = await game.pickup();
        beliefs.took(taken);
        log.info({ taken }, "picked up");
      } else {
        const delivered = await game.putdown();
        beliefs.gave();
        log.info({ delivered }, "delivered");
      }
    }
    if (abandoned) for (let leg = 0; leg < RETREAT; leg++) await explore(board);
  }
});
