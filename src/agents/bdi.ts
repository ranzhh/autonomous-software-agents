import { run } from "../agent.js";
import { believe } from "../beliefs.js";
import { type Batch, choose, supersedes } from "../choose.js";
import { env } from "../env.js";
import { grid } from "../grid.js";
import { log } from "../log.js";
import { mover } from "../move.js";
import { planning } from "../pddl/planner.js";
import { fastDownward } from "../pddl/solver.js";
import { key, sameTile } from "../position.js";
import { pricedTour, type Tour, touring } from "../tour.js";
import { value } from "../value.js";

const COLDEST = 8;

await run(async (game, world) => {
  const beliefs = believe(world);
  let tiles = world.tiles;
  let board = grid(tiles);
  let stale = true;
  game.onSensing((sensing) => {
    beliefs.seen(sensing);
    stale = true;
  });
  game.onTile((tile) => {
    tiles = [
      ...tiles.filter((t) => key(t.x, t.y) !== key(tile.x, tile.y)),
      tile,
    ];
    board = grid(tiles);
    beliefs.changed(tile);
    stale = true;
  });

  const move = mover(
    game,
    beliefs,
    () => board,
    world.config.GAME.player.movement_duration,
  );
  const optimal = planning(fastDownward(env.DOWNWARD));
  const worth = value(world.config);

  let generation = 0;
  let tour: Tour | undefined;

  function commit(batch: Batch): void {
    generation++;
    const mine = generation;
    const at = beliefs.me();
    const carrying = beliefs.carrying();
    const candidates = [...carrying, ...batch.parcels];
    if (candidates.length === 0) {
      tour = undefined;
      return;
    }
    const price = (walk: Tour): number =>
      pricedTour(at, walk, carrying, batch.parcels, board, worth);

    tour = touring(at, batch.parcels, board);
    const toBeat = tour ? price(tour) : 0;
    // Fast Downward minimises steps, not reward, so a shorter tour can be worth less.
    optimal
      .plan(at, candidates, board)
      .then((better) => {
        if (better && generation === mine && price(better) > toBeat)
          tour = better;
      })
      .catch(() => {});
  }

  function remaining(): number | undefined {
    if (tour === undefined || tour.length === 0) return undefined;
    return pricedTour(
      beliefs.me(),
      tour,
      beliefs.carrying(),
      beliefs.parcels().filter((p) => !p.carriedBy),
      board,
      worth,
    );
  }

  function lost(): boolean {
    if (tour === undefined) return false;
    const mine = beliefs.me().id;
    const known = beliefs.parcels();
    return tour.some((stop) => {
      if (stop.action !== "pickup") return false;
      const still = known.find((p) => p.id === stop.parcel);
      return (
        still === undefined || (!!still.carriedBy && still.carriedBy !== mine)
      );
    });
  }

  function reconsider(): void {
    const batch = choose(beliefs, board, world.config);
    const held = remaining();
    const cause = supersedes(batch, held, lost());
    if (cause === undefined) return;
    log.info(
      { was: held, now: batch.worth, parcels: batch.parcels.length, cause },
      "commits",
    );
    commit(batch);
  }

  async function explore(): Promise<void> {
    const at = beliefs.me();
    const unseen = board.spawners.filter(
      (s) => beliefs.observedAt(s.x, s.y) === Number.NEGATIVE_INFINITY,
    );
    const cold =
      unseen.length > 0
        ? unseen
        : [...board.spawners]
            .sort(
              (a, b) =>
                beliefs.observedAt(a.x, a.y) - beliefs.observedAt(b.x, b.y),
            )
            .slice(0, COLDEST);
    const next = board.route(...cold).step(at);
    if (next !== undefined && (await move.step(next))) return;
    const around = move.open(at);
    const drift = around[Math.floor(Math.random() * around.length)];
    if (drift === undefined || !(await move.step(drift[0]))) await move.pace();
  }

  while (true) {
    if (stale) {
      stale = false;
      reconsider();
    }

    const at = beliefs.me();
    const loose = beliefs.parcels().filter((p) => !p.carriedBy);
    if (loose.some((p) => sameTile(p, at))) {
      const taken = await game.pickup();
      beliefs.took(taken);
      stale = true;
      log.info({ taken }, "picked up");
      continue;
    }

    const stop = tour?.[0];
    if (stop === undefined) {
      await explore();
      continue;
    }

    if (sameTile(at, stop.at)) {
      // Before the await, so a plan landing mid-putdown is discarded, not walked.
      generation++;
      tour = tour?.slice(1);
      if (stop.action === "deliver") {
        const delivered = await game.putdown();
        beliefs.gave();
        log.info({ delivered }, "delivered");
      }
      stale = true;
      continue;
    }

    const route = board.route(stop.at);
    const next = route.step(at);
    if (next === undefined) {
      generation++;
      tour = undefined;
      stale = true;
      await move.pace();
      continue;
    }
    if (!(await move.step(next)) && !(await move.sidestep(next, route)))
      await move.pace();
  }
});
