#!/usr/bin/env bash
# Start the app locally: builds anything missing, then serves API + UI on :8000.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

# 1. Python environment
if [ ! -x backend/.venv/bin/uvicorn ]; then
  echo "==> Creating Python virtualenv"
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install -q --upgrade pip
fi
echo "==> Installing backend dependencies"
(cd backend && .venv/bin/pip install -q -e '.[dev]')

# 2. Frontend build (skipped if newer than sources)
if [ ! -d frontend/node_modules ]; then
  echo "==> Installing frontend dependencies"
  (cd frontend && npm install --silent)
fi
if [ ! -f frontend/dist/index.html ] || [ -n "$(find frontend/src frontend/index.html -newer frontend/dist/index.html 2>/dev/null)" ]; then
  echo "==> Building frontend"
  (cd frontend && npm run build)
fi

# 3. Optional overrides (ADMIN_KEY, DB_PATH, PORT) from a gitignored .env
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

# 4. Admin key, kept out of git
if [ -z "${ADMIN_KEY:-}" ] && [ ! -f .admin_key ]; then
  python3 -c 'import secrets; print(secrets.token_urlsafe(32))' > .admin_key
  chmod 600 .admin_key
  echo "==> Generated a new admin key in .admin_key"
fi
ADMIN_KEY="${ADMIN_KEY:-$(cat .admin_key)}"
DB_PATH="${DB_PATH:-$ROOT/local.db}"

PORT="${PORT:-8000}"
echo
echo "Open:  http://localhost:$PORT/?t=$ADMIN_KEY"
echo "Admin: http://localhost:$PORT/admin"
echo
exec env ADMIN_KEY="$ADMIN_KEY" DB_PATH="$DB_PATH" \
  backend/.venv/bin/uvicorn --factory app.main:create_app \
  --app-dir backend --host 127.0.0.1 --port "$PORT"
