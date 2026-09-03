import type { Beliefs } from "./beliefs.js";
import { type Batch, choose, supersedes } from "./choose.js";
import { env } from "./env.js";
import { type Field, fielding } from "./field.js";
import { grid } from "./grid.js";
import { log } from "./log.js";
import { mover } from "./move.js";
import { planning } from "./pddl/planner.js";
import { fastDownward } from "./pddl/solver.js";
import { key, MOVES, sameTile } from "./position.js";
import type { Connection, Direction, World } from "./sdk.js";
import { pricedTour, type Tour, touring } from "./tour.js";
import { value } from "./value.js";

/** The control loop of the bdi agent: sense, revise, commit, walk. */
export async function executive(
  game: Connection,
  world: World,
  beliefs: Beliefs,
  field: Field = fielding(beliefs, world.config, world.me.id),
): Promise<void> {
  let tiles = world.tiles;
  let board = grid(tiles);
  const mine = world.me.id;
  let stale = true;
  game.onSensing((sensing) => {
    const now = Date.now();
    beliefs.seen(sensing, now);
    field.saw(
      board,
      mine,
      sensing.positions,
      sensing.parcels,
      sensing.agents.flatMap((a) =>
        a.x === undefined || a.y === undefined
          ? []
          : [{ id: a.id, x: a.x, y: a.y }],
      ),
      now,
    );
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

  const stepping = async (direction: Direction): Promise<boolean> => {
    const from = beliefs.me();
    const to = {
      x: from.x + MOVES[direction].dx,
      y: from.y + MOVES[direction].dy,
    };
    const landed = await move.step(direction);
    field.stepped(to, landed);
    return landed;
  };

  function commit(batch: Batch): void {
    generation++;
    const epoch = generation;
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
        if (better && generation === epoch && price(better) > toBeat)
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
    const { chosen } = field.assess(
      board,
      beliefs.agents(),
      undefined,
      Date.now(),
      true,
    );
    const next = chosen && board.route(chosen).step(at);
    if (next !== undefined && (await stepping(next))) return;
    const around = move.open(at);
    const drift = around[Math.floor(Math.random() * around.length)];
    if (drift === undefined || !(await stepping(drift[0]))) await move.pace();
  }

  function advance(): void {
    generation++;
    tour = tour?.slice(1);
    stale = true;
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
      if (stop.action === "pickup") {
        advance();
        continue;
      }
      // Before the await, so a plan landing mid-putdown is discarded, not walked.
      generation++;
      const dropping = beliefs.carrying();
      const delivered = await game.putdown();
      beliefs.gave();
      field.banked(dropping.map((p) => ({ id: p.id, reward: p.reward })));
      log.info({ delivered }, "delivered");
      advance();
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
    if (await stepping(next)) continue;
    if (!(await move.sidestep(next, route))) await move.pace();
  }
}
