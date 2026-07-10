// Stand-in for the pyperplan CLI in offline LocalSolver tests. Mirrors the
// real contract: invoked as `<cmd> <domain> <problem>`, writes the plan to
// `<problem>.soln` when one is "found". Modes (first argv after the script):
//   solve    → writes an upper-cased two-step plan
//   unsolv   → exits cleanly without writing a .soln (no plan exists)
//   crash    → exits non-zero without writing a .soln
import { writeFileSync } from "node:fs";

const [mode, , problemPath] = process.argv.slice(2);

if (mode === "solve") {
  writeFileSync(
    `${problemPath}.soln`,
    "(MOVE L_0_0 L_2_0)\n(PICKUP P_P1 L_2_0)\n\n",
    "utf8",
  );
  process.exit(0);
}
if (mode === "unsolv") process.exit(0);
process.exit(3);
