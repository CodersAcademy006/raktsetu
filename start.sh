#!/usr/bin/env bash
# Starts every process the app needs; if any one exits, the container exits
# so the platform restarts it rather than serving half a system.
set -euo pipefail
mkdir -p "$HOME/data"

ollama serve >/tmp/ollama.log 2>&1 &
temporal server start-dev --headless --ip 127.0.0.1 --port 7233 \
  --db-filename "$HOME/data/temporal.db" --log-level warn >/tmp/temporal.log 2>&1 &

for _ in $(seq 1 60); do
  temporal operator cluster health --address "$TEMPORAL_ADDRESS" >/dev/null 2>&1 && break
  sleep 1
done

# Load Gemma into memory now so the first real request isn't the slow one.
(curl -sf "$OLLAMA_URL/api/generate" -d "{\"model\":\"$GEMMA_MODEL\",\"prompt\":\"hi\",\"stream\":false}" >/dev/null || true) &

node --import tsx src/temporal/worker.ts &
node --import tsx src/api/server.ts &

wait -n
echo "A process exited; shutting down so the container restarts." >&2
exit 1
