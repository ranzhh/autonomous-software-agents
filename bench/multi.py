"""Several agents on one map, spawn order shuffled per attempt.

The base of competition.py (each agent on its own team) and collaboration.py
(one team, a director issuing missions over chat). Agents spawn in list order
and the first placement draw goes to the first agent, so attempt k spawns them
in a shuffled order, distinct across attempts and fixed by map and k. Results
land in bench/results/<mode>/<map>/attempt-<k>/<map>__<a+b+c>__s<seed>/.
"""

import argparse
import itertools
import random
from pathlib import Path

from campaign import DURATION, MAPS, SEED, SEEDS, bench


def orders(agents: list[str], key: str, attempts: int) -> list[list[str]]:
    """Distinct shuffles of the agents, one per attempt, reproducible per key."""
    distinct = sorted(set(itertools.permutations(agents)))
    rng = random.Random(f"{key}:{attempts}")
    rng.shuffle(distinct)
    return [list(order) for order in distinct[:attempts]]


def main(mode: str, default_agents: list[str], *, missions: bool) -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("maps", nargs="*", default=MAPS)
    parser.add_argument("--agents", default=",".join(default_agents))
    parser.add_argument("--attempts", type=int, default=3)
    parser.add_argument("--time", type=int, default=DURATION)
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--seeds", type=int, default=SEEDS, help="how many consecutive seeds")
    parser.add_argument("--parallel", type=int, default=1)
    if missions:
        parser.add_argument(
            "--missions",
            default="bench/missions/example.json",
            help="JSON list of { t, text }, told to every agent t seconds in",
        )
    args = parser.parse_args()

    extra = ["--teams", "shared" if mode == "collaboration" else "separate"]
    if missions:
        extra += ["--missions", args.missions]
    agents = args.agents.split(",")
    for m in args.maps:
        label = Path(m).name.removesuffix(".json")
        for k, order in enumerate(orders(agents, m, args.attempts), start=1):
            bench(
                order,
                [m],
                campaign=f"{mode}/{label}/attempt-{k}",
                time=args.time,
                seed=args.seed,
                seeds=args.seeds,
                parallel=args.parallel,
                extra=extra,
            )
