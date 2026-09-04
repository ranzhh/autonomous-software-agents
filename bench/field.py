# /// script
# requires-python = ">=3.11"
# ///
"""Teams on every map, spawn order shuffled per attempt.

    uv run bench/field.py --team pddl,pddl --team naive --missions bench/missions/example.json
    uv run bench/field.py greedy naive deliberate        # each on a team of its own
    uv run bench/field.py --team pddl,llm --team pddl,pddl --maps 26c1_3 --attempts 4

A team is `--team a,b`; a bare agent is a team of one. Agents spawn in list
order and the first placement draw goes to the first agent, so attempt k
spawns them in a shuffled order, drawn from the distinct orders and fixed by
lineup, map and attempt count. Results land in
bench/results/<campaign>/<map>/attempt-<k>/<map>__<order>__s<seed>/, the
campaign defaulting to the lineup, e.g. pddl+pddl_vs_naive.
"""

import argparse
import itertools
import random
from pathlib import Path

from campaign import DURATION, MAPS, SEED, SEEDS, bench

parser = argparse.ArgumentParser(
    description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
)
parser.add_argument("agents", nargs="*", help="bare agents, each a team of its own")
parser.add_argument("--team", action="append", default=[], help="comma-separated agents sharing a team")
parser.add_argument("--maps", default=",".join(MAPS), help="comma-separated names or files")
parser.add_argument("--missions", help="JSON list of { t, text }, shouted to everyone t seconds in")
parser.add_argument("--attempts", type=int, default=3)
parser.add_argument("--campaign", help="results directory under bench/results; defaults to the lineup")
parser.add_argument("--time", type=int, default=DURATION)
parser.add_argument("--seed", type=int, default=SEED)
parser.add_argument("--seeds", type=int, default=SEEDS, help="how many consecutive seeds")
parser.add_argument("--parallel", type=int, default=1)
args = parser.parse_args()

# bench.ts tokens: `agent@teamN` for a listed team, bare for a team of one.
teams = [t.split(",") for t in args.team]
members = [f"{a}@team{k}" for k, team in enumerate(teams, start=1) for a in team]
members += args.agents
if not members:
    parser.error("name at least one agent or --team")
lineup = "_vs_".join(["+".join(t) for t in teams] + args.agents)
campaign = args.campaign or lineup


def orders(key: str) -> list[list[str]]:
    """Distinct spawn orders, one per attempt, reproducible per key."""
    distinct = sorted(set(itertools.permutations(members)))
    rng = random.Random(f"{lineup}:{key}:{args.attempts}")
    rng.shuffle(distinct)
    return [list(order) for order in distinct[: args.attempts]]


extra = ["--missions", args.missions] if args.missions else []
for m in args.maps.split(","):
    label = Path(m).name.removesuffix(".json")
    for k, order in enumerate(orders(m), start=1):
        bench(
            order,
            [m],
            campaign=f"{campaign}/{label}/attempt-{k}",
            time=args.time,
            seed=args.seed,
            seeds=args.seeds,
            parallel=args.parallel,
            extra=extra,
        )
