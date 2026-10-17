#!/usr/bin/env bash
# Stop serving to the tailnet: remove the `tailscale serve` endpoint, then stop
# the app behind it.
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v tailscale >/dev/null 2>&1; then
  echo "==> Removing the tailnet endpoint"
  tailscale serve --https=443 off >/dev/null 2>&1 || true
else
  echo "tailscale not found; skipping endpoint removal"
fi
exec ./scripts/stop.sh
