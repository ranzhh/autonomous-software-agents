/** Map names, as in the assets package. */
export const SUITE = [
  // 10x10, no obstacles, one random NPC.
  "empty_10",
  // 30x30 corridors, no NPCs, zero reward variance.
  "26c1_3",
  // Two crates gate the route from four spawners to five delivery tiles.
  "crates_one_way",
  // One spawner, one delivery tile, 18 crates in between.
  "crates_maze",
  // Quadrants joined by one-way lanes, one intelligent NPC.
  "26c1_4",
] as const;
