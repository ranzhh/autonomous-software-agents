# /// script
# requires-python = ">=3.11"
# ///
"""Race every agent on a map, spawn order shuffled per attempt.

    uv run bench/competition.py [map ...] [--agents a,b] [--attempts 3] [--time 150] [--seed 42] [--seeds 3] [--parallel 1]

Without maps, every map in the suite. Agents spawn in
list order and the first placement draw goes to the first agent, so attempt k
spawns them in a shuffled order, distinct across attempts and fixed by map and
k. Results land in
bench/results/competition/<map>/attempt-<k>/<map>__<a+b+c>__s<seed>/.
"""

import argparse
import random
from pathlib import Path

from campaign import AGENTS, DURATION, MAPS, SEED, SEEDS, bench

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument("maps", nargs="*", default=MAPS)
parser.add_argument("--agents", default=",".join(AGENTS))
parser.add_argument("--attempts", type=int, default=3)
parser.add_argument("--time", type=int, default=DURATION)
parser.add_argument("--seed", type=int, default=SEED)
parser.add_argument("--seeds", type=int, default=SEEDS, help="how many consecutive seeds")
parser.add_argument("--parallel", type=int, default=1)
args = parser.parse_args()

agents = args.agents.split(",")


def orders(map_name: str, attempts: int) -> list[list[str]]:
    """Distinct shuffles of the agents, one per attempt, reproducible per map."""
    rng = random.Random(f"{map_name}:{attempts}")
    seen: list[list[str]] = []
    while len(seen) < attempts:
        order = agents[:]
        rng.shuffle(order)
        if order not in seen:
            seen.append(order)
    return seen


for m in args.maps:
    label = Path(m).name.removesuffix(".json")
    for k, order in enumerate(orders(m, args.attempts), start=1):
        bench(
            order,
            [m],
            campaign=f"competition/{label}/attempt-{k}",
            time=args.time,
            seed=args.seed,
            seeds=args.seeds,
            parallel=args.parallel,
        )
