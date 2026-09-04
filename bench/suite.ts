/** The fixed map suite every campaign runs on. Names resolve in the assets package. */
export const SUITE = [
  // 10x10, no obstacles, one random NPC: the sanity check and the collection ceiling.
  "empty_10",
  // 30x30 corridors and open areas, no NPCs, zero reward variance: exact supply bound.
  "26c1_3",
  // Four spawners and five delivery tiles gated by two crates: is the crate route found at all?
  "crates_one_way",
  // One spawner, one delivery tile, 18 crates in between: pure crate pushing.
  "crates_maze",
  // Maze with unlimited observation and one random NPC blocking tiles.
  "chaotic_maze",
] as const;
