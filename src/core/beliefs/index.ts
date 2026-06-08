/**
 * core/beliefs — the agent's world model and its revision. A `BeliefSet` wires
 * the SDK listeners and emits an `updated` signal; underneath it tracks parcels
 * (local −1/tick decay, expire-at-0, forget-on-miss, phantom-carry guard), other
 * agents (teammate via `teamName`, rival vs friendly, last-seen guesses), the
 * static map, and the game settings read from `onConfig` (hardcode nothing).
 *
 * Intended files (added in Phase 1):
 *   - settings.ts       — typed GAME settings from onConfig (decay/gen ms, etc.).
 *   - game-map.ts       — walkable/delivery/spawner sets, neighbours.
 *   - parcel-beliefs.ts — decay/expiry/forget + phantom-carry guard.
 *   - agent-beliefs.ts  — teammate/rival split, last-seen tracking.
 *   - belief-set.ts     — wires listeners, revises, emits 'updated'.
 */

export {
  buildGameMap,
  type GameMap,
  type Pos,
} from "./game-map.js";
export { clockEventToMs, parseSettings, type Settings } from "./settings.js";
