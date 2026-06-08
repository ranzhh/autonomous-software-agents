/**
 * core/sdk — the typed boundary to the game. A readiness-aware wrapper over
 * `DjsConnect` that builds its world view from our own `onConfig`/`onMap`/`onYou`
 * listeners (NOT the unreliable one-shot `socket.{config,map,me,token}` promises,
 * CLAUDE.md §6), the SDK IO types re-exported as our single boundary to them, and
 * the env/config loader. `mint-token.ts` (the `npm run token` tool) lives here too
 * but is a script, not part of this public API.
 */

export type { AgentConfig, PddlSolver, PlannerMode } from "./config.js";
export { loadConfig, loadDotEnv } from "./config.js";
export {
  type ConnectOptions,
  connectToGame,
  createConnection,
  type DjsSocketLike,
  type GameConnection,
  type GameMapData,
} from "./connection.js";
export { extractToken, parseTokenArgs, type TokenArgs } from "./token.js";
export type {
  Direction,
  IOAgent,
  IOClockEvent,
  IOConfig,
  IOGameOptions,
  IOParcel,
  IOSensing,
  IOTile,
  IOTileType,
  PickedParcel,
  Position,
} from "./types.js";
