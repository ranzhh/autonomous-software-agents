import { describe, expect, test } from "vitest";
import { type Batch, choose, supersedes } from "../src/choose.js";
import { pricedTour, touring } from "../src/tour.js";
import { value } from "../src/value.js";
import { config, setup } from "./world.js";

const ids = (parcels: { id: string }[]): string[] =>
  parcels.map((p) => p.id).sort();

describe("choosing a batch", () => {
  test("takes the parcel that pays for the walk", () => {
    // Delivery at x=0; a parcel two steps out is worth 30 - 4 = 26.
    const { beliefs, board } = setup(["2333333"], { x: 0, y: 0 }, [{ x: 2 }]);
    const batch = choose(beliefs, board, config, 0);
    expect(ids(batch.parcels)).toEqual(["p0"]);
    expect(batch.worth).toBe(26);
  });

  test("leaves a parcel that costs more than it pays", () => {
    // Six steps out and back is 12 decay against a reward of 10.
    const { beliefs, board } = setup(["2333333"], { x: 0, y: 0 }, [
      { x: 6, reward: 10 },
    ]);
    const batch = choose(beliefs, board, config, 0);
    expect(batch.parcels).toEqual([]);
  });

  test("collects both when the detour pays, and prices the whole load", () => {
    const { beliefs, board } = setup(["2333333"], { x: 0, y: 0 }, [
      { x: 1, reward: 50 },
      { x: 2, reward: 50 },
    ]);
    const batch = choose(beliefs, board, config, 0);
    // Both banked after four steps: (50-4) + (50-4).
    expect(ids(batch.parcels)).toEqual(["p0", "p1"]);
    expect(batch.worth).toBe(92);
  });

  test("stops collecting when the next parcel costs the load more than it adds", () => {
    // p0 is next door; p1 is far and nearly worthless, and dragging the load
    // out there sheds more from p0 than p1 could ever add.
    const { beliefs, board } = setup(["2333333333"], { x: 0, y: 0 }, [
      { x: 1, reward: 60 },
      { x: 9, reward: 5 },
    ]);
    const batch = choose(beliefs, board, config, 0);
    expect(ids(batch.parcels)).toEqual(["p0"]);
  });

  test("imposes no batch size of its own", () => {
    const { beliefs, board } = setup(
      ["2333333333333"],
      { x: 0, y: 0 },
      Array.from({ length: 12 }, (_, i) => ({ x: i + 1, reward: 90 })),
    );
    const batch = choose(beliefs, board, config, 0);
    expect(batch.parcels.length).toBe(12);
  });

  test("ignores what is out of reach", () => {
    const { beliefs, board } = setup(["233", "000", "233"], { x: 0, y: 2 }, [
      { x: 2, y: 0, reward: 90 },
    ]);
    const batch = choose(beliefs, board, config, 0);
    expect(batch.parcels).toEqual([]);
  });

  test("carrying a load and finding nothing worth a detour, it banks", () => {
    const { beliefs, board } = setup(["2333333"], { x: 3, y: 0 }, [
      { x: 3, carriedBy: "me", reward: 40 },
      { x: 6, reward: 4 },
    ]);
    const batch = choose(beliefs, board, config, 0);
    expect(batch.parcels).toEqual([]);
    // The carried parcel still banks 40 - 3 steps home.
    expect(batch.worth).toBe(37);
  });

  test("leaves a parcel a rival stands nearer to", () => {
    // Five steps out for us, one for the rival waiting past it.
    const { beliefs, board } = setup(
      ["2333333"],
      { x: 0, y: 0 },
      [{ x: 5 }],
      [{ x: 6 }],
    );
    expect(choose(beliefs, board, config, 0).parcels).toEqual([]);
  });

  test("keeps the parcel it stands nearer to, and a tie with it", () => {
    const nearer = setup(["2333333"], { x: 0, y: 0 }, [{ x: 2 }], [{ x: 6 }]);
    expect(
      ids(choose(nearer.beliefs, nearer.board, config, 0).parcels),
    ).toEqual(["p0"]);
    const tied = setup(["2333333"], { x: 0, y: 0 }, [{ x: 2 }], [{ x: 4 }]);
    expect(ids(choose(tied.beliefs, tied.board, config, 0).parcels)).toEqual([
      "p0",
    ]);
  });

  test("a sighting a decay tick old claims nothing", () => {
    const { beliefs, board } = setup(
      ["2333333"],
      { x: 0, y: 0 },
      [{ x: 5 }],
      [{ x: 6 }],
    );
    expect(ids(choose(beliefs, board, config, 1_000).parcels)).toEqual(["p0"]);
  });

  test("the tour that will be walked is worth exactly what was committed", () => {
    const { beliefs, board } = setup(["2333333333"], { x: 4, y: 0 }, [
      { x: 2, reward: 50 },
      { x: 7, reward: 60 },
      { x: 8, reward: 55 },
    ]);
    const at = beliefs.me();
    const batch = choose(beliefs, board, config, 0);
    const walk = touring(at, batch.parcels, board);

    expect(batch.parcels.length).toBeGreaterThan(1);
    expect(
      pricedTour(at, walk ?? [], [], batch.parcels, board, value(config)),
    ).toBe(batch.worth);
  });
});

describe("supersedes", () => {
  const batch = (worth: number, parcels = 1): Batch => ({
    worth,
    parcels: Array.from({ length: parcels }, (_, i) => ({
      id: `p${i}`,
      x: 0,
      y: 0,
      reward: worth,
      seenAt: 0,
    })),
  });
  const MARGIN = 1.2;

  test("a lost parcel drops the commitment whatever it is worth", () => {
    expect(supersedes(batch(1), 100, true, MARGIN)).toBe("gone");
  });

  test("keeps a tour that the alternative does not beat by the margin", () => {
    expect(supersedes(batch(110), 100, false, MARGIN)).toBeUndefined();
    expect(supersedes(batch(130), 100, false, MARGIN)).toBe("beaten");
  });

  test("drops a tour whose parcels have decayed to nothing", () => {
    expect(supersedes(batch(1), 0, false, MARGIN)).toBe("expired");
  });

  test("re-commits when there is no tour left to walk", () => {
    expect(supersedes(batch(100), undefined, false, MARGIN)).toBe("stalled");
    expect(supersedes(batch(50, 0), undefined, false, MARGIN)).toBe("stalled");
  });

  test("stays idle when there is nothing to chase and no tour", () => {
    expect(supersedes(batch(0, 0), undefined, false, MARGIN)).toBeUndefined();
  });
});
