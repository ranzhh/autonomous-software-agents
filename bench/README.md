# Benchmarks

One run is one fresh server on one map with one seed, one or more agents, and
a fixed number of seconds counted from the moment the last agent appears on
the grid. An
admin observer with no position snapshots every agent and parcel once a second.

Runs need the server patched for seeding: `deliveroo-seed.patch` gives each of
the game's random draws (parcel reward, spawn tile, agent placement, NPC moves)
its own stream derived from `SEED`. With `SEED` unset the server behaves as
upstream. Apply it from the Deliveroo.js root with `patch -p1 < bench/deliveroo-seed.patch`,
and `deliveroo-team.patch` the same way.

The map suite is `suite.ts`; the pilot runs it by default, `--maps` narrows it.

Point `DELIVEROO_SERVER` (in `.env`) at the server's `backend/` directory.

```sh
just bench greedy deliberate --time 300 --runs 5 --seed 1        # the suite, seeds 1..5
just bench deliberate --map 26c1_3 --map maps/bench.json --time 120
npx tsx --env-file-if-exists=.env bench/pilot.ts --maps 26c1_3,26c1_1 --repeats 5 --seeds 1,2,3,4,5
uv run bench/analysis/pilot.py bench/results/pilot
```

Several agents in one run race on the same server under separate identities.

Every agent plays on a team: a bare agent is a team of one, `--team a,b`
shares one, and `a@red` names it. Members of a team share the server's team,
so competition is teams of one, collaboration is one team, and a field of
teams is both at once.

```sh
just bench naive deliberate --map 26c1_3 --time 120      # two teams of one
just bench --team pddl,pddl --map crates_maze --missions bench/missions/example.json
```

The campaigns are `solo.py`, one agent alone on every map, and `field.py`,
a lineup on every map with the spawn order shuffled per attempt. Both use
seeds 42, 43, 44 and 150 s, and list their maps in `campaign.py`. Neither
assumes a lineup.

```sh
just solo deliberate                                   # bench/results/solo/deliberate/
just field greedy naive deliberate pddl                # bench/results/greedy_vs_naive_vs_deliberate_vs_pddl/
just field --team pddl,pddl --missions bench/missions/example.json
just field --team pddl,llm --team pddl,pddl --maps 26c1_3 --attempts 4
```

Missions are a JSON list of `{ t, text }`; at second `t` an admin "director"
shouts the text, a bare string, so every connected client hears it. The run
records each one in `missions.ndjson` as `shouted`, along with anything an
agent says back to the director as `heard`; every agent's log records what
it received as `heard`.
`meta.json` keeps each agent's team and the server's `teamId`.

A shared team needs the server patched as well: the token route never
inherited a teammate's `teamId` (an operator-precedence slip), so
`deliveroo-team.patch` fixes that. Apply it like the seed patch.

Each run directory holds `meta.json` (map, seed, agent id, server revision,
final score and penalty, the server config), `observer.ndjson` (one snapshot
per second: all agents with position, score, penalty; all parcels with
position, reward, carrier), one `<name>.log` per agent (its own NDJSON log,
every acked action with its result and latency) and `server.log` (which reports FPS
and event-loop lag once a minute, the check that the machine kept real time).
