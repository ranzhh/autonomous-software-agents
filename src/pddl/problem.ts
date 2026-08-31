import type { ParcelBelief } from "../beliefs.js";
import type { Position } from "../sdk.js";

export type Distance = (from: Position, to: Position) => number;

const TILE = /^t(\d+)-(\d+)$/;

const location = (p: Position): string =>
  `t${Math.round(p.x)}-${Math.round(p.y)}`;

export function positionOf(name: string): Position | undefined {
  const [, x, y] = TILE.exec(name) ?? [];
  return x === undefined || y === undefined
    ? undefined
    : { x: Number(x), y: Number(y) };
}

export function problem(
  from: Position,
  parcels: ParcelBelief[],
  deliveries: Position[],
  dist: Distance,
): string {
  const loose = parcels.filter((p) => !p.carriedBy);
  const tiles = new Map<string, Position>();
  for (const tile of [from, ...loose, ...deliveries])
    tiles.set(location(tile), tile);

  const objects = [`${[...tiles.keys()].join(" ")} - location`];
  if (parcels.length > 0)
    objects.push(`${parcels.map((p) => p.id).join(" ")} - parcel`);

  const init = [
    `(at ${location(from)})`,
    "(= (total-cost) 0)",
    ...deliveries.map((d) => `(delivery ${location(d)})`),
    ...parcels.map((p) =>
      p.carriedBy ? `(carrying ${p.id})` : `(parcel-at ${p.id} ${location(p)})`,
    ),
  ];

  for (const [here, at] of tiles)
    for (const [there, to] of tiles) {
      if (here === there) continue;
      const steps = dist(at, to);
      if (!Number.isFinite(steps)) continue;
      init.push(
        `(reachable ${here} ${there})`,
        `(= (dist ${here} ${there}) ${steps})`,
      );
    }

  return [
    "(define (problem tour)",
    "  (:domain deliveroo-tour)",
    "  (:objects",
    ...objects.map((line) => `    ${line}`),
    "  )",
    "  (:init",
    ...init.map((fact) => `    ${fact}`),
    "  )",
    `  (:goal (and ${parcels.map((p) => `(delivered ${p.id})`).join(" ")}))`,
    "  (:metric minimize (total-cost)))",
    "",
  ].join("\n");
}
