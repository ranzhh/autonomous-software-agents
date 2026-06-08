/**
 * The AgentError hierarchy — one base for every error our code raises, so callers
 * can tell "our" failures (`instanceof AgentError`) from unexpected ones and
 * handle specific kinds by subclass. The standard `cause` option is supported for
 * error chaining; `name` is set automatically to the concrete subclass.
 */

export interface AgentErrorOptions {
  readonly cause?: unknown;
}

export class AgentError extends Error {
  constructor(message: string, options?: AgentErrorOptions) {
    super(
      message,
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    );
    // new.target is the concrete subclass being constructed.
    this.name = new.target.name;
  }
}

/** A reactive/PDDL plan could not be carried out (e.g. repeated move failures). */
export class PlanFailedError extends AgentError {}

/** The PDDL problem could not be built or solved. */
export class PlannerError extends AgentError {}

/** Sensing/belief-revision received malformed or unusable perception. */
export class SensingError extends AgentError {}

/** The LLM call, parsing, or tool execution failed. */
export class LlmError extends AgentError {}
