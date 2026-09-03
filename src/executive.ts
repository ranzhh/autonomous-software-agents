import type { Beliefs } from "./beliefs.js";
import {
  type Batch,
  choose,
  conceded,
  FRESH,
  type Mates,
  supersedes,
} from "./choose.js";
import { env } from "./env.js";
import { type Field, fielding } from "./field.js";
import { type Grid, grid } from "./grid.js";
import { log } from "./log.js";
import { mover } from "./move.js";
import { planning } from "./pddl/planner.js";
import { fastDownward } from "./pddl/solver.js";
import { key, MOVES, sameTile } from "./position.js";
import type { Connection, Direction, Position, World } from "./sdk.js";
import { type Share, sharing, type Told } from "./share.js";
import type { Team } from "./team.js";
import { pricedTour, type Tour, touring } from "./tour.js";
import { value } from "./value.js";

/** The control loop of the bdi agent: sense, revise, commit, walk. */
export async function executive(
  game: Connection,
  world: World,
  beliefs: Beliefs,
  team: Team | undefined,
  field: Field = fielding(beliefs, world.config, world.me.id),
): Promise<void> {
  let tiles = world.tiles;
  let board = grid(tiles);
  let occupied: string | undefined;
  let clear: Grid | undefined;
  const mine = world.me.id;
  let stale = true;
  let share: Share | undefined;

  game.onSensing((sensing) => {
    const now = Date.now();
    const gone = beliefs.seen(sensing, now);
    const mate = team?.mate();
    field.saw(
      board,
      mine,
      sensing.positions,
      sensing.parcels,
      sensing.agents.flatMap((a) =>
        a.id === mate?.id || a.x === undefined || a.y === undefined
          ? []
          : [{ id: a.id, x: a.x, y: a.y }],
      ),
      now,
    );
    share?.post(sensing, gone, now);
    stale = true;
  });
  game.onTile((tile) => {
    tiles = [
      ...tiles.filter((t) => key(t.x, t.y) !== key(tile.x, tile.y)),
      tile,
    ];
    board = grid(tiles);
    occupied = undefined;
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
  let scouting: Position | undefined;

  const told = (): Told => ({
    taken:
      tour?.flatMap((stop) =>
        stop.action === "pickup" ? [stop.parcel] : [],
      ) ?? [],
    stops: tour?.map((stop) => stop.at) ?? [],
    going: tour === undefined ? scouting : undefined,
  });

  share =
    team &&
    sharing(team, beliefs, told, ({ from, sighted, others, banked }) => {
      field.saw(
        board,
        from.id,
        beliefs.viewFrom(from.x, from.y),
        sighted,
        others.filter((a) => a.id !== mine),
        from.seenAt,
      );
      const known = beliefs.parcels(from.seenAt);
      field.banked(
        banked.flatMap((id) => {
          const p = known.find((k) => k.id === id);
          return p ? [{ id, reward: p.reward }] : [];
        }),
      );
    });

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

  function teammate(): Mates | undefined {
    const mate = team?.mate();
    if (mate === undefined || share === undefined) return undefined;
    const at = beliefs.agents().find((a) => a.id === mate.id);
    return { id: mate.id, at, claimed: share.claimed() };
  }

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
    const mate = teammate();
    const at = beliefs.me();
    return tour.some((stop) => {
      if (stop.action !== "pickup") return false;
      const still = known.find((p) => p.id === stop.parcel);
      if (still === undefined) return true;
      if (still.carriedBy && still.carriedBy !== mine) return true;
      if (mate === undefined || !mate.claimed.has(stop.parcel)) return false;
      return conceded(still, at, mine, mate, board);
    });
  }

  function reconsider(): void {
    const batch = choose(beliefs, board, world.config, Date.now(), teammate());
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
    const mate = team?.mate();
    const { chosen } = field.assess(
      board,
      beliefs.agents(),
      mate && { id: mate.id, intent: share?.intent() },
      Date.now(),
      true,
    );
    scouting = chosen && { x: chosen.x, y: chosen.y };
    const next = scouting && board.route(scouting).step(at);
    if (next !== undefined && (await stepping(next))) return;
    const around = move.open(at);
    const drift = around[Math.floor(Math.random() * around.length)];
    if (drift === undefined || !(await stepping(drift[0]))) await move.pace();
  }

  // Agents are not walls, so a route walks straight through one. This is the same board
  // with whoever is standing on it walled off, rebuilt only when one of them moves.
  function unblocked(): Grid {
    // A teammate's sighting outlives our own, which is retired the moment we look;
    // walling a tile on a stale one would shut a corridor nobody is in.
    const now = Date.now();
    const on = beliefs
      .agents()
      .filter((a) => now - a.seenAt < FRESH)
      .map((a) => ({ x: Math.round(a.x), y: Math.round(a.y) }));
    const at = on
      .map((p) => key(p.x, p.y))
      .sort()
      .join(" ");
    if (clear === undefined || at !== occupied) {
      occupied = at;
      clear = grid(tiles, on);
    }
    return clear;
  }

  // Only a standoff with our own agent is one both sides can end, and only the higher id
  // ends it; giving way to a rival buys a refusal and no ground.
  function yields(at: Position, to: Direction): boolean {
    const mate = team?.mate();
    if (mate === undefined || mine < mate.id) return false;
    const ahead = { x: at.x + MOVES[to].dx, y: at.y + MOVES[to].dy };
    return beliefs.agents().some((a) => a.id === mate.id && sameTile(a, ahead));
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
      share?.bank(dropping.map((p) => p.id));
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
    const past = unblocked().route(stop.at).step(at);
    if (past !== undefined && past !== next && (await stepping(past))) continue;
    if (!(await move.sidestep(next, route, yields(at, next))))
      await move.pace();
  }
}
