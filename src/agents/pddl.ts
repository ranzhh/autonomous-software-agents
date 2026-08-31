import { run } from "../agent.js";
import { believe } from "../beliefs.js";
import { env } from "../env.js";
import { grid } from "../grid.js";
import { log } from "../log.js";
import { mover } from "../move.js";
import { planning } from "../pddl/planner.js";
import { fastDownward } from "../pddl/solver.js";
import { key, sameTile } from "../position.js";
import type { Position } from "../sdk.js";
import { destination } from "../tour.js";

const CANDIDATES = 6;
const REFUSALS = 3;
const RETREAT = 3;
const STALE = 30_000;
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
  const visited = new Map<string, number>();
  const unreachable = new Map<string, number>();

  const move = mover(
    game,
    beliefs,
    () => board,
    world.config.GAME.player.movement_duration,
  );

  async function walk(to: Position): Promise<boolean> {
    const route = board.route(to);
    let refused = 0;
    while (!sameTile(beliefs.me(), to)) {
      const next = route.step(beliefs.me());
      if (next === undefined) return false;
      if (await move.step(next)) continue;
      if (++refused > REFUSALS) return false;
      if (!(await move.sidestep(next, route))) {
        await move.pace();
        refused++;
      }
    }
    return true;
  }

  async function explore(): Promise<void> {
    const at = beliefs.me();
    const now = Date.now();
    visited.set(key(at.x, at.y), now);
    const stale = board.spawners.filter(
      (s) => (visited.get(key(s.x, s.y)) ?? 0) < now - STALE,
    );

    const route = board.route(...stale);
    const next = route.step(at);
    if (next !== undefined) {
      if (await move.step(next)) return;
      const target = destination(route, at);
      if (target) visited.set(key(target.x, target.y), now);
    }

    const open = move.open(at);
    const aside = open[Math.floor(Math.random() * open.length)];
    if (aside === undefined || !(await move.step(aside[0]))) await move.pace();
  }

  while (true) {
    const at = beliefs.me();
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
      await explore();
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
      if (gone || !(await walk(stop.at))) {
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
    if (abandoned) for (let leg = 0; leg < RETREAT; leg++) await explore();
  }
});
