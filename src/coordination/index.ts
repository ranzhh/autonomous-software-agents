/**
 * coordination — how Agent A and Agent B divide work and pull off Level-3
 * missions. A `Transport` interface abstracts the channel (SDK say/ask/shout for
 * production/demo; in-process for offline tests only), a typed protocol carries
 * `{ type, from, ts, payload }` messages (belief/claim/release/sync/policy/intent),
 * and a `Coordinator` runs closest-claims-it task division with TTL auto-release,
 * belief exchange, and a sync barrier. The SDK channel is the graded mechanism.
 *
 * Intended files (added in Phase 8):
 *   - transport.ts   — Transport interface + SDK and in-process implementations.
 *   - protocol.ts    — typed message union.
 *   - coordinator.ts — claims/TTL, belief exchange, sync barrier.
 */

export {};
