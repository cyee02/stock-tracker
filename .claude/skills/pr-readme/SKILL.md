---
name: pr-readme
description: Update this repo's README.md so it matches what the branch changed, before opening a pull request. Use whenever the user asks to create, open, or raise a PR (gh pr create), pushes a branch for review, or asks to refresh the README after changing features, API routes, env vars, dev commands, or deployment.
---

# PR README update

`README.md` is the only documentation for this app — it tells the owner how to
run it, how access control works, and how to deploy it. Every PR must leave it
true. Do this **before** `gh pr create`, not after.

## Steps

1. **See what the branch changed.**

   ```bash
   # symbolic-ref (not rev-parse): rev-parse echoes "origin/HEAD" back when unset.
   BASE=$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')
   BASE=${BASE:-master}
   git diff --name-status "origin/$BASE"...HEAD
   git status --porcelain
   ```

   Include uncommitted work — it ships with the PR.

2. **Decide which sections are affected.** Map changed files to README sections
   and only open the ones the diff touches:

   | Changed | Check this section |
   |---|---|
   | `backend/app/market.py` | The band/indicator explanation and the trading-day window table |
   | `backend/app/routes/*.py`, `auth.py`, `db.py` | "Access control" — how tokens, share links and revocation behave |
   | `backend/app/config.py` | Env var names and defaults (`ADMIN_KEY`, `DB_PATH`, `CACHE_TTL_SECONDS`, `STATIC_DIR`) |
   | `frontend/src/**` | What the site shows: inputs, chart lines, hover, badge wording |
   | `scripts/dev.sh`, `pyproject.toml`, `package.json` | "Local development" commands |
   | `Dockerfile`, `fly.toml`, `.dockerignore` | "Deploy to Fly.io" steps and notes |
   | Files added/moved/deleted | The project layout tree |

   If the diff is purely internal (refactors, tests, styling with no visible
   change), leave the README alone and say so. Do not invent churn.

3. **Read `README.md`** and edit only those sections. Keep the existing voice:
   plain sentences, second person, no marketing adjectives, no emoji. Commands
   go in their own ```bash fences.

4. **Verify every claim you leave behind.** Anything the README asserts must be
   checkable, so check it:

   - Every command still runs as written (paths, flags, file names).
   - Every env var named in the README exists in `backend/app/config.py`, and
     every required one is documented.
   - Every path or file mentioned exists (`ls` it).
   - Numbers match the code — e.g. the trading-day windows in the README must
     equal `PERIOD_WINDOWS` in `backend/app/market.py`, and the default cache
     TTL must match `config.py`.

   Prefer reading the code over trusting the old README: it may already be
   stale.

5. **Never put secrets in it.** Real admin keys, share-link tokens, and the
   contents of `.admin_key` stay out of the README. Placeholders only
   (`<ADMIN_KEY>`).

6. **Commit and open the PR.** Put the README change on the branch — in the
   related commit, or a `docs: update README` commit — then create the PR and
   mention the README update in its body.

## Checks before finishing

- `git diff origin/$BASE...HEAD -- README.md` shows only changes the branch
  justifies.
- No section describes behaviour that is not on this branch.
- The layout tree matches the folders on disk.
- Reading the README top to bottom would let someone clone the repo, run the
  app locally, and deploy it without asking a question.
