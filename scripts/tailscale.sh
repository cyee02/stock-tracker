#!/usr/bin/env bash
# Serve the app to your tailnet only: uvicorn on loopback, `tailscale serve`
# in front of it terminating HTTPS and attaching the caller's tailnet identity.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
PORT="${PORT:-8000}"

if ! command -v tailscale >/dev/null 2>&1; then
  echo "tailscale not found. Install it (brew install --cask tailscale) and run 'tailscale up' first." >&2
  exit 1
fi
if ! tailscale status >/dev/null 2>&1; then
  echo "Tailscale is installed but not connected. Run 'tailscale up' first." >&2
  exit 1
fi

# 1. Build (same steps as dev.sh, skipped when already current)
if [ ! -x backend/.venv/bin/uvicorn ]; then
  echo "==> Creating Python virtualenv"
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install -q --upgrade pip
fi
echo "==> Installing backend dependencies"
(cd backend && .venv/bin/pip install -q -e '.[dev]')
if [ ! -d frontend/node_modules ]; then
  echo "==> Installing frontend dependencies"
  (cd frontend && npm install --silent)
fi
if [ ! -f frontend/dist/index.html ] || [ -n "$(find frontend/src frontend/index.html -newer frontend/dist/index.html 2>/dev/null)" ]; then
  echo "==> Building frontend"
  (cd frontend && npm run build)
fi

# 2. Point Tailscale at the local port and tear that down on exit, so quitting
#    the script actually stops serving rather than leaving a live endpoint.
cleanup() {
  echo
  echo "==> Removing the tailnet endpoint"
  tailscale serve --https=443 off >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo "==> Publishing to the tailnet"
tailscale serve --bg --https=443 "http://127.0.0.1:$PORT" >/dev/null
URL="https://$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"

echo
echo "Open:  $URL"
echo "Admin: $URL/admin"
echo
echo "Reachable only from devices signed in to your tailnet. No access key needed."
echo

# 3. Loopback bind, no --proxy-headers: both are load-bearing for the identity
#    header check in app/auth.py. Do not add them here.
exec env TAILSCALE_AUTH=1 \
  TAILSCALE_ALLOWED_LOGINS="${TAILSCALE_ALLOWED_LOGINS:-}" \
  DB_PATH="$ROOT/local.db" \
  backend/.venv/bin/uvicorn --factory app.main:create_app \
  --app-dir backend --host 127.0.0.1 --port "$PORT"
