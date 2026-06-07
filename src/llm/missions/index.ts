/**
 * llm/missions — special-mission intake and routing. Reads NL prompts from
 * `onMsg` (broadcast by the mission god-agent), classifies them by the Challenge-2
 * taxonomy (L1 atomic / L2 persistent policy / L3 coordination), and applies the
 * worth-it gate that interprets sign + wording (a stated-negative one-shot is a
 * trap to skip; a negative bonus is often a prohibition to obey, not skip).
 *
 * Intended files (added in Phases 6–8):
 *   - intake.ts    — onMsg → parsed mission.
 *   - taxonomy.ts  — classify L1/L2/L3 + extract embedded data.
 *   - worth-it.ts  — convenience gate (sign + wording, not blanket-skip negatives).
 */

export {};
