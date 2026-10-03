#!/usr/bin/env bash
# Restart the local app on whatever branch is checked out: pull that branch's
# new commits, stop the running copy, then start dev.sh again in the background
# (it rebuilds whatever changed). Logs go to .app.log.
#
#   ./scripts/restart.sh            restart once and open the browser
#   ./scripts/restart.sh --watch    also check every minute and restart when the
#                                   branch gets new commits or you switch branch
#   ./scripts/restart.sh --no-open  don't open the browser
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
# Same port dev.sh will use: the environment, then .env, then 8000.
[ -z "${PORT:-}" ] && [ -f .env ] && PORT="$(sed -n 's/^PORT=//p' .env | tail -1 | tr -d "\"'")"
PORT="${PORT:-8000}"
LOG="$ROOT/.app.log"
INTERVAL="${WATCH_INTERVAL:-60}"

WATCH=0
OPEN=1
for arg in "$@"; do
  case "$arg" in
    --watch) WATCH=1 ;;
    --no-open) OPEN=0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

branch() { git rev-parse --abbrev-ref HEAD; }
has_upstream() { git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; }

pull() {
  if ! has_upstream; then
    echo "==> $(branch) has no remote branch; using local commits"
    return
  fi
  git fetch --quiet || { echo "!! git fetch failed; using local commits"; return; }
  if ! git merge --ff-only --quiet '@{u}' 2>/dev/null; then
    echo "!! Could not fast-forward $(branch) (local changes or diverged); using local commits"
  fi
}

stop() {
  local pids
  pids="$(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  [ -z "$pids" ] && return
  echo "==> Stopping the app on port $PORT"
  kill $pids 2>/dev/null || true
  for _ in $(seq 1 20); do
    lsof -ti "tcp:$PORT" -sTCP:LISTEN >/dev/null 2>&1 || return 0
    sleep 0.5
  done
  kill -9 $pids 2>/dev/null || true
}

start() {
  echo "==> Starting $(branch) @ $(git rev-parse --short HEAD) (log: .app.log)"
  PORT="$PORT" nohup ./scripts/dev.sh >"$LOG" 2>&1 </dev/null &
  # First start after a dependency change can take a while (pip, npm, build).
  for _ in $(seq 1 240); do
    if curl -sf "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
      local url
      url="$(sed -n 's/^Open: *//p' "$LOG" | head -1)"
      echo "==> Running: ${url:-http://localhost:$PORT/}"
      return 0
    fi
    sleep 0.5
  done
  echo "!! The app didn't come up. Last lines of .app.log:" >&2
  tail -20 "$LOG" >&2
  return 1
}

restart() {
  pull
  stop
  start
}

restart
if [ "$OPEN" = 1 ] && command -v open >/dev/null 2>&1; then
  url="$(sed -n 's/^Open: *//p' "$LOG" | head -1)"
  open "${url:-http://localhost:$PORT/}"
fi

[ "$WATCH" = 1 ] || exit 0

echo "==> Watching for new commits every ${INTERVAL}s (Ctrl-C stops watching; the app keeps running)"
seen="$(branch)@$(git rev-parse HEAD)"
while sleep "$INTERVAL"; do
  if has_upstream && git fetch --quiet 2>/dev/null &&
    [ "$(git rev-list --count 'HEAD..@{u}')" -gt 0 ]; then
    git merge --ff-only --quiet '@{u}' 2>/dev/null || true
  fi
  now="$(branch)@$(git rev-parse HEAD)"
  if [ "$now" != "$seen" ]; then
    echo
    echo "==> $(date '+%H:%M') change detected: $now"
    restart || true
    seen="$(branch)@$(git rev-parse HEAD)"
  fi
done
