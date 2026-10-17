#!/usr/bin/env bash
# Brings the whole local stack up and exposes it through a temporary
# Cloudflare tunnel, for demos from a laptop. macOS (caffeinate, BSD sed).
# Prints the public URL; donor links in new messages point at it.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 || true)
PORT=${PORT:-3000}

# Stop old copies. A Temporal worker drains in-flight work on SIGTERM and can
# hang there; a stale worker would keep writing the old URL into donor links,
# so anything still alive after 10s is killed.
stop() {
  pkill -f "$1" || true
  for _ in $(seq 1 10); do pgrep -f "$1" >/dev/null || return 0; sleep 1; done
  pkill -9 -f "$1" || true
}
stop "cloudflared tunnel"
stop "src/temporal/worker.ts"
stop "src/api/server.ts"

pgrep -f "ollama serve" >/dev/null || (nohup ollama serve >ollama.log 2>&1 &)
pgrep -f "temporal server" >/dev/null || (nohup temporal server start-dev --log-level warn --db-filename .temporal.db >temporal.log 2>&1 &)
until temporal operator cluster health --address 127.0.0.1:7233 >/dev/null 2>&1; do sleep 1; done

# Quick-tunnel names are hyphenated words; the strict pattern avoids matching
# api.trycloudflare.com in an error line. Retry if cloudflared gives up.
URL=""
for attempt in 1 2 3 4 5; do
  : >tunnel.log
  nohup cloudflared tunnel --url "http://localhost:$PORT" >tunnel.log 2>&1 &
  TUNNEL_PID=$!
  for _ in $(seq 1 45); do
    URL=$(grep -oE 'https://[a-z0-9]+(-[a-z0-9]+)+\.trycloudflare\.com' tunnel.log | head -1 || true)
    [ -n "$URL" ] && break 2
    kill -0 "$TUNNEL_PID" 2>/dev/null || break
    sleep 1
  done
  echo "Tunnel attempt $attempt failed, retrying..." >&2
  kill "$TUNNEL_PID" 2>/dev/null || true
  sleep 3
done
[ -n "$URL" ] || { echo "Could not open a tunnel; check the network and rerun." >&2; exit 1; }

# Donor links in outreach messages must use the public URL.
if grep -q '^PUBLIC_BASE_URL=' .env; then
  sed -i '' -E "s#^PUBLIC_BASE_URL=.*#PUBLIC_BASE_URL=$URL#" .env
else
  echo "PUBLIC_BASE_URL=$URL" >>.env
fi
# Keep a local post draft pointing at the current link.
[ -f POST.md ] && sed -i '' -E "s#https://[a-z0-9-]+\.trycloudflare\.com#$URL#g" POST.md

nohup npm run worker >worker.log 2>&1 &
nohup npm run api >api.log 2>&1 &
until grep -q "listening" api.log 2>/dev/null; do sleep 1; done

pkill -f "caffeinate -dims" || true
nohup caffeinate -dims -w "$TUNNEL_PID" >/dev/null 2>&1 &

echo "Live: $URL"
