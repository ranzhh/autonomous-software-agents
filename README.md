# rbmr-asa-2026

Autonomous agents for [Deliveroo.js](../Deliveroo.js/README.md), the grid-based
parcel-collection game used in the Autonomous Software Agents course at the
University of Trento. Agents connect to a running server through
`@unitn-asa/deliveroo-js-sdk`, sense the grid, and pick up and deliver
parcels; the benchmark in `bench/` measures them on seeded servers.

## Getting started

Requires Node, [`just`](https://github.com/casey/just), and a Deliveroo.js
server (from `Deliveroo.js/`: `npm install`, then `npm start`, which listens on
`http://localhost:8080`). The `pddl` agent also needs
[Fast Downward](https://www.fast-downward.org/) on `PATH` or at `$FAST_DOWNWARD`;
the `llm` agent needs an OpenAI-compatible endpoint at `$LLM_URL`.

```sh
npm install                     # also applies patches/ to the SDK
printf "NAME=me\nTEAM=me\n" > .env  # HOST defaults to localhost:8080; all keys in src/env.ts
just deploy deliberate          # start an agent in the background
just logs deliberate            # follow its log
just stop deliberate
npm test                        # vitest
npm run check                   # biome + tsc
```

Benchmarks (`just bench`, `just solo`, `just field`) are described in
[bench/README.md](bench/README.md).

## Agents

All live in `src/agents/` and share the scaffold in `src/agent.ts`.

- `dumb`: walks in a random direction every tick; the baseline.
- `greedy`: moves to the nearest visible parcel until at capacity, then to the nearest delivery tile.
- `naive`: recomputes one action per step from its beliefs: pick up here, deliver what it carries, chase the nearest known parcel, else head for the spawners.
- `deliberate`: keeps an intention chosen by reward decayed over distance and rival odds, and only switches when a challenger clears a margin.
- `pddl`: deliberates like `deliberate` but executes whole plans from Fast Downward, replanning when the intention or the board changes.
- `bdi`: the full sense-believe-deliberate-act executive, with standing orders and a two-agent team that shares beliefs and roles over the team channel.
- `llm`: the same executive, but an LLM reads chat missions and the current view and issues the orders.
