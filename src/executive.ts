import type { Beliefs } from "./beliefs.js";
import { type Grid, grid } from "./grid.js";
import { log } from "./log.js";
import { type Planned, plan, type Step } from "./pddl.js";
import { deliberate, drift, type Intention, pursue, same } from "./plans.js";
import {
  constrain,
  drop,
  exchange,
  type Goal,
  mark,
  type Orders,
  type Policy,
  pending,
  targets,
  within,
} from "./policy.js";
import { key, MOVES, sameTile } from "./position.js";
import type { Connection, Direction, Position, World } from "./sdk.js";
import { sharing } from "./share.js";
import type { Team } from "./team.js";

type Role = "collector" | "deliverer";

const BLOCK_MS = 1_000;

/**
 * The loop both agents run: sense, revise beliefs, deliberate, act, under
 * the standing orders. Orders shape the board the plans see, filter the
 * parcels worth taking, decide what a putdown lets go of, and put a goal
 * ahead of the parcels until it is reached.
 */
export async function executive(
  game: Connection,
  world: World,
  beliefs: Beliefs,
  orders: Orders,
  team?: Team,
  planner: (
    intention: Intention,
    beliefs: Beliefs,
    grid: Grid,
  ) => Promise<Planned> = plan,
): Promise<void> {
  const mine = world.me.id;
  let tiles = world.tiles;
  let open = grid(tiles);
  let swap = exchange(open);
  let board = open;
  let shape = "";
  let stale = true;
  let intention: Intention = { kind: "explore" };
  let queue: Step[] = [];
  const unplannable = new Set<string>();
  let layout = "";
  const done = new Set<string>();
  const blocked = new Map<string, { tile: Position; until: number }>();
  const wall = (tile: Position): void => {
    blocked.set(key(tile.x, tile.y), { tile, until: Date.now() + BLOCK_MS });
    shape = "";
  };

  const share = team && sharing(team, beliefs);
  team?.onTell(() => {
    stale = true;
  });
  game.onSensing((sensing) => {
    beliefs.seen(sensing);
    share?.post(sensing, intention);
    stale = true;
  });
  game.onTile((tile) => {
    tiles = [
      ...tiles.filter((t) => key(t.x, t.y) !== key(tile.x, tile.y)),
      tile,
    ];
    open = grid(tiles);
    swap = exchange(open);
    shape = "";
    beliefs.changed(tile);
  });
  orders.onIssue((policy) => {
    log.info({ policy }, "ordered");
  });

  const pace = (): Promise<void> =>
    new Promise((resolve) =>
      setTimeout(resolve, world.config.GAME.player.movement_duration),
    );
  const here = (): Position => {
    const me = beliefs.me();
    return { x: me.x ?? 0, y: me.y ?? 0 };
  };
  const mateAt = (): Position | undefined => {
    const mate = team?.mate();
    return mate && beliefs.agents().find((a) => a.id === mate.id);
  };
  const junior = (): boolean => {
    const mate = team?.mate();
    return mate !== undefined && mine < mate.id;
  };

  // Of the two, the one to go for a tile is the nearer, a tie to the lower id.
  // Undefined while the teammate is out of sight.
  const nearer = (target: Position): boolean | undefined => {
    const mate = mateAt();
    if (mate === undefined) return undefined;
    const route = board.route(target);
    const far = route.distance(mate);
    const near = route.distance(here());
    return near < far || (near === far && junior());
  };

  // What the teammate has said it is going for is left to it, unless this
  // agent already holds the same and is the one to go for it.
  const conceded = (
    option: Intention,
    target: Position | undefined,
  ): boolean => {
    const theirs = share?.intent();
    if (target === undefined || theirs === undefined) return false;
    if (!same(theirs, option)) return false;
    if (!same(intention, option)) return true;
    return nearer(target) === false;
  };

  const watching = (spawner: Position): boolean => nearer(spawner) ?? true;

  // Under a hand-off the lower id collects and leaves parcels at the exchange,
  // the other waits on the post beside it and delivers what turns up there.
  const role = (policy: Policy): Role | undefined => {
    if (!policy.handoff || team?.mate() === undefined) return undefined;
    return junior() ? "collector" : "deliverer";
  };

  const walls = (policy: Policy): Position[] => {
    const now = Date.now();
    for (const [at, { until }] of blocked) if (until < now) blocked.delete(at);
    return [...policy.avoid, ...[...blocked.values()].map((b) => b.tile)];
  };

  const sites = (policy: Policy, part: Role | undefined): Position[] => {
    const goal = pending(policy, done).find((g) => g.kind === "deliver");
    if (goal) return goal.tiles;
    if (part === "collector" && swap) return [swap.drop];
    const banned = new Set(policy.noDelivery.map((t) => key(t.x, t.y)));
    return open.deliveries.filter((d) => !banned.has(key(d.x, d.y)));
  };

  let seen: Beliefs = beliefs;
  function reshape(policy: Policy): void {
    const part = role(policy);
    const spots = sites(policy, part);
    const walled = walls(policy);
    const next = JSON.stringify([walled, spots, part]);
    if (next === shape) return;
    shape = next;
    stale = true;
    board = grid(constrain(tiles, { ...policy, avoid: walled }, spots));
    const post = swap;
    const wanted = (p: Position): boolean =>
      part === undefined || post === undefined
        ? true
        : sameTile(p, post.drop) === (part === "deliverer");
    seen = {
      ...beliefs,
      parcels: (now) => beliefs.parcels(now).filter(wanted),
    };
  }

  const ahead = (from: Position, direction: Direction): Position => ({
    x: from.x + MOVES[direction].dx,
    y: from.y + MOVES[direction].dy,
  });
  const crated = (tile: Position): boolean =>
    beliefs.crates().some((c) => sameTile(c, tile));

  /** Whether the step landed where it was asked to. */
  async function walk(direction: Direction): Promise<boolean> {
    const from = here();
    const next = ahead(from, direction);
    const mate = mateAt();
    if (mate !== undefined && sameTile(mate, next)) {
      // Face to face, the lower id steps aside and the other waits for it to.
      wall(next);
      const aside = junior()
        ? board.exits(from).find(([, to]) => !sameTile(to, next))?.[0]
        : undefined;
      if (aside === undefined) await pace();
      else await walk(aside);
      return false;
    }
    const landed = await game.move(direction);
    if (landed !== false) return landed !== undefined;
    wall(next);
    await pace();
    return false;
  }

  async function visit(goal: Goal): Promise<void> {
    const at = here();
    const mate = mateAt();
    if (within(at, goal) && (!goal.together || (mate && within(mate, goal)))) {
      done.add(mark(goal));
      shape = "";
      log.info({ goal }, "reached");
      return;
    }
    const step = board.route(...targets(goal, board)).step(at);
    if (step === undefined) await pace();
    else await walk(step);
  }

  while (true) {
    const me = game.me();
    if (me) beliefs.moved(me);
    const policy = orders.policy();
    if (policy.hold) {
      await pace();
      continue;
    }
    reshape(policy);
    const at = here();
    const crates = beliefs
      .crates()
      .map((c) => key(c.x, c.y))
      .sort()
      .join(" ");
    if (crates !== layout) {
      layout = crates;
      if (unplannable.size > 0) {
        unplannable.clear();
        stale = true;
      }
    }

    // A forbidden tile is a wall on the board; step off it by the real map.
    if (!board.walkable(at)) {
      const off = drift(open, at);
      if (off) await walk(off);
      else await pace();
      continue;
    }

    // A goal out of reach, for now or for good, is left aside rather than walked at.
    const goal = pending(policy, done).find(
      (g) =>
        g.kind === "visit" &&
        board.route(...targets(g, board)).distance(at) < Infinity,
    );
    if (goal) {
      await visit(goal);
      continue;
    }

    if (stale) {
      stale = false;
      const part = role(policy);
      const now = Date.now();
      const next = deliberate(
        seen,
        board,
        world.config,
        intention,
        now,
        (option) =>
          unplannable.has(JSON.stringify(option)) ||
          (option.kind === "home" &&
            drop(beliefs.carrying(), policy) === undefined) ||
          (option.kind === "scout" && part === "deliverer") ||
          (part === undefined &&
            option.kind === "fetch" &&
            conceded(
              option,
              seen.parcels(now).find((p) => p.id === option.id),
            )) ||
          (part === undefined &&
            option.kind === "scout" &&
            conceded(option, option)),
        part === undefined ? watching : undefined,
      );
      if (JSON.stringify(next) !== JSON.stringify(intention)) {
        intention = next;
        queue = [];
        log.info({ intention }, "intends");
      }
    }

    let action =
      intention.kind === "explore" && role(policy) === "deliverer" && swap
        ? board.route(swap.post).step(at)
        : pursue(intention, seen, board);
    // A crate on the way is walked into only as a planned push. The plan
    // holds while the intention does and each crate is where it assumed.
    if (
      queue.length === 0 &&
      action !== undefined &&
      action !== "pickup" &&
      action !== "putdown" &&
      crated(ahead(at, action))
    ) {
      let planned: Planned = "no goal";
      try {
        if (intention.kind !== "explore")
          planned = await planner(intention, seen, board);
      } catch (error) {
        log.error({ err: error }, "planning failed");
        planned = "no plan";
      }
      if (Array.isArray(planned)) {
        queue = planned;
        log.info({ intention, steps: queue.length }, "planned");
      } else if (planned === "no plan") {
        unplannable.add(JSON.stringify(intention));
        stale = true;
        continue;
      } else {
        wall(ahead(at, action));
        continue;
      }
    }
    if (action !== "pickup") {
      const step = queue.shift();
      if (step !== undefined) {
        if (
          step.do !== "pickup" &&
          step.do !== "putdown" &&
          crated(ahead(at, step.do)) !== step.push
        ) {
          queue = [];
          stale = true;
          await pace();
          continue;
        }
        action = step.do;
      }
    }
    if (action === undefined) {
      await pace();
    } else if (action === "pickup") {
      const taken = await game.pickup();
      beliefs.took(taken);
      stale = true;
      log.info({ taken }, "picked up");
    } else if (action === "putdown") {
      const ids = drop(beliefs.carrying(), policy);
      if (ids === undefined) {
        stale = true;
        await pace();
      } else {
        const delivered = await game.putdown(ids);
        beliefs.gave(ids);
        stale = true;
        log.info({ delivered }, "delivered");
        const reached = pending(policy, done).find(
          (g) => g.kind === "deliver" && within(at, g),
        );
        if (reached && delivered && delivered.length > 0) {
          done.add(mark(reached));
          shape = "";
          log.info({ goal: reached }, "reached");
        }
      }
    } else if (!(await walk(action))) {
      queue = [];
    }
  }
}
