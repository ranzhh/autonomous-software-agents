/**
 * llm/memory — the LLM context, kept dynamic as required by the spec. Holds the
 * current objective, the latest environment observations, and the catalog of
 * available tools, and renders them into the messages the planner/replanner see.
 * Updated as the environment and objectives change over time.
 *
 * Intended files (added in Phase 5):
 *   - memory.ts — objective + observations + tool catalog; render to messages.
 */

export {};
