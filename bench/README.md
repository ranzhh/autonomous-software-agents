# Benchmarks

One run is one fresh server on one map with one seed, one agent, and a fixed
number of seconds counted from the moment the agent appears on the grid. An
admin observer with no position snapshots every agent and parcel once a second.

Runs need the server patched for seeding: `deliveroo-seed.patch` gives each of
the game's random draws (parcel reward, spawn tile, agent placement, NPC moves)
its own stream derived from `SEED`. With `SEED` unset the server behaves as
upstream. Apply it from the Deliveroo.js root with `patch -p1 < bench/deliveroo-seed.patch`.

Point `DELIVEROO_SERVER` (in `.env`) at the server's `backend/` directory.

```sh
npx tsx --env-file-if-exists=.env bench/run.ts --map 26c1_3 --seed 1 --agent greedy --duration 300
npx tsx --env-file-if-exists=.env bench/pilot.ts --maps 26c1_3,26c1_1 --repeats 5 --seeds 1,2,3,4,5
uv run bench/analysis/pilot.py bench/results/pilot
```

Each run directory holds `meta.json` (map, seed, agent id, server revision,
final score and penalty, the server config), `observer.ndjson` (one snapshot
per second: all agents with position, score, penalty; all parcels with
position, reward, carrier), `agent.log` (the agent's own NDJSON log, every
acked action with its result and latency) and `server.log` (which reports FPS
and event-loop lag once a minute, the check that the machine kept real time).
