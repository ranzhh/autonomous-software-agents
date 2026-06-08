/**
 * Pure helpers for the `npm run token` CLI tool: argument parsing and response
 * validation. Split from `mint-token.ts` so they can be unit-tested without
 * hitting the network.
 */

import { AgentError } from "../util/index.js";

export interface TokenArgs {
  readonly name: string;
  readonly team: string;
}

/**
 * Parse `process.argv` into `{ name, team }`.
 * `argv[2]` is the agent name (required); `argv[3]` is the team name (optional,
 * defaults to the agent name so a solo mint still creates a named team).
 */
export function parseTokenArgs(argv: readonly string[]): TokenArgs {
  const name = argv[2]?.trim();
  if (!name) {
    throw new AgentError(
      "Usage: npm run token -- <name> [team]\n  <name> is required.",
    );
  }
  const team = argv[3]?.trim() || name;
  return { name, team };
}

/**
 * Extract the token string from the server response.
 * Throws `AgentError` when the response is not `{ token: string }`.
 */
export function extractToken(data: unknown): string {
  if (
    data !== null &&
    typeof data === "object" &&
    "token" in data &&
    typeof (data as Record<string, unknown>).token === "string"
  ) {
    return (data as { token: string }).token;
  }
  throw new AgentError(`Unexpected token response: ${JSON.stringify(data)}`);
}
