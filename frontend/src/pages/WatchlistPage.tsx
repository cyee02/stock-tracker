import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, WatchRow } from "../api";
import AlertsCard from "../components/AlertsCard";
import { EarningsDate, TYPE_LABELS } from "../components/TickerOverview";
import { formatDay, formatPercent, formatPrice } from "../format";

const SIGNAL_LABELS = { underpriced: "Underpriced", fair: "Within range", overpriced: "Overpriced" } as const;
const SIGNAL_HINTS = {
  underpriced: "Close is below the 25th percentile of the last year's closes",
  fair: "Close is between the 25th and 75th percentile of the last year's closes",
  overpriced: "Close is above the 75th percentile of the last year's closes",
} as const;

export default function WatchlistPage({ isAdmin }: { isAdmin: boolean }) {
  const [rows, setRows] = useState<WatchRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .watchlist()
      .then((r) => setRows(r.rows))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(refresh, [refresh]);

  const remove = (ticker: string) => {
    setRows((rs) => rs?.filter((r) => r.ticker !== ticker) ?? null);
    api.unwatch(ticker).catch((e) => {
      setError(e.message);
      refresh();
    });
  };

  return (
    <main className="watchlist-page">
      <div className="sum-head watch-head">
        <div>
          <h1>Watchlist</h1>
          <p className="muted">
            Latest session, the 1-year mean-reversion signal and the 50/200-day SMA trend for each ticker. Tap one to
            open its chart.
          </p>
        </div>
        <button className="pill" onClick={refresh} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {isAdmin && <AddForm onAdded={refresh} />}
      {isAdmin && <AlertsCard />}
      {error && <div className="card error">{error}</div>}
      {rows === null && !error && (
        <p className="muted watch-loading">
          <span className="spinner" /> Loading prices…
        </p>
      )}
      {rows && rows.length === 0 && (
        <div className="card">
          <p className="sum-empty">
            {isAdmin
              ? "Your watchlist is empty. Add a ticker above, or press ☆ Watch on any chart."
              : "The watchlist is empty."}
          </p>
        </div>
      )}
      {rows && rows.length > 0 && (
        <ul className={`watch-list${loading ? " stale" : ""}`}>
          {rows.map((r) => (
            <WatchCard key={r.ticker} row={r} onRemove={isAdmin ? () => remove(r.ticker) : undefined} />
          ))}
        </ul>
      )}
    </main>
  );
}

function AddForm({ onAdded }: { onAdded: () => void }) {
  const [ticker, setTicker] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    setBusy(true);
    setError(null);
    api
      .watch(t)
      .then(() => {
        setTicker("");
        onAdded();
      })
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <form className="ticker-form card" onSubmit={submit}>
      <label>
        <span>Add a ticker</span>
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="e.g. AAPL, SPY, D05.SI"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <button type="submit" disabled={busy || !ticker.trim()}>
        {busy ? "Adding…" : "Add"}
      </button>
      {error && <p className="error-text watch-add-error">{error}</p>}
    </form>
  );
}

function WatchCard({ row: r, onRemove }: { row: WatchRow; onRemove?: () => void }) {
  const href = `/?ticker=${encodeURIComponent(r.ticker)}`;
  const removeBtn = onRemove && (
    <button className="link-button danger-link watch-remove" onClick={onRemove} aria-label={`Remove ${r.ticker}`}>
      Remove
    </button>
  );

  if (r.error) {
    return (
      <li className="card watch-card">
        <div className="watch-top">
          <a href={href} className="watch-name">
            <strong>{r.ticker}</strong>
          </a>
          {removeBtn}
        </div>
        <p className="error-text">{r.error}</p>
      </li>
    );
  }

  const f = (v: number | null | undefined) => formatPrice(v ?? null, null);
  const type = r.quote_type ? TYPE_LABELS[r.quote_type] ?? r.quote_type : null;
  const change = r.change_pct ?? null;
  const cross = r.last_cross;

  return (
    <li className="card watch-card">
      <div className="watch-top">
        <a href={href} className="watch-name">
          <strong>{r.ticker}</strong>
          {type && <span className="type-tag">{type}</span>}
          {r.name && <span className="muted watch-fullname">{r.name}</span>}
        </a>
        <div className="watch-price">
          <strong>{formatPrice(r.close ?? null, r.currency ?? null)}</strong>
          <span className={change === null ? "muted" : change >= 0 ? "c-up" : "c-down"}>{formatPercent(change)}</span>
        </div>
      </div>

      <dl className="watch-ohlc">
        <div>
          <dt>Open</dt>
          <dd>{f(r.open)}</dd>
        </div>
        <div>
          <dt>High</dt>
          <dd>{f(r.high)}</dd>
        </div>
        <div>
          <dt>Low</dt>
          <dd>{f(r.low)}</dd>
        </div>
        <div>
          <dt>Prev. close</dt>
          <dd>{f(r.prev_close)}</dd>
        </div>
        {r.date && (
          <div>
            <dt>As of</dt>
            <dd>{formatDay(r.date)}</dd>
          </div>
        )}
      </dl>

      <div className="watch-signals">
        <span className="watch-signal">
          <span className="ai-label">Mean reversion (1y)</span>
          {r.signal ? (
            <span className={`badge badge-${r.signal}`} title={SIGNAL_HINTS[r.signal]}>
              {SIGNAL_LABELS[r.signal]}
            </span>
          ) : (
            <span className="badge badge-fair">Not enough history</span>
          )}
          {r.p25 != null && r.p75 != null && (
            <span className="muted watch-sub">
              Range {f(r.p25)} – {f(r.p75)}
            </span>
          )}
        </span>
        <span className="watch-signal">
          <span className="ai-label">50/200-day SMA</span>
          {r.trend ? (
            <span className={`badge badge-${r.trend}`}>{r.trend === "bullish" ? "Bullish" : "Bearish"}</span>
          ) : (
            <span className="badge badge-fair">Not enough history</span>
          )}
          {cross && (
            <span className="muted watch-sub">
              {cross.kind === "golden" ? "▲ Golden" : "▼ Death"} cross {formatDay(cross.date)}
            </span>
          )}
        </span>
      </div>

      <div className="watch-bottom">
        <span className="overview-facts">
          {r.nav != null && (
            <span className="nav muted">
              NAV <strong>{formatPrice(r.nav, r.currency ?? null)}</strong>
            </span>
          )}
          {r.earnings_date && <EarningsDate start={r.earnings_date} end={r.earnings_date_end ?? null} />}
        </span>
        <span className="watch-actions">
          {removeBtn}
          <a href={href} className="sum-link">
            Open chart →
          </a>
        </span>
      </div>
    </li>
  );
}
