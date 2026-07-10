import { describe, expect, it } from "vitest";
import {
  createConnection,
  type Direction,
  type DjsSocketLike,
  type IOAgent,
  type IOConfig,
  type IOSensing,
  type IOTile,
  type PickedParcel,
  type Position,
} from "../../../src/core/sdk/index.js";
import { SensingError } from "../../../src/core/util/index.js";

/** A DjsSocketLike whose `fire*` helpers let a test drive the wrapper. */
class MockSocket implements DjsSocketLike {
  private configCb?: (config: IOConfig) => void;
  private mapCb?: (width: number, height: number, tiles: IOTile[]) => void;
  private youCb?: (me: IOAgent) => void;
  private sensingCb?: (sensing: IOSensing) => void;
  disconnected = false;

  // Scripted action results + captured arguments for the emit* delegation tests.
  moveError: Error | undefined;
  moveResult: Position | false = { x: 0, y: 0 };
  pickupResult: PickedParcel[] = [];
  putdownResult: PickedParcel[] = [];
  lastMove?: Direction;
  lastPutdown?: string[] | undefined;

  onConfig(listener: (config: IOConfig) => void): void {
    this.configCb = listener;
  }
  onMap(
    listener: (width: number, height: number, tiles: IOTile[]) => void,
  ): void {
    this.mapCb = listener;
  }
  onYou(listener: (me: IOAgent) => void): void {
    this.youCb = listener;
  }
  onSensing(listener: (sensing: IOSensing) => void): void {
    this.sensingCb = listener;
  }
  async emitMove(direction: Direction): Promise<Position | false> {
    this.lastMove = direction;
    if (this.moveError !== undefined) throw this.moveError;
    return this.moveResult;
  }
  async emitPickup(): Promise<PickedParcel[]> {
    return this.pickupResult;
  }
  async emitPutdown(selected?: string[]): Promise<PickedParcel[]> {
    this.lastPutdown = selected;
    return this.putdownResult;
  }
  disconnect(): void {
    this.disconnected = true;
  }

  fireConfig(config: IOConfig): void {
    this.configCb?.(config);
  }
  fireMap(width: number, height: number, tiles: IOTile[]): void {
    this.mapCb?.(width, height, tiles);
  }
  fireYou(me: IOAgent): void {
    this.youCb?.(me);
  }
  fireSensing(sensing: IOSensing): void {
    this.sensingCb?.(sensing);
  }
}

// The wrapper stores config opaquely; its inner shape is irrelevant to these tests.
const fakeConfig = { GAME: {} } as unknown as IOConfig;

const agent = (over: Partial<IOAgent> = {}): IOAgent => ({
  id: "a1",
  name: "A",
  teamId: "t",
  teamName: "team",
  score: 0,
  penalty: 0,
  ...over,
});

const emptySensing = (): IOSensing => ({
  positions: [],
  agents: [],
  parcels: [],
  crates: [],
});

describe("createConnection", () => {
  it("becomes ready only after config, map, and you are all seen", async () => {
    const sock = new MockSocket();
    const conn = createConnection(sock);
    let resolved = false;
    const pending = conn.ready().then(() => {
      resolved = true;
    });

    expect(conn.isReady()).toBe(false);
    sock.fireConfig(fakeConfig);
    sock.fireMap(3, 4, [{ x: 0, y: 0, type: "3" }]);
    expect(conn.isReady()).toBe(false);
    expect(resolved).toBe(false);

    sock.fireYou(agent({ x: 1, y: 2 }));
    await pending;
    expect(conn.isReady()).toBe(true);
    expect(resolved).toBe(true);
  });

  it("exposes the latest config, map, and me", () => {
    const sock = new MockSocket();
    const conn = createConnection(sock);
    sock.fireConfig(fakeConfig);
    sock.fireMap(3, 4, [{ x: 0, y: 0, type: "2" }]);
    sock.fireYou(agent({ x: 1, y: 2 }));
    sock.fireYou(agent({ x: 7, y: 8 })); // newer position wins

    expect(conn.config()).toBe(fakeConfig);
    expect(conn.map()).toEqual({
      width: 3,
      height: 4,
      tiles: [{ x: 0, y: 0, type: "2" }],
    });
    expect(conn.me()?.x).toBe(7);
    expect(conn.me()?.y).toBe(8);
  });

  it("guards undefined coordinates (agent out of view)", () => {
    const sock = new MockSocket();
    const conn = createConnection(sock);
    sock.fireYou(agent()); // no x/y
    expect(conn.me()).toBeDefined();
    expect(conn.me()?.x).toBeUndefined();
  });

  it("forwards sensing events", () => {
    const sock = new MockSocket();
    const conn = createConnection(sock);
    const seen: IOSensing[] = [];
    conn.onSensing((sensing) => seen.push(sensing));
    const snapshot = emptySensing();
    sock.fireSensing(snapshot);
    expect(seen).toEqual([snapshot]);
  });

  it("resolves ready() immediately when already ready", async () => {
    const sock = new MockSocket();
    const conn = createConnection(sock);
    sock.fireConfig(fakeConfig);
    sock.fireMap(1, 1, []);
    sock.fireYou(agent());
    await expect(conn.ready(1000)).resolves.toBeUndefined();
  });

  it("rejects ready() with a SensingError on timeout", async () => {
    const sock = new MockSocket();
    const conn = createConnection(sock);
    await expect(conn.ready(10)).rejects.toBeInstanceOf(SensingError);
  });

  it("disconnect() delegates to the socket", () => {
    const sock = new MockSocket();
    const conn = createConnection(sock);
    conn.disconnect();
    expect(sock.disconnected).toBe(true);
  });

  it("emitMove forwards the direction and surfaces the new position", async () => {
    const sock = new MockSocket();
    sock.moveResult = { x: 4, y: 5 };
    const conn = createConnection(sock);
    await expect(conn.emitMove("up")).resolves.toEqual({ x: 4, y: 5 });
    expect(sock.lastMove).toBe("up");
  });

  it("emitMove surfaces a false result (blocked tile)", async () => {
    const sock = new MockSocket();
    sock.moveResult = false;
    const conn = createConnection(sock);
    await expect(conn.emitMove("right")).resolves.toBe(false);
  });

  it("emitMove maps the SDK's 1s ack-timeout rejection to false (retry like a blocked move)", async () => {
    const sock = new MockSocket();
    sock.moveError = new Error("operation has timed out");
    const conn = createConnection(sock);
    await expect(conn.emitMove("up")).resolves.toBe(false);
  });

  it("emitMove rethrows non-timeout rejections", async () => {
    const sock = new MockSocket();
    sock.moveError = new Error("socket closed");
    const conn = createConnection(sock);
    await expect(conn.emitMove("up")).rejects.toThrow("socket closed");
  });

  it("emitPickup surfaces the picked parcels", async () => {
    const sock = new MockSocket();
    sock.pickupResult = [{ id: "p1" }, { id: "p2" }];
    const conn = createConnection(sock);
    await expect(conn.emitPickup()).resolves.toEqual([
      { id: "p1" },
      { id: "p2" },
    ]);
  });

  it("emitPutdown forwards a copy of the ids and surfaces the dropped parcels", async () => {
    const sock = new MockSocket();
    sock.putdownResult = [{ id: "p1" }];
    const conn = createConnection(sock);
    const ids = ["p1"];
    await expect(conn.emitPutdown(ids)).resolves.toEqual([{ id: "p1" }]);
    expect(sock.lastPutdown).toEqual(["p1"]);
    expect(sock.lastPutdown).not.toBe(ids); // delegated a copy, not the caller's array
  });

  it("emitPutdown with no argument drops all (passes undefined through)", async () => {
    const sock = new MockSocket();
    const conn = createConnection(sock);
    await conn.emitPutdown();
    expect(sock.lastPutdown).toBeUndefined();
  });
});
