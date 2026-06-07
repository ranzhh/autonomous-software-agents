/**
 * core/util — cross-cutting primitives shared by every other module: a leveled
 * logger (able to bridge the SDK's `emitLog` so output shows in the 3D client),
 * the `AgentError` hierarchy, and a `Result` type for fallible operations.
 * This is the only folder things may be extracted "downward" into; it must never
 * import from `bdi/`, `pddl/`, `llm/`, or `coordination/`.
 *
 * Intended files (added in task 0.2):
 *   - logger.ts   — leveled logger (debug|info|warn|error), optional emitLog bridge.
 *   - errors.ts   — AgentError → PlanFailedError | PlannerError | SensingError | LlmError.
 *   - result.ts   — Result<T, E> discriminated union + helpers.
 */

export {};
