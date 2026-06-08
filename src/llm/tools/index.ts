/**
 * llm/tools — the tool registry the LLM plans against, plus the implementations.
 * Tools are looked up by name and validated against a JSON schema for their args.
 * `calculate` is implemented safely (no `eval`). Game-acting tools (move_to,
 * move, pickup, putdown, …) run over our SDK wrapper and beliefs; QA tools
 * (`reply`) answer the sender over the game chat.
 *
 * Intended files (added in Phase 6):
 *   - registry.ts   — typed tool registry + arg-schema validation.
 *   - calculate.ts  — safe arithmetic evaluator (no eval).
 *   - game-tools.ts  — move_to/move/pickup/putdown/sense/list_* over the core.
 *   - reply.ts      — reply-to-sender for question-answer missions.
 */

export {};
