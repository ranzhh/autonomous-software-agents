rundir := ".run"

default:
    @just --list

# Start an agent in the background
deploy agent="dumb":
    @mkdir -p {{rundir}}
    @TOKEN=$(just token {{agent}}) nohup npx tsx --env-file-if-exists=.env src/agents/{{agent}}.ts > {{rundir}}/{{agent}}.log 2>&1 &
    @echo "deployed {{agent}}, logging to {{rundir}}/{{agent}}.log"

# Print an agent's token, minting an identity of its own on first use
token agent="dumb" *flags="":
    @npx tsx --env-file-if-exists=.env src/token.ts {{agent}} {{flags}}

# Stop a deployed agent
stop agent="dumb":
    @pkill -f "src/agents/{{agent}}[.]ts" && echo "stopped {{agent}}" || echo "{{agent}} is not deployed"

# Follow a deployed agent's log
logs agent="dumb":
    @tail -f {{rundir}}/{{agent}}.log | npx pino-pretty
