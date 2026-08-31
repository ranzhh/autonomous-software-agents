import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { log } from "../log.js";

const run = promisify(execFile);

export interface Solver {
  solve(domain: string, problem: string): Promise<string[] | undefined>;
}

export const fastDownward = (bin: string, seconds = 5): Solver => ({
  async solve(domain, problem) {
    const dir = await mkdtemp(join(tmpdir(), "tour-"));
    try {
      await writeFile(join(dir, "domain.pddl"), domain);
      await writeFile(join(dir, "problem.pddl"), problem);
      await run(
        resolve(bin),
        [
          "--overall-time-limit",
          `${seconds}s`,
          "--plan-file",
          "plan",
          "domain.pddl",
          "problem.pddl",
          "--search",
          "astar(lmcut())",
        ],
        { cwd: dir, timeout: (seconds + 1) * 1_000 },
      );
      const plan = await readFile(join(dir, "plan"), "utf8");
      return plan.split("\n").filter((line) => line.startsWith("("));
    } catch (error) {
      log.warn({ err: `${error}` }, "solver failed");
      return undefined;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
});
