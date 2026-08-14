/**
 * `pickUpHere` / `putDownAll` own the two non-obvious pieces of server
 * knowledge that used to be copy-pasted into every plan that picks up:
 * the ack carries no parcel ids, and a lost ack is not an empty one.
 * → CLAUDE.md §6, ADR-0008.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createPlanContext } from "../../../src/bdi/plans/index.js";
import { createBeliefSet } from "../../../src/core/beliefs/index.js";
import type {
  GameConnection,
  GameMapData,
  IOAgent,
  IOConfig,
  IOParcel,
  IOSensing,
  PickedParcel,
  Position,
} from "../../../src/core/sdk/index.js";

const ME: IOAgent = {
  id: "me",
  name: "Me",
  teamId: "t",
  teamName: "team",
  x: 2,
  y: 3,
  score: 0,
  penalty: 0,
};

const CONFIG = {
  CLOCK: 50,
  GAME: {
    player: { movement_duration: 50, observation_distance: 5, capacity: 10 },
    parcels: {
      generation_event: "1s",
      decaying_event: "infinite",
      max: 10,
      reward_avg: 10,
      reward_variance: 0,
    },
  },
} as unknown as IOConfig;

const MAP: GameMapData = {
  width: 5,
  height: 5,
  tiles: Array.from({ length: 25 }, (_, i) => ({
    x: i % 5,
    y: Math.floor(i / 5),
    type: "3" as const,
  })),
};

/** A connection whose pickup/putdown acks the test scripts directly. */
class Conn implements GameConnection {
  private sensingCb: ((s: IOSensing) => void) | undefined;
  /** `undefined` models a lost ack (the SDK's 1s timeout). */
  pickupAck: readonly PickedParcel[] | undefined = [];
  putdownAck: readonly PickedParcel[] | undefined = [];
  pickups = 0;
  putdowns = 0;

  ready = async (): Promise<void> => undefined;
  isReady = (): boolean => true;
  config = (): IOConfig => CONFIG;
  map = (): GameMapData => MAP;
  me = (): IOAgent => ME;
  onSensing = (listener: (s: IOSensing) => void): void => {
    this.sensingCb = listener;
  };
  emitMove = async (): Promise<Position | false> => false;
  emitPickup = async (): Promise<readonly PickedParcel[] | undefined> => {
    this.pickups += 1;
    return this.pickupAck;
  };
  emitPutdown = async (): Promise<readonly PickedParcel[] | undefined> => {
    this.putdowns += 1;
    return this.putdownAck;
  };
  disconnect = (): void => undefined;

  sense(parcels: readonly IOParcel[]): void {
    this.sensingCb?.({
      positions: MAP.tiles.map((t) => ({ x: t.x, y: t.y })),
      agents: [],
      parcels: [...parcels],
      crates: [],
    } as unknown as IOSensing);
  }
}

/** A parcel the server reports free on my tile (2,3). */
const onMyTile = (id: string): IOParcel =>
  ({ id, x: 2, y: 3, reward: 10 }) as IOParcel;

let conn: Conn;
let beliefs: ReturnType<typeof createBeliefSet>;
let ctx: ReturnType<typeof createPlanContext>;

beforeEach(() => {
  conn = new Conn();
  beliefs = createBeliefSet(conn);
  ctx = createPlanContext(beliefs, conn);
});

describe("PlanContext.pickUpHere", () => {
  it("does not emit when no parcel is believed on my tile", async () => {
    conn.sense([]);

    await expect(ctx.pickUpHere()).resolves.toEqual([]);
    expect(conn.pickups).toBe(0); // no wasted round-trip
  });

  it("credits the believed parcels even though the ack carries no ids", async () => {
    conn.sense([onMyTile("p1"), onMyTile("p2")]);
    // What the real server sends: entries with every field except `id`.
    conn.pickupAck = [{}, {}] as unknown as PickedParcel[];

    await expect(ctx.pickUpHere()).resolves.toEqual(["p1", "p2"]);
    expect(ctx.carriedParcelIds().toSorted()).toEqual(["p1", "p2"]);
  });

  it("forgets the belief when the server explicitly took nothing", async () => {
    conn.sense([onMyTile("ghost")]);
    conn.pickupAck = [];

    await expect(ctx.pickUpHere()).resolves.toEqual([]);
    expect(ctx.freeParcels()).toEqual([]); // phantom dropped
    expect(ctx.carriedParcelIds()).toEqual([]);
  });

  /**
   * The regression that matters on a slow link: the SDK's 1s ack timeout fires
   * while the pickup succeeds server-side. Treating that `undefined` as "took
   * nothing" would forget parcels we are actually carrying and burn a replan on
   * every pickup — precisely where cycles are scarcest.
   */
  it("treats a lost ack as success, not as an empty tile", async () => {
    conn.sense([onMyTile("p1")]);
    conn.pickupAck = undefined;

    await expect(ctx.pickUpHere()).resolves.toEqual(["p1"]);
    expect(ctx.carriedParcelIds()).toEqual(["p1"]);
  });
});

describe("PlanContext.putDownAll", () => {
  it("drops nothing and does not emit when empty-handed", async () => {
    conn.sense([]);

    await expect(ctx.putDownAll()).resolves.toEqual([]);
    expect(conn.putdowns).toBe(0);
  });

  it("drops the whole carried stack and forgets it", async () => {
    conn.sense([onMyTile("p1"), onMyTile("p2")]);
    conn.pickupAck = [{}] as unknown as PickedParcel[];
    await ctx.pickUpHere();

    await expect((await ctx.putDownAll()).toSorted()).toEqual(["p1", "p2"]);
    expect(ctx.carriedParcelIds()).toEqual([]);
  });

  it("still forgets the stack when the putdown ack is lost", async () => {
    conn.sense([onMyTile("p1")]);
    conn.pickupAck = [{}] as unknown as PickedParcel[];
    await ctx.pickUpHere();
    conn.putdownAck = undefined;

    await expect(ctx.putDownAll()).resolves.toEqual(["p1"]);
    expect(ctx.carriedParcelIds()).toEqual([]);
  });
});
