#!/usr/bin/env bash
# Brings the whole local stack up and exposes it through a temporary
# Cloudflare tunnel, for demos from a laptop. macOS (caffeinate, BSD sed).
# Prints the public URL; donor links in new messages point at it.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 || true)
PORT=${PORT:-3000}

pkill -f "cloudflared tunnel" || true
pkill -f "src/temporal/worker.ts" || true
pkill -f "src/api/server.ts" || true

pgrep -f "ollama serve" >/dev/null || (nohup ollama serve >ollama.log 2>&1 &)
pgrep -f "temporal server" >/dev/null || (nohup temporal server start-dev --log-level warn --db-filename .temporal.db >temporal.log 2>&1 &)
until temporal operator cluster health --address 127.0.0.1:7233 >/dev/null 2>&1; do sleep 1; done

: >tunnel.log
nohup cloudflared tunnel --url "http://localhost:$PORT" >tunnel.log 2>&1 &
URL=""
until [ -n "$URL" ]; do
  sleep 1
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' tunnel.log | head -1 || true)
done

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
nohup caffeinate -dims -w "$(pgrep -f 'cloudflared tunnel' | head -1)" >/dev/null 2>&1 &

echo "Live: $URL"
