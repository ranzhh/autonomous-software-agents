/**
 * The `Solver` seam: `solve(domain, problem) → steps | null` (null = no plan),
 * throwing `PlannerError` on infrastructure failure. Two implementations
 * behind `PDDL_SOLVER=remote|local` (ADR-0002/ADR-0007):
 *
 *   - `RemoteSolver` — the course path: pddl-client's `onlineSolver` against
 *     solver.planning.domains (satisficing, ~3 s). The library reads its
 *     endpoint from `PAAS_HOST`/`PAAS_PATH` at module load, so a configured
 *     URL is exported to those env vars before the lazy import. Its polling
 *     loop never gives up on its own — we race it against a timeout.
 *   - `LocalSolver` — optional enhancement: a planner CLI (pyperplan, optimal,
 *     ~tens of ms) spawned via child_process on temp files, no Docker.
 *
 * Returned plans are upper-cased by the solvers (CLAUDE.md §6) → every step is
 * normalized to lowercase here, once, so downstream mapping is case-safe.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlannerError } from "../core/util/index.js";

/** One solved plan step, lowercase (e.g. `{ action: "move", args: ["l_0_0", "l_2_0"] }`). */
export interface PddlStep {
  readonly action: string;
  readonly args: readonly string[];
}

export interface Solver {
  /** Stable identifier for logging ("remote" / "local"). */
  readonly name: string;
  /**
   * Solve the problem. Resolves to the lowercase plan steps, or `null` when
   * the solver finished but found no plan. Throws `PlannerError` on timeout,
   * unreachable solver, or unparseable output.
   */
  solve(
    domainText: string,
    problemText: string,
  ): Promise<readonly PddlStep[] | null>;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Default local command, matching `.env.example` (optimal A* + LM-cut). */
export const DEFAULT_LOCAL_CMD = "./.venv-pddl/bin/pyperplan -s astar -H lmcut";

function lowercaseStep(step: {
  action: string;
  args: readonly string[];
}): PddlStep {
  return {
    action: step.action.toLowerCase(),
    args: step.args.map((a) => a.toLowerCase()),
  };
}

async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  what: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new PlannerError(`${what} timed out after ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// RemoteSolver — course onlineSolver baseline
// ---------------------------------------------------------------------------

type OnlineSolverFn = (
  domain: string,
  problem: string,
) => Promise<Array<{ action: string; args: string[] }> | undefined>;

export interface RemoteSolverOptions {
  /** Full solve endpoint (e.g. `https://host:5001/package/dual-bfws-ffparser/solve`). */
  readonly url?: string | undefined;
  /** Overall solve deadline. Default 15 s. */
  readonly timeoutMs?: number | undefined;
  /** Injectable solver function (tests); defaults to pddl-client's `onlineSolver`. */
  readonly solverFn?: OnlineSolverFn | undefined;
}

export class RemoteSolver implements Solver {
  readonly name = "remote";
  private readonly timeoutMs: number;
  private readonly solverFn: OnlineSolverFn | undefined;

  constructor(options: RemoteSolverOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.solverFn = options.solverFn;
    if (options.url !== undefined) {
      // pddl-client reads these at module load; the import below is lazy, so
      // setting them here (before any solve) makes the configured URL win.
      const url = new URL(options.url);
      process.env.PAAS_HOST = url.origin;
      process.env.PAAS_PATH = `${url.pathname}${url.search}`;
    }
  }

  async solve(
    domainText: string,
    problemText: string,
  ): Promise<readonly PddlStep[] | null> {
    const fn =
      this.solverFn ?? (await import("@unitn-asa/pddl-client")).onlineSolver;
    try {
      const raw = await withTimeout(
        fn(domainText, problemText),
        this.timeoutMs,
        "remote PDDL solve",
      );
      if (raw === undefined) return null;
      return raw.map(lowercaseStep);
    } catch (error) {
      if (error instanceof PlannerError) throw error;
      throw new PlannerError("remote PDDL solve failed", { cause: error });
    }
  }
}

// ---------------------------------------------------------------------------
// LocalSolver — planner CLI over temp files (pyperplan)
// ---------------------------------------------------------------------------

export interface LocalSolverOptions {
  /** Planner command; the domain and problem file paths are appended as the
   * last two arguments. Default {@link DEFAULT_LOCAL_CMD}. */
  readonly cmd?: string | undefined;
  /** Kill the planner process after this long. Default 15 s. */
  readonly timeoutMs?: number | undefined;
}

/**
 * Parse a pyperplan `.soln` file: one `(action arg …)` per line, any casing.
 * Blank/non-parenthesized lines are ignored.
 */
export function parseSolutionText(text: string): PddlStep[] {
  const steps: PddlStep[] = [];
  for (const line of text.split("\n")) {
    const match = line.trim().match(/^\((.+)\)$/);
    if (match === null || match[1] === undefined) continue;
    const tokens = match[1].trim().split(/\s+/);
    const [action, ...args] = tokens;
    if (action === undefined || action === "") continue;
    steps.push(lowercaseStep({ action, args }));
  }
  return steps;
}

export class LocalSolver implements Solver {
  readonly name = "local";
  private readonly cmd: string;
  private readonly timeoutMs: number;

  constructor(options: LocalSolverOptions = {}) {
    this.cmd = options.cmd ?? DEFAULT_LOCAL_CMD;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async solve(
    domainText: string,
    problemText: string,
  ): Promise<readonly PddlStep[] | null> {
    const dir = await mkdtemp(join(tmpdir(), "deliveroo-pddl-"));
    const domainPath = join(dir, "domain.pddl");
    const problemPath = join(dir, "problem.pddl");
    const solutionPath = `${problemPath}.soln`;

    try {
      await writeFile(domainPath, domainText, "utf8");
      await writeFile(problemPath, problemText, "utf8");

      const [bin, ...args] = this.cmd.split(/\s+/);
      if (bin === undefined || bin === "") {
        throw new PlannerError(`invalid local solver command "${this.cmd}"`);
      }

      const execError = await new Promise<Error | null>((resolve) => {
        execFile(
          bin,
          [...args, domainPath, problemPath],
          { timeout: this.timeoutMs },
          (error) => resolve(error),
        );
      });

      // The solution file is the ground truth: pyperplan writes it iff a plan
      // was found. A missing file + a process error = infrastructure failure;
      // a missing file + clean exit = genuinely unsolvable.
      let solutionText: string;
      try {
        solutionText = await readFile(solutionPath, "utf8");
      } catch {
        if (execError !== null) {
          throw new PlannerError(
            `local PDDL solver failed: ${execError.message}`,
            { cause: execError },
          );
        }
        return null;
      }
      return parseSolutionText(solutionText);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface SolverConfig {
  readonly pddlSolver: "remote" | "local";
  readonly pddlSolverUrl?: string | undefined;
  readonly pddlLocalCmd?: string | undefined;
}

/** Build the configured `Solver` (`PDDL_SOLVER=remote|local`). */
export function createSolver(config: SolverConfig): Solver {
  switch (config.pddlSolver) {
    case "remote":
      return new RemoteSolver({ url: config.pddlSolverUrl });
    case "local":
      return new LocalSolver({ cmd: config.pddlLocalCmd });
  }
}
