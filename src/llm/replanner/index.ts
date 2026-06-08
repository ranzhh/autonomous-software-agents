/**
 * llm/replanner — refines/improves a plan iteratively (Reflexion), especially
 * when an observation or the objective changes mid-execution. Sits alongside the
 * ReAct step executor, which runs one step at a time over the tool registry with
 * bounded iterations and rejects malformed model output (multi-Action, or an
 * Action together with a Final Answer).
 *
 * Intended files (added in Phase 5):
 *   - replanner.ts — Reflexion-style plan revision on changed observation/goal.
 *   - executor.ts  — bounded ReAct step executor over the tool registry.
 */

export {};
