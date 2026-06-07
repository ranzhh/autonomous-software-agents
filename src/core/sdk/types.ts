/**
 * The project's single boundary to the SDK's IO types: the rest of the codebase
 * imports them from `core/sdk`, never from deep `@unitn-asa/...` paths. Re-exported
 * verbatim from `@unitn-asa/deliveroo-js-sdk` 1.3.10 (read as JSDoc types via
 * `allowJs`), plus a couple of derived types we own.
 */

export type { IOAgent } from "@unitn-asa/deliveroo-js-sdk/types/IOAgent.js";
export type { IOClockEvent } from "@unitn-asa/deliveroo-js-sdk/types/IOClockEvent.js";
export type { IOConfig } from "@unitn-asa/deliveroo-js-sdk/types/IOConfig.js";
export type { IOGameOptions } from "@unitn-asa/deliveroo-js-sdk/types/IOGameOptions.js";
export type { IOParcel } from "@unitn-asa/deliveroo-js-sdk/types/IOParcel.js";
export type { IOSensing } from "@unitn-asa/deliveroo-js-sdk/types/IOSensing.js";
export type {
  IOTile,
  IOTileType,
} from "@unitn-asa/deliveroo-js-sdk/types/IOTile.js";

/** Movement directions accepted by `emitMove` (y is inverted: up = y+1). */
export type Direction = "up" | "down" | "left" | "right";
