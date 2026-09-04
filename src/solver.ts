import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "./env.js";

// driver/returncodes.py: 10 unsolvable in translation, 11 proved unsolvable
// in search, 12 search exhausted without a proof (lama-first answers this).
const NO_PLAN = [10, 11, 12];

const TIMEOUT_MS = 30_000;

/** Process group leaders of the solves in flight. */
const running = new Set<number>();

// fast-downward.py is a driver: the search itself is a grandchild of ours, and
// signalling the driver alone leaves it running for good. Each solve gets a
// process group of its own, killed whole on timeout and on the way out.
function killGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group finished between the timeout and the signal.
  }
}

// agent.ts exits through process.exit on SIGINT and SIGTERM, which runs this.
process.once("exit", () => {
  for (const pid of running) killGroup(pid);
});

/**
 * Run a local Fast Downward, found on PATH or at $FAST_DOWNWARD. Returns the plan
 * text, one `(action ...)` line per step; undefined when the planner finds
 * no plan.
 */
export async function solve(
  domain: string,
  problem: string,
): Promise<string | undefined> {
  const dir = await mkdtemp(join(tmpdir(), "downward-"));
  try {
    const plan = join(dir, "plan");
    await writeFile(join(dir, "domain.pddl"), domain);
    await writeFile(join(dir, "problem.pddl"), problem);
    const solver = spawn(
      env.FAST_DOWNWARD,
      [
        // The translator's output defaults to ./output.sas, so concurrent
        // solves would read each other's problem. Keep it in this dir.
        "--sas-file",
        join(dir, "output.sas"),
        "--alias",
        "lama-first",
        "--plan-file",
        plan,
        join(dir, "domain.pddl"),
        join(dir, "problem.pddl"),
      ],
      { detached: true },
    );
    let stdout = "";
    let stderr = "";
    solver.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    solver.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const exited = new Promise<number | null>((resolve, reject) => {
      solver.once("error", reject);
      solver.once("close", resolve);
    });

    const group = solver.pid;
    if (group) running.add(group);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (group) killGroup(group);
    }, TIMEOUT_MS);
    let code: number | null;
    try {
      code = await exited;
    } finally {
      clearTimeout(timer);
      if (group) running.delete(group);
    }

    if (timedOut)
      throw new Error(`fast-downward timed out after ${TIMEOUT_MS / 1000}s`);
    if (code !== 0) {
      if (code !== null && NO_PLAN.includes(code)) return undefined;
      throw new Error(
        `fast-downward failed (${code}): ${stderr.trim() || stdout.trim().slice(-500)}`,
      );
    }
    return await readFile(plan, "utf8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
