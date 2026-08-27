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

# Race agents under fresh identities: just bench dumb naive --time 120 --map m.json
bench *args="dumb naive":
    @npx tsx --env-file-if-exists=.env src/bench.ts {{args}}

# Stop a deployed agent
stop identity="dumb":
    @pkill -f "src/agents/[^ ]*[.]ts {{identity}}" && echo "stopped {{identity}}" || echo "{{identity}} is not deployed"
    @while pgrep -f "src/agents/[^ ]*[.]ts {{identity}}" > /dev/null; do sleep 0.1; done

# Follow a deployed agent's log
logs identity="dumb":
    @tail -f {{rundir}}/{{identity}}.log | npx pino-pretty
