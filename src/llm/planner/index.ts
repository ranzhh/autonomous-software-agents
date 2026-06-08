/**
 * llm/planner — decomposes a natural-language objective into a sequence of
 * tool calls. Prompts the model (Chain-of-Thought) for a structured plan
 * `{ thought, skip?, steps: [{ tool, args }] }`, parses tolerantly, and issues
 * a single repair re-prompt on malformed output before giving up.
 *
 * Intended files (added in Phase 5):
 *   - planner.ts — NL → plan; tolerant parse + one repair re-prompt.
 *   - prompts.ts — system/user prompt templates (iterated in isolation).
 */

export {};
