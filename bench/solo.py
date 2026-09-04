# /// script
# requires-python = ">=3.11"
# ///
"""Score one agent alone on every map.

    uv run bench/solo.py deliberate [--maps a,b] [--time 150] [--seed 42] [--seeds 3] [--parallel 2]

Seeds 42, 43, 44, 150 s each, one fresh server per run. Results land in
bench/results/solo/<agent>/<map>__<agent>__s<seed>/.
"""

import argparse

from campaign import DURATION, MAPS, SEED, SEEDS, bench

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument("agent", help="script basename in src/agents/")
parser.add_argument("--maps", default=",".join(MAPS), help="comma-separated names or files")
parser.add_argument("--time", type=int, default=DURATION)
parser.add_argument("--seed", type=int, default=SEED)
parser.add_argument("--seeds", type=int, default=SEEDS, help="how many consecutive seeds")
parser.add_argument("--parallel", type=int, default=2)
args = parser.parse_args()

bench(
    [args.agent],
    args.maps.split(","),
    campaign=f"solo/{args.agent}",
    time=args.time,
    seed=args.seed,
    seeds=args.seeds,
    parallel=args.parallel,
)
