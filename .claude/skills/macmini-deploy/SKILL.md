---
name: macmini-deploy
description: Deploy this repo to the Mac mini through GitHub. Merging to main runs the tests on GitHub, then a self-hosted runner on the Mac mini rebuilds the Docker containers and serves the app on the tailnet at https://<repo>.<tailnet>.ts.net. Use when the user asks to deploy, ship, release, merge to main or "push to the mac mini"; to check whether a deploy worked or why it failed; or to set up (dockerize) a repo for this kind of deployment.
---

# Deploy to the Mac mini through GitHub

Each web app runs on the Mac mini in Docker, as two containers per repo:

- **`tailscale`**: a sidecar that joins the tailnet as its own machine, named
  after the repo, and serves HTTPS with `tailscale serve`.
- **`app`**: shares the sidecar's network namespace and listens on
  `127.0.0.1:<port>`. No host port is published. Tailscale is the only way in,
  so `Tailscale-User-Login` headers (if the app reads them) can be trusted.

A push to `main` runs `.github/workflows/deploy.yml`:
1. A **`test`** job on `ubuntu-latest` runs the repo's checks.
2. If they pass, a **`deploy`** job on the repo's self-hosted runner on the Mac
   mini (labels `self-hosted, macOS, macmini`) checks out the commit and runs
   `./deploy/deploy.sh`.

`deploy.sh` reads keys from the environment or `~/.zshrc`, runs
`docker compose up -d --build`, waits for the `app` healthcheck, then waits
until the sidecar has logged in and is serving. If the sidecar can't log in, the
deploy fails with the reason and the sidecar's log (keys redacted). Data
lives in named volumes (`<repo>_app-data`) or host folders, so it survives
redeploys.

Keys never go to GitHub. Follow the `no-secret-leaks` skill: never print a key
value, and check presence only.

## A. Deploy a change (day to day)

1. **Branch and commit.** Never commit straight to `main`.
   ```bash
   git switch -c <type>/<short-name>      # feat/…, fix/…, chore/…
   git add -A && git commit -m "…"
   git push -u origin HEAD
   ```
2. **Open the PR** with `gh pr create --base main …`. Follow any PR skill the
   repo has (e.g. a README check). Run the repo's tests locally first. The
   `test` job runs them again, and a failure blocks the deploy.
3. **Merge when the user asks**, using the repo's existing merge style (look at
   `git log --merges`): `gh pr merge <n> --merge`. The merge to `main` *is* the
   deploy trigger.
4. **Watch it.**
   ```bash
   run=$(gh run list --branch main --workflow deploy.yml --limit 1 --json databaseId -q '.[0].databaseId')
   gh run watch "$run" --exit-status
   ```
   If `deploy` stays *queued*, the Mac mini's runner for this repo is offline
   (see D).
5. **On failure**, read the failed step:
   `gh run view "$run" --log-failed | tail -60`. `deploy.sh` prints settings as
   `set` / `-` only. Never ask the user to paste key values. Fix the cause,
   then either merge the fix or re-run with `gh run rerun "$run" --failed`.
6. **Report**: the run's result, the commit deployed, and the app address
   `https://<repo>.<tailnet>.ts.net`.

Manual deploy on the Mac mini (same script): `./deploy/deploy.sh` from a
checkout of `main`.

## B. Set up a new repo for this

Copy the files in `templates/` (next to this file) and fill in the
placeholders. `__APP__` is the repo name, which is also the tailnet machine
name. `__APP_ENV__` is the same name uppercased with `-` as `_` (for
`TS_AUTHKEY___APP_ENV__`, e.g. `TS_AUTHKEY_MQF_SHORTS`). `__PORT__` is the port
the app listens on inside the container.

| Template | Goes to | What to change |
|---|---|---|
| `docker-compose.yml` | `docker-compose.yml` | `__APP__`, `__APP_ENV__`, `__PORT__`. Add the app's env vars, and only the ones it needs. Never pass `ANTHROPIC_API_KEY` through by accident. Change the healthcheck command if the image has no `node` (e.g. use `python -c "import urllib.request…"`). Add host bind mounts for big media that isn't in git. |
| `tailscale-serve.json` | `deploy/tailscale-serve.json` | `__PORT__` |
| `deploy.sh` | `deploy/deploy.sh` (`chmod +x`) | Only the *Per-repo settings* block: `SECRETS`, `SETTINGS`, `HOST_DIRS`. The app's `TS_AUTHKEY_<REPO>` is added automatically from the compose `name:`. |
| `deploy.yml` | `.github/workflows/deploy.yml` | The `test` job: this repo's real tests, typecheck or build |
| `zshrc.example` | `deploy/zshrc.example` | `__APP_ENV__`; add any app-specific variables |

Then write the `Dockerfile`:

- Pin base images to a major version (`node:24-slim`, `python:3.12-slim`) and
  build the frontend in a separate stage.
- The app must bind **127.0.0.1**. Set `HOST=127.0.0.1` (or the equivalent)
  in the Dockerfile or compose file.
- If the app shells out to the Claude CLI, install it with
  `curl -fsSL https://claude.ai/install.sh | bash -s stable`, then set
  `PATH=/root/.local/bin:$PATH` and `DISABLE_AUTOUPDATER=1`. Pass
  `CLAUDE_CODE_OAUTH_TOKEN` at run time; that uses the subscription.
- Add `tzdata`, and pass `TZ` through, if anything depends on the local date.
- Never put keys in `ARG`/`ENV`.

Write a `.dockerignore` as well. Prefer an allowlist (`*` then `!path`) for
repos with large untracked media, so gigabytes don't get sent to the build.
Always exclude `.git`, `.env*`, local data and `node_modules`.

Data:
- App state goes in a named volume (`app-data:/data`), with the app pointed at
  `/data`.
- Large media that lives only on the user's machines (not in git) goes in a
  host folder under `$HOME` on the Mac mini, bind-mounted read-only. Add it to
  `HOST_DIRS`, and add a sync script (`rsync` over SSH) so the user can push
  new files.
- For existing data, give the user a way to import it: copy a snapshot into
  the volume while the app is stopped, and back up what's there first.

Verify before opening the PR:
```bash
docker compose build                                   # image builds
python3 .claude/skills/no-secret-leaks/scan.py         # no leaks (if that skill is present)
```
Smoke-test the image: run the app container with the same command and env,
then `docker exec` a request to `127.0.0.1:<port>`. If the app reads
`Tailscale-User-Login`, check that it accepts the header over loopback and
ignores it when `Tailscale-Funnel-Request` is present. Remove test containers,
images and volumes afterwards.

Document it in the repo's README: the address, the one-time Mac mini steps
(section C), data import, logs, and stop/start.

## C. One-time Mac mini setup per repo (the user does this)

The Mac mini already has automatic login, Docker Desktop starting at login,
and the shared keys in `~/.zshrc` (from `zshrc.example`). For each new repo:

1. **Register a runner for that repo.** Runners on a personal account belong
   to one repo, so each repo gets its own runner folder on the Mac mini. On
   GitHub: repo → Settings → Actions → Runners → **New self-hosted runner** →
   macOS / ARM64. Download it into its own folder, then:
   ```bash
   mkdir -p ~/actions-runner/<repo> && cd ~/actions-runner/<repo>
   # …the download + tar commands GitHub shows…
   ./config.sh --url https://github.com/<owner>/<repo> --token <TOKEN> \
     --name macmini-<repo> --labels macmini --unattended
   ./svc.sh install && ./svc.sh start
   ```
   Without `--unattended`, `config.sh` asks for a runner group. Press Enter
   for `Default`. The token expires after an hour. Check that
   `~/actions-runner/<repo>/.path` includes Docker's folder (`which docker`).
2. **Tailscale key.** Each app has its own key, `TS_AUTHKEY_<REPO>` in
   `~/.zshrc` (uppercased, `-` as `_`: `TS_AUTHKEY_MQF_SHORTS`). A one-off key
   logs in one machine only. The first deploy of the app uses it. After that,
   the sidecar's identity lives in the `<repo>_tailscale-state` volume and the
   key isn't needed again (`TS_AUTH_ONCE`). After the first deploy, go to the
   Tailscale admin console → the new machine → **Disable key expiry**.
3. **Public repos only**: Settings → Actions → General → require approval for
   fork PR workflows from all external contributors. A fork's workflow must
   never reach the self-hosted runner.

## D. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `deploy` queued for a long time | That repo's runner is offline: `cd ~/actions-runner/<repo> && ./svc.sh status`. It only runs while the user is logged in. |
| `docker: command not found`, `error getting credentials` | The runner's `.path` is missing Docker's folder. Fix it, then `./svc.sh stop && ./svc.sh start`. |
| Every setting shows `-` | The keys aren't in `~/.zshrc`, or `~/.zshrc` returns early. Check presence only: `env -i HOME="$HOME" PATH=/usr/bin:/bin zsh -ic 'for v in TS_AUTHKEY_<REPO> CLAUDE_CODE_OAUTH_TOKEN; do [ -n "${(P)v}" ] && echo "$v: set" \|\| echo "$v: MISSING"; done' 2>/dev/null` |
| "The Tailscale sidecar isn't serving" (state `NeedsLogin` or not running) | `TS_AUTHKEY_<REPO>` was missing, expired or already used. Put in a new key, run `docker volume rm <repo>_tailscale-state`, and redeploy. |
| Same, state `NeedsMachineAuth` | The tailnet requires device approval: approve the `<repo>` machine in the admin console. |
| Same, state `Running` | It's logged in but not serving: turn on HTTPS Certificates (admin console → DNS). |
| App container exits with 132 | Docker Desktop is too old for the CPU. Update it. |
| App unhealthy | `docker compose -p <repo> logs --tail 80 app`. If you show these logs, pipe them through the redaction in `deploy.sh`. |

Useful commands on the Mac mini (run from the repo checkout, or add
`-p <repo>`):
```bash
docker compose -p <repo> ps                 # status
docker compose -p <repo> logs -f app        # logs
docker compose -p <repo> stop / start       # pause / resume
docker compose -p <repo> down               # remove containers, keep data (never add -v)
```
