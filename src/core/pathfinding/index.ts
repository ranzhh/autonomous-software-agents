/**
 * core/pathfinding — reliable navigation over the grid that copes with moving
 * agents (occupied tiles are blockers, supplied via an `isBlocked` predicate). A*
 * for a single target, BFS-to-nearest over a goal set, and the geometry helpers
 * (manhattan, samePos, directionTo) the rest of the codebase shares. Pure
 * functions over a `GameMap` + an optional blocker view.
 */

export { astar } from "./astar.js";
export { bfsToNearest } from "./bfs.js";
export {
  directionTo,
  manhattan,
  type Path,
  posKey,
  type SearchOptions,
  samePos,
} from "./geometry.js";
