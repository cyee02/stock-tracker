#!/usr/bin/env bash
# Build and (re)start this repo's Docker deployment on the Mac mini, then wait
# until the app is healthy. Run by .github/workflows/deploy.yml on the
# self-hosted runner, and safe to run by hand there:
#
#   ./deploy/deploy.sh
#
# Settings and keys come from the environment. Anything not already set is read
# from ~/.zshrc, because the Actions runner runs as a background service and
# never loads it. See deploy/zshrc.example.
#
# Secret values are never printed: only whether each one is set. Don't add
# `set -x` here; it would echo them.
#
# (Template from the macmini-deploy skill. Only the block below differs per repo.)
set -euo pipefail
cd "$(dirname "$0")/.."

# ---- Per-repo settings -------------------------------------------------------
# Never printed; masked in the Actions log and redacted from container logs.
SECRETS=(TS_AUTHKEY CLAUDE_CODE_OAUTH_TOKEN ADMIN_KEY)
# Printed as set / - only.
SETTINGS=(TS_EXTRA_ARGS TAILSCALE_ALLOWED_LOGINS TZ CLAUDE_MODEL ALERT_INTERVAL_SECONDS)
# Host folders the containers bind-mount; created before starting.
HOST_DIRS=()
# ------------------------------------------------------------------------------

# The compose project (and volume prefix) is the `name:` in docker-compose.yml.
PROJECT="$(sed -n 's/^name:[[:space:]]*//p' docker-compose.yml | head -1)"
if [ -z "$PROJECT" ]; then
  echo "!! docker-compose.yml needs a top-level 'name:'." >&2
  exit 1
fi

# 1. Fill in what the environment lacks from an interactive zsh (which reads
#    ~/.zshrc). Values come back NUL-separated on fd 3, straight into variables;
#    whatever ~/.zshrc prints on stdout/stderr is discarded.
missing=()
for name in "${SECRETS[@]}" "${SETTINGS[@]}"; do
  [ -n "${!name:-}" ] || missing+=("$name")
done
if [ ${#missing[@]} -gt 0 ] && [ -f "$HOME/.zshrc" ] && command -v zsh >/dev/null 2>&1; then
  i=0
  while IFS= read -r -d '' value; do
    name="${missing[$i]}"
    i=$((i + 1))
    if [ -n "$value" ]; then export "$name=$value"; fi
  done < <(zsh -ic 'for n in "$@"; do printf "%s\0" "${(P)n-}" >&3; done' zsh "${missing[@]}" \
             3>&1 1>/dev/null 2>/dev/null </dev/null || true)
fi

# 2. In GitHub Actions, register the secrets so the runner masks them in the
#    job log, in case anything below (e.g. a container log) ever prints one.
if [ "${GITHUB_ACTIONS:-}" = true ]; then
  for name in "${SECRETS[@]}"; do
    if [ -n "${!name:-}" ]; then echo "::add-mask::${!name}"; fi  # secret-ok: runner hides ::add-mask:: lines
  done
fi

# 3. Report presence only.
echo "==> $PROJECT settings"
for name in "${SECRETS[@]}" "${SETTINGS[@]}"; do
  if [ -n "${!name:-}" ]; then echo "    $name: set"; else echo "    $name: -"; fi
done

if ! docker info >/dev/null 2>&1; then
  echo "!! Docker isn't running. Start Docker Desktop (and set it to start at login)." >&2
  exit 1
fi
if [ -z "${TS_AUTHKEY:-}" ] && ! docker volume inspect "${PROJECT}_tailscale-state" >/dev/null 2>&1; then
  echo "!! TS_AUTHKEY isn't set, and the Tailscale sidecar has never logged in." >&2
  echo "   Export it in ~/.zshrc (see deploy/zshrc.example)." >&2
  exit 1
fi
for dir in "${HOST_DIRS[@]+"${HOST_DIRS[@]}"}"; do
  mkdir -p "$dir"
done

compose() { docker compose "$@"; }

# Masks the secrets' values (and anything shaped like a Tailscale or Claude
# key) in output we didn't write, such as container logs.
redact() {
  REDACT_NAMES="${SECRETS[*]}" awk '
    BEGIN { n = split(ENVIRON["REDACT_NAMES"], names, " ") }
    {
      for (i = 1; i <= n; i++) {
        s = ENVIRON[names[i]]
        if (s == "") continue
        while ((p = index($0, s)) > 0) $0 = substr($0, 1, p - 1) "[redacted]" substr($0, p + length(s))
      }
      gsub(/tskey-[A-Za-z0-9-]+|sk-ant-[A-Za-z0-9_-]+/, "[redacted]")
      print
    }'
}

echo "==> Building and starting"
compose up -d --build --remove-orphans 2>&1 | redact

echo "==> Waiting for the app to be healthy"
id="$(compose ps -q app)"
for i in $(seq 1 36); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || echo missing)"
  if [ "$status" = healthy ]; then
    break
  fi
  if [ "$i" = 36 ]; then
    echo "!! App is '$status' after 3 minutes. Recent logs:" >&2
    compose logs --tail 80 2>&1 | redact >&2
    exit 1
  fi
  sleep 5
done

echo "==> Tailnet endpoint"
compose exec -T tailscale tailscale serve status 2>&1 | redact || true

echo "==> Removing unused images"
docker image prune -f >/dev/null

echo "==> Deployed $PROJECT $(git rev-parse --short HEAD)"
