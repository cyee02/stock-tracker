#!/usr/bin/env bash
# Restart the tailnet-served app after a code change: stop the endpoint and the
# app, then run start-tailscale.sh again in the background (it rebuilds whatever
# changed). Logs go to .tailscale.log.
#
#   ./scripts/restart-tailscale.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
PORT="${PORT:-8000}"
LOG="$ROOT/.tailscale.log"

./scripts/stop-tailscale.sh

echo "==> Starting (log: $LOG)"
nohup ./scripts/start-tailscale.sh >"$LOG" 2>&1 </dev/null &
pid=$!
disown

# The first start may need to install dependencies and build the frontend.
for _ in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    grep -a -E '^(Open|Admin):' "$LOG" || true
    echo "==> Up"
    exit 0
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "!! The app exited. Last log lines:" >&2
    tail -n 20 "$LOG" >&2
    exit 1
  fi
  sleep 1
done
echo "!! Timed out waiting for the app. See $LOG" >&2
exit 1
