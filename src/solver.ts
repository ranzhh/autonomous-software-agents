import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { env } from "./env.js";

const run = promisify(execFile);

// driver/returncodes.py: 10 unsolvable in translation, 11 proved unsolvable
// in search, 12 search exhausted without a proof (lama-first answers this).
const NO_PLAN = [10, 11, 12];

const TIMEOUT_MS = 30_000;

/**
 * Run a local Fast Downward (`just planner` installs one). Returns the plan
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
    try {
      await run(
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
        { timeout: TIMEOUT_MS },
      );
    } catch (error) {
      const { code, stderr, stdout } = error as {
        code?: number | string;
        stderr?: string;
        stdout?: string;
      };
      if (typeof code === "number" && NO_PLAN.includes(code)) return undefined;
      throw new Error(
        `fast-downward failed (${code}): ${stderr?.trim() || stdout?.trim().slice(-500)}`,
      );
    }
    return await readFile(plan, "utf8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
