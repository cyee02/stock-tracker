# Stock Tracker

A private web app for looking at a stock's price through a few simple strategies. The **Charts** tab has one view per strategy, each with a short description of how to read it.

**Candlestick** (the default view) draws daily open/high/low/close candles: green when the close is above the open, red when below. A row of dots under the candles marks the trading days that have news headlines (bigger dots mean more stories), the way Bloomberg's charts show news events. Hover any day to see its prices and the first few headlines; click it to open the News tab for that day. A day's news includes everything published since the previous session, so a Monday also shows the weekend's stories. The dots come from Google News searches for `"<company name>" stock`; each search returns at most 100 stories by relevance, so the dots show the top stories rather than every one.

**Mean reversion** shows whether a stock is trading **below** (underpriced) or **above** (overpriced) its recent range. For a ticker and a window (3m, 6m, 1y, 3y, 5y or 10y), it plots:

- **Close**: daily adjusted close from Yahoo Finance (`yfinance`)
- **Moving average**: mean of the closes over the trailing window
- **25th / 75th percentile**: percentiles of the closes over the same trailing window (the shaded band)

Each date uses only the closes up to that date, so there's no look-ahead. Hover over the chart to see all four values for a date. The badge shows where the latest close sits: below p25 → *Underpriced*, above p75 → *Overpriced*, otherwise *Within range*.

**50/200 SMA** is a trend-following view. It plots the close with its 50-day SMA (intermediate momentum) and 200-day SMA (long-term momentum), and marks every **golden cross** (50 crosses above 200, bullish ▲) and **death cross** (50 crosses below 200, bearish ▼) in the history. The badge says whether the 50-day is currently above or below the 200-day, and the card shows the most recent cross. A cross needs the 50-day to move strictly from one side of the 200-day to the other; touching doesn't count. These windows are fixed, so the window picker only affects mean reversion. The selected strategy is kept in the URL (`?strategy=sma-cross`).

Above the chart, an overview card shows the ticker's name, type and description from Yahoo, its NAV (ETFs report one; for mutual funds the quoted price is the NAV), and YTD / 1Y / 5Y / 10Y total returns (5Y and 10Y also annualized). Returns are measured from the last close on or before each period's start and include dividends, because they use the adjusted close. A period shows "—" when the history doesn't go back far enough.

For stocks, the overview card also shows the **next earnings date** from Yahoo's calendar, with a countdown in days. When the company hasn't confirmed it yet, Yahoo only has an estimated window, which is shown as a range marked *est.* ETFs, funds and indices have no earnings date, so nothing is shown for them.

Below the overview, tabs switch between **Charts**, **Financials** (stocks only) and **News**. The News tab lists the latest headlines Yahoo Finance has for the ticker (via `yfinance`), newest first, with publisher, age, a short summary and a link to the full article. The selected tab is kept in the URL (`?tab=news`), so a link can open straight to the news. Clicking a day on the candlestick chart shows that day's headlines instead, from Google News, because Yahoo only keeps the latest stories; the date is kept in the URL too (`?tab=news&news_date=2024-08-01`). **Latest news** goes back to Yahoo's feed.

## Financials

For stocks, the **Financials** tab (`?tab=financials`) shows the company's results from Yahoo's statements. ETFs, funds and indices have no statements, so they don't get the tab. A **Quarterly | Annual** toggle switches between the last five or so quarters and the last four fiscal years; Yahoo keeps no more than that.

- **Key ratios**: valuation (P/E, forward P/E, PEG, P/B, P/S, EV/EBITDA), profitability (gross, operating and net margin, ROE, ROA), growth, financial health (debt/equity, current and quick ratio, free cash flow) and shareholder returns (dividend yield, payout ratio, beta, market cap). Each has an ⓘ that explains what it measures and how to read it; hover or tap it.
- **Charts**: revenue and profit, margins, expenses by type, EPS against the analyst estimate (beat or miss, last four quarters), cash flow, and cash against debt.
- **Statements table**: every line item by period, with the change from the same period a year earlier (YoY), or from the previous quarter (QoQ) when Yahoo doesn't go back that far.

Periods are named by the month they end ("Jun '26"), because fiscal quarters rarely match calendar ones. Banks and insurers report no gross profit or cost breakdown, so they show net interest income instead, and their expenses as revenue minus pre-tax income.

## Watchlist

**★ Watchlist** in the top bar (`/watchlist`) lists the tickers you save, with each one's latest session (open, high, low, close and the day's change), its 1-year mean-reversion signal with the 25th–75th percentile range, its 50/200-day SMA trend with the last cross, and its NAV (ETFs and funds) or next earnings date (stocks). Tap a ticker to open its chart.

Add tickers on that page, or with **☆ Add to Watchlist** next to **Plot** on the Charts page. The list is stored in the database, so it's the same on every device. Only the owner can add or remove tickers; share-link viewers see the owner's list.

Moving between Charts, Watchlist and AI Summaries doesn't reload the page, so the chart you were on (ticker, tab, chart type) is still there when you come back. The last ticker is also remembered on the device, so reopening the app starts on it.

## Price alerts

The server can send a push notification when a watchlist ticker's price crosses its 25th percentile, 1-year moving average or 75th percentile (the lines on the mean-reversion chart, 1-year window). Every `ALERT_INTERVAL_SECONDS` (default 300) it takes each watched ticker's live price from Yahoo and compares it with those lines. Tapping a notification opens that ticker's mean-reversion chart.

- A cross only counts once the price is 0.2% past the line, and the same line on the same ticker stays quiet for 3 hours after an alert, so a price hovering on a line doesn't keep alerting.
- A newly watched ticker only records which side of each line it's on; it alerts from the next cross.
- Recent alerts are listed under **Price alerts** on the Watchlist page.

Turn alerts on per device under **★ Watchlist → Price alerts → Turn on for this device**, then **Send test** to check. On an iPhone or iPad this only works in the app added to the Home Screen (see below), not in a Safari tab. On a Mac, Safari and Chrome both work; Chrome only shows them while it's running. Only the owner can turn alerts on.

Alerts use Web Push. The server makes its own signing key (VAPID) on first use and keeps it in the database, and the notifications travel through Apple's or Google's push service, so the phone doesn't need to be on the tailnet to receive them (opening the chart does). The checks run on the server, so nothing is checked while it's asleep. Set `ALERT_INTERVAL_SECONDS=0` to turn the checker off.

## Install on iPhone

The site is a web app you can add to the Home Screen. Open it in **Safari** (other iPhone browsers only add a bookmark), tap **Share → Add to Home Screen**, and it opens full screen with its own icon, named **Stocks**. On phones, a drag on a chart scrolls the page instead of zooming; use the range buttons or the slider to change dates.

A Home Screen app doesn't share storage with Safari, so a share-link token saved in Safari isn't known there. The access screen has a box to paste the link once. Behind Tailscale, the owner needs nothing: the tailnet identifies you.

## AI news summary

Above the headlines, **Summarize with Claude** asks Claude to read the news on screen (Yahoo's latest, or the chart day you clicked). Claude opens the most relevant articles, up to six, and writes a briefing:

- the **one-sentence takeaway**, next to the **sentiment of analysts and investors** (bullish / bearish / neutral / mixed, with a score from −1 to +1)
- the **top 3 happenings**, each marked positive, negative or neutral, with source links
- **bull and bear cases**, **risks**, and **catalysts** (including the next earnings date)
- **analyst consensus**: Claude's **buy / hold / sell** view with a confidence level, horizon and rationale, shown with Yahoo's real rating, analyst count, rating spread, and low/mean/high price targets with the upside to the mean
- **price context**: a top row with the close, the day's % change, open/high/low and returns, and Claude's read of the recent price action below it (Claude gets the last 10 daily candles). Then two panels: **Mean reversion (1y)** with the 25th/75th percentile band and average, and **50/200 SMA** with both averages and the last cross. Claude's bullet points add only insight and never repeat the figures already shown. For a past day, prices are as of that day.

Summaries saved before this layout still display: they have no one-line takeaway, and their price context stays a paragraph.

It runs only when you click, as a **background job on the server**. You can leave the page, open another ticker or close the tab, and the run keeps going. The page polls for the result and shows a spinner with the elapsed time. Clicking again while a run is going joins it instead of starting a second one. At most two runs go at once, and others wait their turn. A run that's still going is lost if the server restarts.

A result is cached for an hour per ticker and date range, whether or not you save it. **Save** keeps it in the database, and **Refresh** asks Claude again. Opening the same ticker and day later shows the saved copy, with no new Claude call. A refreshed copy shows as *New version, not saved* until you save it, which replaces the old copy. Saved summaries for Latest news are kept per day, because that feed changes daily.

**✦ AI Summaries** in the top bar (`/summaries`) shows every summary without loading a ticker first. It lists runs **in progress** (failed ones get a *Try again* link), results **not saved yet** (still in the 1-hour cache, with a **Save** button), and **saved** summaries, across all tickers, with a ticker filter. Expand any one to read it, or open the headlines it was made from. Only the owner can generate, save or delete summaries; share-link viewers can read the saved and cached ones.

**It uses your Claude subscription, not an API key.** The backend runs the Claude Code CLI headless (`claude -p`), so usage counts against the Pro/Max plan the CLI is logged in with. Claude gets only the WebFetch tool (no shell, files or MCP servers), and `ANTHROPIC_API_KEY` is removed from the CLI's environment so it can't take over. A summary takes about a minute. Setup:

1. Install Claude Code (`curl -fsSL https://claude.ai/install.sh | bash`) and run `claude` once to log in. Without it on PATH, the app falls back to the copy bundled with the VS Code extension.
2. Optional settings in `.env`: `CLAUDE_CLI` (path to the binary), `CLAUDE_MODEL` (e.g. `sonnet` or `opus`; the CLI's default otherwise), `CLAUDE_TIMEOUT_SECONDS` (default 240), `SUMMARY_TTL_SECONDS` (default 3600).

The Fly.io image has no logged-in CLI, so summaries there return "Claude CLI not found". Saved summaries still display.

Windows are measured in trading days: 3m = 63, 6m = 126, 1y = 252, 3y = 756, 5y = 1260, 10y = 2520.

## Access control

The site is locked down. Every `/api` call needs a token.

There are two ways to prove who you are, and you can run either alone or both together.

**1. Tailnet identity (no key).** When `TAILSCALE_AUTH=1`, the app trusts the
`Tailscale-User-Login` header that `tailscale serve` attaches to each request,
and treats that user as the owner. Nothing to type, nothing to leak, nothing to
rotate. Set `TAILSCALE_ALLOWED_LOGINS` to a comma-separated list of logins to
restrict which tailnet users get in; leave it unset to allow any of them, which
is only appropriate on a tailnet where you are the sole user.

The header is only honoured when the request arrives over loopback and carries
no `Tailscale-Funnel-Request` header. That makes `scripts/start-tailscale.sh` the
supported way to run it — see [Serve it on your tailnet](#serve-it-on-your-tailnet).

**2. Bearer tokens.** Needed whenever the caller is not on your tailnet.

- **You (owner)**: the `ADMIN_KEY` env var. Open `https://<your-app>/?t=<ADMIN_KEY>` once. The token moves into the browser's localStorage and is removed from the address bar.
- **People you share with**: open `/admin`, type a name, click **Create link**, and send them the URL. It's shown only once because only a hash is stored. Each person has their own link. **Revoke** cuts off that person immediately, and the table shows when each link was last used.
- Anyone without a valid token sees "Access required".

`ADMIN_KEY` is optional when `TAILSCALE_AUTH=1`; otherwise it is required and
must be at least 16 characters. To revoke *everything*, including your own
sessions, rotate `ADMIN_KEY` and revoke all links.

## Project layout

```
backend/   FastAPI app (yfinance data, bands, SQLite share links, saved AI
           summaries and the watchlist, Claude CLI summarizer in app/summary.py,
           price-alert checker in app/alerts.py) + pytest tests
frontend/  React + TypeScript + Vite, Plotly charts; public/ holds the web-app
           manifest, icons and the service worker for push notifications
scripts/   dev.sh — local setup and run; restart.sh — restart on the current branch;
           start-/restart-/stop-tailscale.sh — serve to your tailnet
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

To use an existing key or database instead, put `ADMIN_KEY=…`, `DB_PATH=…` or `PORT=…` in a gitignored `.env` at the repo root; `dev.sh` reads it on start.

### Restart on the current branch

`scripts/restart.sh` restarts the app on whatever branch you have checked out. It pulls that branch's new commits (fast-forward only, so local work is never touched), stops whatever is listening on the port, starts `dev.sh` in the background (logging to `.app.log`), waits until it answers, and opens the browser.

```bash
./scripts/restart.sh            # restart once
./scripts/restart.sh --watch    # and again whenever the branch gets new commits or you switch branch
./scripts/restart.sh --no-open  # don't open the browser
```

On a Mac, double-click `scripts/Restart Stock Tracker.command` in Finder to do the same thing in one click. Drag it to the Dock to keep it handy.

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

## Serve it on your tailnet

The cheapest way to reach this from anywhere, and the one with no public attack
surface. Requires [Tailscale](https://tailscale.com/download) installed and
`tailscale up` run on this machine.

```bash
./scripts/start-tailscale.sh
```

It builds what's missing, publishes the app at `https://<machine>.<tailnet>.ts.net`,
and prints the URL. Only devices signed in to your tailnet can reach it, and no
access key is involved. Stopping the script removes the endpoint.

After a code change, `./scripts/restart-tailscale.sh` rebuilds and restarts it in
the background (logging to `.tailscale.log`); `./scripts/stop-tailscale.sh` stops
serving.

Restrict access to specific tailnet users (worth doing if anyone else is on the
tailnet):

```bash
TAILSCALE_ALLOWED_LOGINS="you@example.com" ./scripts/start-tailscale.sh
```

Notes and caveats:

- Your machine has to be awake and online. On a Mac, `caffeinate -s ./scripts/start-tailscale.sh` keeps it from sleeping while serving.
- The identity headers are trusted because uvicorn binds to `127.0.0.1` and Tailscale is the only way in. **Do not** change the script to bind `0.0.0.0`, and do not add `--proxy-headers`/`--forwarded-allow-ips` to it: with those, the peer address comes from a caller-supplied `X-Forwarded-For` and the check in `backend/app/auth.py` can be fooled.
- **Never run `tailscale funnel` on this app** while relying on tailnet identity. Funnel publishes the endpoint to the public internet. Requests arriving that way are refused rather than trusted, but you'd be exposing the service deliberately — use `ADMIN_KEY` instead if you want that.

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
- Price history, the earnings date and news are cached in memory for an hour per ticker (`CACHE_TTL_SECONDS`), so headlines can be up to an hour old. Dated news searches are cached the same way, per date range.
- Tickers use Yahoo Finance symbols, e.g. `AAPL`, `SPY`, `D05.SI`, `0700.HK`.
