"""What the campaigns share: the maps, the defaults, and how to call bench.ts."""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# suite.ts's five asset maps. The local maps under maps/ are for development.
MAPS = ["empty_10", "26c1_3", "crates_one_way", "crates_maze", "26c1_4"]

SEED = 42
SEEDS = 3
DURATION = 150


def bench(
    agents: list[str],
    maps: list[str],
    *,
    campaign: str,
    time: int,
    seed: int,
    seeds: int,
    parallel: int,
) -> None:
    """One bench.ts invocation: the lineup on every map, seeds seed..seed+seeds-1."""
    cmd = [
        "npx", "tsx", "--env-file-if-exists=.env", "src/bench.ts", *agents,
        "--time", str(time), "--runs", str(seeds), "--seed", str(seed),
        "--parallel", str(parallel), "--campaign", campaign,
    ]
    for m in maps:
        cmd += ["--map", m]
    print("$", " ".join(cmd), file=sys.stderr, flush=True)
    subprocess.run(cmd, cwd=ROOT, check=True)
