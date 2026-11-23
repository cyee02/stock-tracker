#!/usr/bin/env bash
# Replace the Mac mini deployment's database with another copy, e.g. the
# local.db you used before Docker. Run on the Mac mini after the first
# successful deploy:
#
#   ./deploy/import-db.sh ~/Downloads/stock-tracker-data/app.db
#
# The current database is backed up to ~/stock-tracker-backups/ first.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${1:-}"
if [ -z "$SRC" ] || [ ! -f "$SRC" ]; then
  echo "Usage: $0 <path to app.db or local.db>" >&2
  exit 1
fi
SRC_DIR="$(cd "$(dirname "$SRC")" && pwd)"
SRC_NAME="$(basename "$SRC")"
VOLUME=stock-tracker_app-data
IMAGE=stock-tracker:latest
BACKUPS="$HOME/stock-tracker-backups"

compose() { docker compose -p stock-tracker "$@"; }

if ! docker volume inspect "$VOLUME" >/dev/null 2>&1 || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "!! No deployment found. Deploy once first (push to main, or ./deploy/deploy.sh)." >&2
  exit 1
fi

# Runs a throwaway container with the data volume at /data and $2 at /host.
on_volume() { docker run --rm -v "$VOLUME:/data" -v "$1:/host" --entrypoint sh "$IMAGE" -c "$2"; }

echo "==> Checking $SRC_NAME"
docker run --rm -i -v "$SRC_DIR:/host:ro" --entrypoint python "$IMAGE" - "/host/$SRC_NAME" <<'PY'
import sqlite3, sys
try:
    c = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
    ok = c.execute("pragma integrity_check").fetchone()[0]
    tables = {r[0] for r in c.execute("select name from sqlite_master where type='table'")}
except sqlite3.DatabaseError as exc:
    sys.exit(f"!! Not a SQLite database ({exc})")
if ok != "ok" or "watchlist" not in tables:
    sys.exit(f"!! Not a healthy stock-tracker database ({ok})")
counts = [f"{t}: {c.execute(f'select count(*) from {t}').fetchone()[0]}"
          for t in ("watchlist", "saved_summaries", "share_links") if t in tables]
print("    " + ", ".join(counts))
PY

echo "==> Stopping the app"
compose stop app

mkdir -p "$BACKUPS"
stamp="$(date +%Y%m%d-%H%M%S)"
echo "==> Backing up the current database to $BACKUPS/app-$stamp.db"
on_volume "$BACKUPS" "if [ -f /data/app.db ]; then cp /data/app.db /host/app-$stamp.db; fi"

echo "==> Importing"
# Drop the old write-ahead log too: replayed onto the new file it would corrupt it.
on_volume "$SRC_DIR" "rm -f /data/app.db-wal /data/app.db-shm && cp '/host/$SRC_NAME' /data/app.db"

echo "==> Starting the app"
compose start app
id="$(compose ps -q app)"
for i in $(seq 1 24); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || echo missing)"
  if [ "$status" = healthy ]; then
    echo "==> Done. To undo: $0 $BACKUPS/app-$stamp.db"
    exit 0
  fi
  sleep 5
done
echo "!! The app isn't healthy after 2 minutes: docker compose -p stock-tracker logs app" >&2
echo "   To undo: $0 $BACKUPS/app-$stamp.db" >&2
exit 1
