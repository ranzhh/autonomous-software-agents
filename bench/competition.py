# /// script
# requires-python = ">=3.11"
# ///
"""Race every agent on a map, each on its own team.

    uv run bench/competition.py [map ...] [--agents a,b] [--attempts 3] [--time 150] [--seed 42] [--seeds 3] [--parallel 1]

See multi.py for the spawn-order attempts and the results layout.
"""

from campaign import AGENTS
from multi import main

main("competition", AGENTS, missions=False)
