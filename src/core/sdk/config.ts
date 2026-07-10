/**
 * Environment/config loading. `loadDotEnv()` pulls a `.env` file into
 * `process.env` (best-effort), and `loadConfig()` reads a typed `AgentConfig` from
 * an environment with safe, non-secret fallbacks and validated enums. Secrets
 * (game tokens, LLM key) come only from the environment — never hardcoded.
 */

import { type LogLevel, parseLogLevel } from "../util/index.js";

export type PlannerMode = "reactive" | "pddl";
export type PddlSolver = "remote" | "local";

export interface AgentConfig {
  readonly host: string;
  readonly name: string | undefined;
  readonly tokenBdi: string | undefined;
  readonly tokenLlm: string | undefined;
  readonly logLevel: LogLevel;
  readonly planner: PlannerMode;
  readonly pddlSolver: PddlSolver;
  /** Full remote solve endpoint (PDDL_SOLVER_URL); solver default when unset. */
  readonly pddlSolverUrl: string | undefined;
  /** Local planner command (PDDL_LOCAL_CMD); solver default when unset. */
  readonly pddlLocalCmd: string | undefined;
}

const DEFAULT_HOST = "http://localhost:8080";

/**
 * Load environment variables from a `.env` file into `process.env`, if one
 * exists. Missing/unreadable file is fine — we then rely on the ambient env.
 */
export function loadDotEnv(path = ".env"): void {
  try {
    process.loadEnvFile(path);
  } catch {
    // No .env file (or unreadable) — rely on the ambient environment.
  }
}

function oneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return value !== undefined && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** `undefined` for an absent or blank variable, else the trimmed value. */
function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed !== "" ? trimmed : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const get = (key: string): string | undefined => nonEmpty(env[key]);
  return {
    host: get("HOST") ?? DEFAULT_HOST,
    name: get("NAME"),
    tokenBdi: get("TOKEN_BDI"),
    tokenLlm: get("TOKEN_LLM"),
    logLevel: parseLogLevel(get("LOG_LEVEL")),
    planner: oneOf(get("PLANNER"), ["reactive", "pddl"] as const, "reactive"),
    pddlSolver: oneOf(
      get("PDDL_SOLVER"),
      ["remote", "local"] as const,
      "remote",
    ),
    pddlSolverUrl: get("PDDL_SOLVER_URL"),
    pddlLocalCmd: get("PDDL_LOCAL_CMD"),
  };
}
