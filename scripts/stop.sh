#!/usr/bin/env bash
# Stop the local app (whatever is listening on the app port).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -z "${PORT:-}" ] && [ -f .env ] && PORT="$(sed -n 's/^PORT=//p' .env | tail -1 | tr -d "\"'")"
PORT="${PORT:-8000}"

pids="$(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [ -z "$pids" ]; then
  echo "Nothing is listening on port $PORT"
  exit 0
fi
echo "==> Stopping the app on port $PORT"
kill $pids 2>/dev/null || true
for _ in $(seq 1 20); do
  lsof -ti "tcp:$PORT" -sTCP:LISTEN >/dev/null 2>&1 && sleep 0.5 || { echo "==> Stopped"; exit 0; }
done
kill -9 $pids 2>/dev/null || true
echo "==> Stopped (forced)"
