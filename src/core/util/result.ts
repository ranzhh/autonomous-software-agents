/**
 * Result<T, E> — a discriminated union for operations that can fail in an
 * *expected* way, so thrown errors stay reserved for the truly exceptional. The
 * error type defaults to the project's `AgentError`. Pair the guards
 * (`isOk`/`isErr`) for type-narrowing and `unwrapOr` for a safe fallback.
 */

import type { AgentError } from "./errors.js";

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E = AgentError> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok;

export const isErr = <T, E>(result: Result<T, E>): result is Err<E> =>
  !result.ok;

/** The value when `ok`, otherwise the provided fallback. */
export const unwrapOr = <T, E>(result: Result<T, E>, fallback: T): T =>
  result.ok ? result.value : fallback;
