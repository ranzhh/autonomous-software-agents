rundir := ".run"

default:
    @just --list

# Start an agent in the background, under an identity of its own if one is named
deploy agent="dumb" identity=agent:
    @if pgrep -f "src/agents/[^ ]*[.]ts {{identity}}" > /dev/null; then echo "{{identity}} is already deployed; stop it first"; exit 1; fi
    @mkdir -p {{rundir}}
    @TOKEN=$(just token {{identity}}); TOKEN=$TOKEN nohup npx tsx --env-file-if-exists=.env src/agents/{{agent}}.ts {{identity}} > {{rundir}}/{{identity}}.log 2>&1 &
    @echo "deployed {{ if identity == agent { agent } else { agent + " as " + identity } }}, logging to {{rundir}}/{{identity}}.log"

# Print an agent's token, minting an identity of its own on first use
token agent="dumb" *flags="":
    @npx tsx --env-file-if-exists=.env src/token.ts {{agent}} {{flags}}

# Agents in teams, one fresh seeded server per run, over the suite or the given maps.
# A bare agent is a team of one; --team a,b shares one:
#   just bench naive deliberate --time 120 --runs 3 --seed 42 --map maps/bench.json
#   just bench --team pddl,pddl --team naive --map 26c1_3 --missions bench/missions/example.json
bench *args:
    @npx tsx --env-file-if-exists=.env src/bench.ts {{args}}

# One agent alone on every map, seeds 42..44, 150 s
solo agent:
    @uv run bench/solo.py {{agent}}

# Teams on every map, spawn order shuffled per attempt: just field --team pddl,pddl --team naive
field *args:
    @uv run bench/field.py {{args}}

# Stop a deployed agent
stop identity="dumb":
    @pkill -f "src/agents/[^ ]*[.]ts {{identity}}" && echo "stopped {{identity}}" || echo "{{identity}} is not deployed"
    @while pgrep -f "src/agents/[^ ]*[.]ts {{identity}}" > /dev/null; do sleep 0.1; done

# Follow a deployed agent's log
logs identity="dumb":
    @tail -f {{rundir}}/{{identity}}.log | npx pino-pretty
