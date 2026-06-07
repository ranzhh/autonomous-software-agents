/**
 * core/util — cross-cutting primitives shared by every other module, and the only
 * place code is extracted "downward" into; it must never import from `bdi/`,
 * `pddl/`, `llm/`, or `coordination/`. Exposes the leveled `Logger` (a console
 * sink plus an `emitLogSink` bridge to the SDK's `emitLog`), the `AgentError`
 * hierarchy, and the `Result<T, E>` type with its helpers.
 */

export {
  AgentError,
  type AgentErrorOptions,
  LlmError,
  PlanFailedError,
  PlannerError,
  SensingError,
} from "./errors.js";
export {
  consoleSink,
  createLogger,
  emitLogSink,
  LOG_LEVELS,
  type LogContext,
  type Logger,
  type LoggerOptions,
  type LogLevel,
  type LogSink,
  parseLogLevel,
} from "./logger.js";
export {
  type Err,
  err,
  isErr,
  isOk,
  type Ok,
  ok,
  type Result,
  unwrapOr,
} from "./result.js";
