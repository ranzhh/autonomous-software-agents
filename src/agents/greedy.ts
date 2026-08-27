import { log } from "../log.js";
import {
  connect,
  DIRECTIONS,
  type Direction,
  type IOSensing,
  type Position,
} from "../sdk.js";

const game = connect();

let sensing: IOSensing | undefined;
game.onSensing((next) => {
  sensing = next;
});

const { me, tiles, config } = await game.ready();
log.info({ agent: me.name, x: me.x, y: me.y }, "spawned");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    log.info({ signal }, "disconnecting");
    game.disconnect();
    process.exit(0);
  });
}

const pace = config.GAME.player.movement_duration;
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

while (true) {
  const at = position();
  const parcels = sensing?.parcels ?? [];
  const carried = parcels.filter((parcel) => parcel.carriedBy === me.id);
  const loose = parcels.filter((parcel) => !parcel.carriedBy);

  const underfoot = loose.find(
    (parcel) => parcel.x === at.x && parcel.y === at.y,
  );
  const onDelivery = deliveries.some(
    (tile) => tile.x === at.x && tile.y === at.y,
  );

  if (carried.length > 0 && onDelivery) {
    await game.putdown();
    continue;
  }
  if (underfoot && carried.length < capacity) {
    await game.pickup();
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
