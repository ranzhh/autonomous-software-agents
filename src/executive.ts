import type { Beliefs } from "./beliefs.js";
import {
  type Batch,
  choose,
  conceded,
  FRESH,
  type Mates,
  supersedes,
  type Terms,
} from "./choose.js";
import { env } from "./env.js";
import { type Field, fielding } from "./field.js";
import { type Grid, grid } from "./grid.js";
import { log } from "./log.js";
import { mover } from "./move.js";
import { planning } from "./pddl/planner.js";
import { fastDownward } from "./pddl/solver.js";
import {
  centre,
  constrain,
  type Exchange,
  type Goal,
  handing,
  type Orders,
  rendezvous,
  within,
} from "./policy.js";
import { key, MOVES, sameTile } from "./position.js";
import type { Connection, Direction, Position, World } from "./sdk.js";
import { type Share, sharing, type Told } from "./share.js";
import type { Team } from "./team.js";
import {
  destination,
  place,
  pricedTour,
  type Stop,
  type Tour,
  touring,
} from "./tour.js";
import { value } from "./value.js";

/** The control loop both agents run: sense, revise, commit, walk, under standing orders. */
export async function executive(
  game: Connection,
  world: World,
  beliefs: Beliefs,
  team: Team | undefined,
  orders: Orders,
  field: Field = fielding(beliefs, world.config, world.me.id),
): Promise<void> {
  let tiles = world.tiles;
  let occupied: string | undefined;
  let clear: Grid | undefined;
  const rebuild = (): Grid => {
    const policy = orders.policy();
    occupied = undefined;
    return grid(constrain(tiles, policy), policy.avoid);
  };
  let board = rebuild();
  const mine = world.me.id;
  let stale = true;
  let ordered = false;
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
    board = rebuild();
    beliefs.changed(tile);
    stale = true;
  });
  orders.onIssue((policy) => {
    board = rebuild();
    ordered = true;
    stale = true;
    log.info({ policy }, "ordered");
  });

  const move = mover(
    game,
    beliefs,
    () => board,
    world.config.GAME.player.movement_duration,
  );
  const settle = (): Promise<unknown> =>
    new Promise((resolve) => setTimeout(resolve, 4 * world.config.CLOCK));
  const optimal = planning(fastDownward(env.DOWNWARD));
  const worth = value(world.config);

  let generation = 0;
  let tour: Tour | undefined;
  // What the teammate left for this agent to deliver, as opposed to what it picked up itself.
  const handed = new Set<string>();

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

  const mateAt = (): Position | undefined => {
    const mate = team?.mate();
    return mate && beliefs.agents().find((a) => a.id === mate.id);
  };

  function teammate(): Mates | undefined {
    const mate = team?.mate();
    if (mate === undefined || share === undefined) return undefined;
    return { id: mate.id, at: mateAt(), claimed: share.claimed() };
  }

  function exchange(): Exchange | undefined {
    const mate = team?.mate();
    return orders.policy().handoff && mate
      ? rendezvous(board, mine, mate.id)
      : undefined;
  }

  const terms = (): Terms => ({
    batch: orders.policy().batch ?? 1,
    leave: exchange()?.mine,
  });

  function visiting(goal: Goal): (from: Position) => Stop | undefined {
    // Two agents told to meet head for the middle, or the first one in blocks the door.
    const route = board.route(
      ...(goal.together ? [centre(goal.tiles)] : goal.tiles),
    );
    return (from) => {
      const at = destination(route, from);
      return (
        at && {
          action: "visit",
          at,
          bonus: goal.bonus,
          together: goal.together,
        }
      );
    };
  }

  function shaped(walk: Tour, price: (walk: Tour) => number): Tour {
    let out = walk;
    for (const goal of orders.pending())
      if (goal.kind === "visit")
        out = place(beliefs.me(), out, visiting(goal), price);
    return out;
  }

  function commit(batch: Batch): void {
    generation++;
    const epoch = generation;
    const at = beliefs.me();
    const carrying = beliefs.carrying();
    const candidates = [...carrying, ...batch.parcels];
    const price = (walk: Tour): number =>
      pricedTour(at, walk, carrying, batch.parcels, board, worth);

    const drop = orders.pending().find((g) => g.kind === "deliver");
    const swap = exchange();
    const ends = drop ? drop.tiles : swap ? [swap.mine] : board.deliveries;
    const enough = candidates.length >= terms().batch;
    const planned =
      candidates.length > 0 && enough
        ? touring(at, batch.parcels, board, ends, drop?.bonus)
        : [];
    // Own pickups are left at the exchange; what the teammate left there goes on to a delivery.
    const home =
      swap && destination(board.route(...board.deliveries), swap.mine);
    if (planned && home) planned.push({ action: "deliver", at: home });
    const walk = shaped(planned ?? [], price);
    tour = walk.length > 0 ? walk : undefined;
    if (tour === undefined || candidates.length === 0) return;
    const toBeat = price(tour);
    // Fast Downward minimises steps, not reward, so a shorter tour can be worth less;
    // and it banks on the delivery tiles it is given, so it competes only when those are the ends.
    if (ends !== board.deliveries) return;
    optimal
      .plan(at, candidates, board)
      .then((better) => {
        if (better === undefined || generation !== epoch) return;
        const improved = shaped(better, price);
        if (price(improved) > toBeat) tour = improved;
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
    const batch = choose(
      beliefs,
      board,
      world.config,
      Date.now(),
      teammate(),
      terms(),
    );
    const held = remaining();
    const cause = ordered ? "ordered" : supersedes(batch, held, lost());
    ordered = false;
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
      const policy = orders.policy();
      clear = grid(constrain(tiles, policy), [...policy.avoid, ...on]);
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

    const policy = orders.policy();
    if (policy.hold) {
      await move.pace();
      continue;
    }

    const at = beliefs.me();
    const swap = exchange();
    const loose = beliefs.parcels().filter((p) => !p.carriedBy);
    const underfoot = loose.filter((p) => sameTile(p, at));
    if (
      underfoot.length > 0 &&
      !(swap !== undefined && sameTile(at, swap.mine))
    ) {
      const taken = await game.pickup();
      beliefs.took(taken);
      if (swap !== undefined && sameTile(at, swap.theirs))
        for (const p of underfoot) handed.add(p.id);
      stale = true;
      log.info({ taken }, "picked up");
      continue;
    }

    const stop = tour?.[0];
    if (stop === undefined) {
      await explore();
      continue;
    }

    if (stop.action === "visit") {
      const goal = orders
        .pending()
        .find((g) => g.kind === "visit" && within(stop.at, g.tiles));
      // Any tile of the set counts, so being walled off from the chosen one costs nothing.
      const inside = goal ? within(at, goal.tiles) : sameTile(at, stop.at);
      const mate = mateAt();
      const joined =
        !stop.together || (mate && goal && within(mate, goal.tiles));
      if (inside && joined) {
        if (goal) orders.done(goal);
        log.info({ x: at.x, y: at.y, bonus: stop.bonus }, "reached");
        advance();
        continue;
      }
      // Waiting happens at the middle, not on the first tile in, which is the door.
      if (sameTile(at, stop.at)) {
        await move.pace();
        continue;
      }
    } else if (sameTile(at, stop.at)) {
      if (stop.action === "pickup") {
        advance();
        continue;
      }
      const carrying = beliefs.carrying();
      const hand = handing(
        swap === undefined
          ? carrying
          : sameTile(at, swap.mine)
            ? carrying.filter((p) => !handed.has(p.id))
            : carrying.filter((p) => handed.has(p.id)),
        policy,
      );
      if (hand === "wait") {
        await move.pace();
        continue;
      }
      if (hand !== "leave") {
        // Before the await, so a plan landing mid-putdown is discarded, not walked.
        generation++;
        // The graders match a delivery to the tile they last saw the parcels on, and a
        // frame runs up to three clock ticks late (measured): let one show them here.
        await settle();
        const dropping = beliefs
          .carrying()
          .filter((p) => hand.drop.includes(p.id));
        const delivered = await game.putdown(hand.drop);
        beliefs.gave(hand.drop);
        if (beliefs.tileAt(at.x, at.y)?.type === "2") {
          field.banked(dropping.map((p) => ({ id: p.id, reward: p.reward })));
          share?.bank(hand.drop);
        }
        for (const id of hand.drop) handed.delete(id);
        log.info({ delivered, kept: beliefs.carrying().length }, "delivered");
        const goal = orders
          .pending()
          .find((g) => g.kind === "deliver" && within(at, g.tiles));
        if (goal) orders.done(goal);
        if (hand.more) continue;
      }
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
