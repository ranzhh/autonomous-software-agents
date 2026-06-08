/**
 * core/sdk — a typed wrapper over the SDK's `DjsConnect` that encapsulates the
 * gotchas in CLAUDE.md §6 once, so no other module re-learns them. Readiness is
 * built from our own `onConfig`/`onMap`/`onYou` listeners (NOT the unreliable
 * one-shot `socket.{config,map,me,token}` promises), events are strongly typed,
 * and `me`/`config`/`map` accessors expose a settled view of the world.
 *
 * Intended files (added in task 0.3):
 *   - connection.ts — typed DjsConnect wrapper + own-listener readiness.
 *   - events.ts     — typed event payloads (IOConfig/IOMap/IOSensing/...).
 *   - config.ts     — env/config loader with safe non-secret fallbacks.
 *   - mint-token.ts — `npm run token` tool (mint via DjsRestClient) — task 0.4.
 */

export {};
