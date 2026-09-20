# Mean Reversion Tracker

A private web app that shows whether a stock is trading **below** (underpriced) or **above** (overpriced) its recent range.

For a ticker and a moving-average window (3m, 6m, 1y, 3y, 5y or 10y), it plots:

- **Close**: daily adjusted close from Yahoo Finance (`yfinance`)
- **Moving average**: mean of the closes over the trailing window
- **25th / 75th percentile**: percentiles of the closes over the same trailing window (the shaded band)

Each date uses only the closes up to that date, so there's no look-ahead. Hover over the chart to see all four values for a date. The badge shows where the latest close sits: below p25 → *Underpriced*, above p75 → *Overpriced*, otherwise *Within range*.

Windows are measured in trading days: 3m = 63, 6m = 126, 1y = 252, 3y = 756, 5y = 1260, 10y = 2520.

## Access control

The site is locked down. Every `/api` call needs a token.

- **You (owner)**: the `ADMIN_KEY` env var. Open `https://<your-app>/?t=<ADMIN_KEY>` once. The token moves into the browser's localStorage and is removed from the address bar.
- **People you share with**: open `/admin`, type a name, click **Create link**, and send them the URL. It's shown only once because only a hash is stored. Each person has their own link. **Revoke** cuts off that person immediately, and the table shows when each link was last used.
- Anyone without a valid token sees "Access required".

To revoke *everything*, including your own sessions, rotate `ADMIN_KEY` and revoke all links.

## Project layout

```
backend/   FastAPI app (yfinance data, bands, SQLite share links) + pytest tests
frontend/  React + TypeScript + Vite, Plotly chart
scripts/   dev.sh — one-command local setup and run
.claude/   Claude Code config: the pr-readme skill and the hook that enforces it
Dockerfile Single container: builds the frontend and serves it from FastAPI
fly.toml   Fly.io deployment config
```

Before opening a pull request, README.md gets updated to match the branch. A
PreToolUse hook (`.claude/hooks/pr-readme-guard.sh`) stops `gh pr create` when
the branch has no README change; prefix the command with `PR_README_OK=1` when
no change is genuinely needed.

## Local development

Quick start — builds anything missing, generates an admin key on first run, and serves both the API and the UI on http://localhost:8000:

```bash
./scripts/dev.sh
```

It prints the URL to open (it includes your local admin key, kept in the gitignored `.admin_key`). Share links created locally live in `local.db`.

### Running the pieces by hand

Backend (Python 3.11+):

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/pytest
ADMIN_KEY=local-dev-admin-key-123456 .venv/bin/uvicorn --factory app.main:create_app --reload --port 8000
```

Frontend (Node 20+), in another terminal. Vite proxies `/api` to port 8000:

```bash
cd frontend
npm install
npm run dev
```

Then open `http://localhost:5173/?t=local-dev-admin-key-123456`.

To serve the production build from FastAPI instead, run `npm run build`. The backend serves `frontend/dist` automatically at `http://localhost:8000`.

## Deploy to Fly.io

```bash
brew install flyctl
fly auth login
fly launch --no-deploy --copy-config      # pick a unique app name
fly volumes create data --size 1          # persistent SQLite for share links
fly secrets set ADMIN_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
fly deploy
```

Get your admin key back with `fly ssh console -C 'printenv ADMIN_KEY'`, then open `https://<app>.fly.dev/?t=<ADMIN_KEY>`.

Notes:
- The machine auto-stops when idle, so the first request after a pause takes a few seconds.
- Price history is cached in memory for an hour per ticker (`CACHE_TTL_SECONDS`).
- Tickers use Yahoo Finance symbols, e.g. `AAPL`, `SPY`, `D05.SI`, `0700.HK`.
