import { run } from "../agent.js";
import {
  DIRECTIONS,
  type Direction,
  type IOSensing,
  type Position,
} from "../sdk.js";

await run(async (game, { me, tiles, config }) => {
  let sensing: IOSensing | undefined;
  game.onSensing((next) => {
    sensing = next;
  });

  const pace = config.GAME.player.movement_duration;
  // Weighing decay against the trip is deliberate's job; greedy just fills up.
  const capacity = config.GAME.player.capacity;
  const deliveries = tiles.filter((tile) => tile.type === "2");

  function position(): Position {
    const now = game.me();
    if (now?.x === undefined || now.y === undefined)
      throw new Error("the agent has no position");
    return { x: now.x, y: now.y };
  }

  const distance = (a: Position, b: Position) =>
    Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

  function nearest<T extends Position>(
    from: Position,
    targets: T[],
  ): T | undefined {
    let best: T | undefined;
    for (const target of targets)
      if (!best || distance(from, target) < distance(from, best)) best = target;
    return best;
  }

  const wander = () =>
    DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)] as Direction;

  function toward(from: Position, to: Position): Direction {
    if (to.x !== from.x) return to.x > from.x ? "right" : "left";
    return to.y > from.y ? "up" : "down";
  }

  // Acks outrun sensing; the overlay stops re-picks against stale snapshots.
  const picked = new Set<string>();
  const dropped = new Set<string>();

  while (true) {
    const at = position();
    const parcels = sensing?.parcels ?? [];
    const carried = parcels.filter(
      (p) => picked.has(p.id) || (p.carriedBy === me.id && !dropped.has(p.id)),
    );
    const loose = parcels.filter((p) => !p.carriedBy && !picked.has(p.id));

    const underfoot = loose.find(
      (parcel) => parcel.x === at.x && parcel.y === at.y,
    );
    const onDelivery = deliveries.some(
      (tile) => tile.x === at.x && tile.y === at.y,
    );

    if (carried.length > 0 && onDelivery) {
      await game.putdown();
      for (const p of carried) {
        dropped.add(p.id);
        picked.delete(p.id);
      }
      continue;
    }
    if (underfoot && carried.length < capacity) {
      const taken = await game.pickup();
      // The ack names no ids; what was loose on this tile is what was taken.
      if (taken && taken.length > 0)
        for (const p of loose)
          if (p.x === at.x && p.y === at.y) picked.add(p.id);
      continue;
    }

    const full = carried.length >= capacity;
    const target = full
      ? nearest(at, deliveries)
      : (nearest(at, loose) ??
        (carried.length > 0 ? nearest(at, deliveries) : undefined));

    const moved = await game.move(target ? toward(at, target) : wander());
    if (moved === false) await game.move(wander());

    await new Promise((resolve) => setTimeout(resolve, pace));
  }
});
