import { describe, expect, it } from "vitest";
import { createBeliefSet } from "../../../src/core/beliefs/index.js";
import type {
  GameConnection,
  GameMapData,
  IOAgent,
  IOConfig,
  IOSensing,
  PickedParcel,
  Position,
} from "../../../src/core/sdk/index.js";

// ── Mock GameConnection ───────────────────────────────────────────────────────

class MockConnection implements GameConnection {
  private _config: IOConfig | undefined;
  private _map: GameMapData | undefined;
  private _me: IOAgent | undefined;
  private sensingListeners: Array<(s: IOSensing) => void> = [];

  setConfig(cfg: IOConfig): void {
    this._config = cfg;
  }
  setMap(m: GameMapData): void {
    this._map = m;
  }
  setMe(me: IOAgent): void {
    this._me = me;
  }

  config(): IOConfig | undefined {
    return this._config;
  }
  map(): GameMapData | undefined {
    return this._map;
  }
  me(): IOAgent | undefined {
    return this._me;
  }

  onSensing(listener: (s: IOSensing) => void): void {
    this.sensingListeners.push(listener);
  }

  fireSensing(s: IOSensing): void {
    for (const l of this.sensingListeners) l(s);
  }

  // Action emitters — unused by belief-revision tests; stubbed to satisfy the interface.
  async emitMove(): Promise<Position | false> {
    return false;
  }
  async emitPickup(): Promise<readonly PickedParcel[]> {
    return [];
  }
  async emitPutdown(): Promise<readonly PickedParcel[]> {
    return [];
  }

  ready(): Promise<void> {
    return Promise.resolve();
  }
  isReady(): boolean {
    return true;
  }
  disconnect(): void {
    /* noop */
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const FAKE_CONFIG = {
  CLOCK: 100,
  PENALTY: 0,
  BROADCAST_LOGS: false,
  AGENT_TIMEOUT: 0,
  GAME: {
    title: "test",
    description: "",
    map: { width: 3, height: 3, tiles: [] },
    maxPlayers: 2,
    npcs: [],
    player: {
      agent_type: "",
      movement_duration: 100,
      observation_distance: 5,
      capacity: 5,
    },
    parcels: {
      generation_event: "1s",
      decaying_event: "1s",
      max: 10,
      reward_avg: 10,
      reward_variance: 2,
    },
  },
} as unknown as IOConfig;

const SIMPLE_MAP: GameMapData = {
  width: 3,
  height: 3,
  tiles: [
    { x: 0, y: 0, type: "3" },
    { x: 1, y: 0, type: "3" },
    { x: 2, y: 0, type: "2" },
    { x: 0, y: 1, type: "3" },
    { x: 1, y: 1, type: "3" },
    { x: 2, y: 1, type: "3" },
    { x: 0, y: 2, type: "1" },
    { x: 1, y: 2, type: "3" },
    { x: 2, y: 2, type: "3" },
  ],
};

const ME: IOAgent = {
  id: "me",
  name: "ASAP_BDI",
  teamId: "t1",
  teamName: "ASAP",
  score: 0,
  penalty: 0,
  x: 1,
  y: 1,
};

function emptySensing(positions: { x: number; y: number }[] = []): IOSensing {
  return { positions, agents: [], parcels: [], crates: [] };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createBeliefSet — initialisation", () => {
  it("parses settings from config at construction time", () => {
    const conn = new MockConnection();
    conn.setConfig(FAKE_CONFIG);
    conn.setMe(ME);
    const bs = createBeliefSet(conn);
    expect(bs.settings?.movementDurationMs).toBe(100);
    expect(bs.settings?.parcelDecayMs).toBe(1000);
  });

  it("builds game-map from connection.map() at construction time", () => {
    const conn = new MockConnection();
    conn.setConfig(FAKE_CONFIG);
    conn.setMap(SIMPLE_MAP);
    conn.setMe(ME);
    const bs = createBeliefSet(conn);
    expect(bs.gameMap).toBeDefined();
    expect(bs.gameMap?.width).toBe(3);
    expect(bs.gameMap?.isDelivery({ x: 2, y: 0 })).toBe(true);
  });

  it("exposes settings/gameMap as undefined when connection not yet ready", () => {
    const conn = new MockConnection();
    const bs = createBeliefSet(conn);
    expect(bs.settings).toBeUndefined();
    expect(bs.gameMap).toBeUndefined();
  });
});

describe("createBeliefSet — sensing revision", () => {
  it("revises parcel beliefs on sensing and fires onUpdated", () => {
    const conn = new MockConnection();
    conn.setConfig(FAKE_CONFIG);
    conn.setMap(SIMPLE_MAP);
    conn.setMe(ME);
    let updateCount = 0;
    const bs = createBeliefSet(conn);
    bs.onUpdated(() => {
      updateCount++;
    });

    conn.fireSensing({
      positions: [{ x: 1, y: 2 }],
      agents: [],
      parcels: [{ id: "p1", x: 1, y: 2, reward: 5 }],
      crates: [],
    });

    expect(updateCount).toBe(1);
    expect(bs.parcels.free()).toHaveLength(1);
    expect(bs.parcels.free()[0]?.id).toBe("p1");
  });

  it("revises agent beliefs on sensing", () => {
    const conn = new MockConnection();
    conn.setConfig(FAKE_CONFIG);
    conn.setMap(SIMPLE_MAP);
    conn.setMe(ME);
    const bs = createBeliefSet(conn);

    conn.fireSensing({
      positions: [{ x: 0, y: 0 }],
      agents: [
        {
          id: "rival1",
          name: "Rival",
          teamId: "t2",
          teamName: "Rivals",
          score: 0,
          penalty: 0,
          x: 0,
          y: 0,
        },
      ],
      parcels: [],
      crates: [],
    });

    expect(bs.agents.rivals()).toHaveLength(1);
    expect(bs.agents.rivals()[0]?.id).toBe("rival1");
  });

  it("does not fire updated when me is undefined", () => {
    const conn = new MockConnection();
    conn.setConfig(FAKE_CONFIG);
    // No me set
    let fired = false;
    const bs = createBeliefSet(conn);
    bs.onUpdated(() => {
      fired = true;
    });
    conn.fireSensing(emptySensing());
    expect(fired).toBe(false);
  });

  it("fires updated multiple times on multiple sensings", () => {
    const conn = new MockConnection();
    conn.setConfig(FAKE_CONFIG);
    conn.setMe(ME);
    let count = 0;
    const bs = createBeliefSet(conn);
    bs.onUpdated(() => {
      count++;
    });
    conn.fireSensing(emptySensing());
    conn.fireSensing(emptySensing());
    conn.fireSensing(emptySensing());
    expect(count).toBe(3);
  });
});

describe("createBeliefSet — onUpdated unsubscribe", () => {
  it("stops firing after unsubscribe", () => {
    const conn = new MockConnection();
    conn.setMe(ME);
    let count = 0;
    const bs = createBeliefSet(conn);
    const unsub = bs.onUpdated(() => {
      count++;
    });
    conn.fireSensing(emptySensing());
    unsub();
    conn.fireSensing(emptySensing());
    expect(count).toBe(1);
  });
});
