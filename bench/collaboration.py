# /// script
# requires-python = ">=3.11"
# ///
"""Team up the agents on a map, with a director issuing missions over chat.

    uv run bench/collaboration.py [map ...] [--agents pddl,pddl] [--missions file.json] [--attempts 3] [--time 150] [--seed 42] [--seeds 3] [--parallel 1]

All agents share one team. An admin "director" on that team tells each of them
every mission in the file at its second; each run records what it sent in
missions.ndjson and every agent logs what it heard. See multi.py for the
spawn-order attempts and the results layout.
"""

from multi import main

main("collaboration", ["pddl", "pddl"], missions=True)
