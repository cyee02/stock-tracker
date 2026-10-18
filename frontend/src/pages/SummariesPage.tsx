import { useCallback, useEffect, useState } from "react";
import {
  api,
  SavedSummaryRow,
  SummariesOverview,
  SummaryEntry,
  SummaryKeyFields,
  UnsavedSummaryRow,
} from "../api";
import SummaryView from "../components/SummaryView";
import { formatDay, formatRelative } from "../format";

const SENTIMENT_LABELS = { bullish: "Bullish", bearish: "Bearish", neutral: "Neutral", mixed: "Mixed" };
const STANCE_LABELS = { buy: "Buy", hold: "Hold", sell: "Sell" };
const POLL_MS = 3000;

export function summaryLabel(row: Pick<SummaryKeyFields, "range_key" | "start" | "end">): string {
  if (row.range_key.startsWith("latest:")) return `Latest news · ${formatDay(row.range_key.slice(7))}`;
  if (!row.start || !row.end || row.start === row.end) return formatDay(row.end ?? row.start ?? "");
  return `${formatDay(row.start, false)} – ${formatDay(row.end)}`;
}

/** The ticker page showing the headlines a summary was made from. */
function headlinesUrl(row: SummaryKeyFields): string {
  const q = new URLSearchParams({ ticker: row.ticker, tab: "news" });
  if (!row.range_key.startsWith("latest:") && row.end) q.set("news_date", row.end);
  return `/?${q}`;
}

function rangeOf(row: SummaryKeyFields) {
  return row.start && row.end ? { start: row.start, end: row.end } : null;
}

function rowId(row: SummaryKeyFields, kind: string): string {
  return `${kind}:${row.ticker}:${row.range_key}`;
}

function secondsSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
}

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; data: SummariesOverview };

/** Every AI summary in one place: runs in progress, unsaved results in the cache, and saved ones. */
export default function SummariesPage({ isAdmin }: { isAdmin: boolean }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [filter, setFilter] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("ticker")?.toUpperCase() || null,
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [full, setFull] = useState<Record<string, SummaryEntry>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const load = useCallback(() => {
    api
      .summariesOverview()
      .then((data) => setState({ kind: "ok", data }))
      .catch((e) => setState((s) => (s.kind === "ok" ? s : { kind: "error", message: e.message })));
  }, []);

  useEffect(load, [load]);

  const running = state.kind === "ok" && state.data.jobs.some((j) => j.status === "running");
  useEffect(() => {
    if (!running) return;
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [running, load]);

  const selectFilter = (t: string | null) => {
    setFilter(t);
    const url = new URL(window.location.href);
    if (t) url.searchParams.set("ticker", t);
    else url.searchParams.delete("ticker");
    window.history.replaceState(null, "", url.pathname + url.search);
  };

  const toggleSaved = (row: SavedSummaryRow) => {
    const id = rowId(row, "saved");
    setError(null);
    if (openId === id) return setOpenId(null);
    setOpenId(id);
    api
      .getSavedSummary(row.id)
      .then((s) => setFull((f) => ({ ...f, [id]: s })))
      .catch((e) => setError(e.message));
  };

  const toggleUnsaved = (row: UnsavedSummaryRow) => {
    const id = rowId(row, "unsaved");
    setError(null);
    if (openId === id) return setOpenId(null);
    setOpenId(id);
    api
      .peekNewsSummary(row.ticker, rangeOf(row))
      .then((r) => {
        if (r.summary && r.source === "cache") setFull((f) => ({ ...f, [id]: r }));
        else setError("This summary has expired.");
      })
      .catch((e) => setError(e.message));
  };

  const save = (row: UnsavedSummaryRow) => {
    const id = rowId(row, "unsaved");
    setBusy(id);
    setError(null);
    api
      .saveNewsSummary(row.ticker, rangeOf(row))
      .then(() => {
        setOpenId(null);
        load();
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(null));
  };

  const remove = (row: SavedSummaryRow) => {
    if (!window.confirm(`Delete the saved ${row.ticker} summary for ${summaryLabel(row)}?`)) return;
    api
      .deleteSavedSummary(row.id)
      .then(load)
      .catch((e) => setError(e.message));
  };

  const retry = (row: SummaryKeyFields) => {
    setError(null);
    api
      .newsSummary(row.ticker, rangeOf(row), true)
      .then(load)
      .catch((e) => setError(e.message));
  };

  let content;
  if (state.kind === "loading") content = <p className="muted">Loading summaries…</p>;
  else if (state.kind === "error") content = <p className="error-text">{state.message}</p>;
  else {
    const { items, unsaved, jobs } = state.data;
    const tickers = [...new Set([...jobs, ...unsaved, ...items].map((r) => r.ticker))].sort();
    const keep = <T extends SummaryKeyFields>(rows: T[]) => (filter ? rows.filter((r) => r.ticker === filter) : rows);
    const [j, u, s] = [keep(jobs), keep(unsaved), keep(items)];

    const head = (row: SummaryKeyFields, extra: React.ReactNode) => (
      <>
        <span className="sum-ticker">{row.ticker}</span>
        <strong>{summaryLabel(row)}</strong>
        {extra}
      </>
    );
    const badges = (sentiment: keyof typeof SENTIMENT_LABELS | null, stance: keyof typeof STANCE_LABELS | null) => (
      <>
        {sentiment && <span className={`badge badge-${sentiment}`}>{SENTIMENT_LABELS[sentiment]}</span>}
        {stance && <span className={`badge badge-${stance}`}>{STANCE_LABELS[stance]}</span>}
      </>
    );

    content = (
      <>
        {tickers.length > 1 && (
          <div className="range-presets sum-filter" role="radiogroup" aria-label="Ticker">
            {[null, ...tickers].map((t) => (
              <button
                key={t ?? "all"}
                role="radio"
                aria-checked={filter === t}
                className={`range-btn${filter === t ? " active" : ""}`}
                onClick={() => selectFilter(t)}
              >
                {t ?? "All"}
              </button>
            ))}
          </div>
        )}

        {j.length > 0 && (
          <section className="card">
            <h2>In progress</h2>
            <ul className="saved-list">
              {j.map((row) => (
                <li key={rowId(row, "job")}>
                  <div className="saved-row">
                    <span className="saved-toggle static">
                      {row.status === "running" ? (
                        head(
                          row,
                          <span className="muted ai-refreshing">
                            <span className="spinner" aria-hidden /> Claude is reading…{" "}
                            {row.started_at && `${secondsSince(row.started_at)}s`}
                          </span>,
                        )
                      ) : (
                        head(row, <span className="error-text sum-error">Failed: {row.error}</span>)
                      )}
                    </span>
                    <span className="saved-actions">
                      <a className="sum-link" href={headlinesUrl(row)}>
                        Open headlines
                      </a>
                      {isAdmin && row.status === "failed" && (
                        <button className="link-button" onClick={() => retry(row)}>
                          Try again
                        </button>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {u.length > 0 && (
          <section className="card">
            <h2>
              Not saved yet <span className="muted sum-sub">· kept for an hour after they're generated</span>
            </h2>
            <ul className="saved-list">
              {u.map((row) => {
                const id = rowId(row, "unsaved");
                const open = openId === id;
                return (
                  <li key={id} className={open ? "open" : ""}>
                    <div className="saved-row">
                      <button className="saved-toggle" aria-expanded={open} onClick={() => toggleUnsaved(row)}>
                        <span className="saved-caret" aria-hidden>
                          {open ? "▾" : "▸"}
                        </span>
                        {head(
                          row,
                          <>
                            {badges(row.sentiment, row.stance)}
                            <span className="muted saved-when">
                              Generated {formatRelative(row.generated_at)} · expires in{" "}
                              {Math.max(1, Math.round(row.expires_in / 60))}m
                              {row.replaces_saved && " · newer than the saved copy"}
                            </span>
                          </>,
                        )}
                      </button>
                      <span className="saved-actions">
                        {isAdmin && (
                          <button className="ai-save" onClick={() => save(row)} disabled={busy === id}>
                            {busy === id ? "Saving…" : row.replaces_saved ? "Save (replace saved)" : "Save"}
                          </button>
                        )}
                        <a className="sum-link" href={headlinesUrl(row)}>
                          Open headlines
                        </a>
                      </span>
                    </div>
                    {open && (full[id] ? <SummaryView entry={full[id]} /> : <p className="muted">Loading…</p>)}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="card">
          <h2>Saved</h2>
          {s.length === 0 ? (
            <p className="muted sum-empty">
              Nothing saved yet. On a ticker's News tab, click <strong>Summarize with Claude</strong>, then{" "}
              <strong>Save</strong> to keep the result here.
            </p>
          ) : (
            <ul className="saved-list">
              {s.map((row) => {
                const id = rowId(row, "saved");
                const open = openId === id;
                return (
                  <li key={id} className={open ? "open" : ""}>
                    <div className="saved-row">
                      <button className="saved-toggle" aria-expanded={open} onClick={() => toggleSaved(row)}>
                        <span className="saved-caret" aria-hidden>
                          {open ? "▾" : "▸"}
                        </span>
                        {head(
                          row,
                          <>
                            {badges(row.sentiment, row.stance)}
                            <span className="muted saved-when">Saved {formatRelative(row.saved_at)}</span>
                          </>,
                        )}
                      </button>
                      <span className="saved-actions">
                        <a className="sum-link" href={headlinesUrl(row)}>
                          Open headlines
                        </a>
                        {isAdmin && (
                          <button className="link-button danger-link" onClick={() => remove(row)}>
                            Delete
                          </button>
                        )}
                      </span>
                    </div>
                    {open &&
                      (full[id] ? (
                        <SummaryView
                          entry={full[id]}
                          footer={<span>Generated {formatRelative(full[id].generated_at)}</span>}
                        />
                      ) : (
                        <p className="muted">Loading…</p>
                      ))}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </>
    );
  }

  return (
    <main className="summaries-page">
      <div className="sum-head">
        <h1>AI Summaries</h1>
        <p className="muted">Claude's briefings on the news, for every ticker you've summarized.</p>
      </div>
      {error && <div className="card error">{error}</div>}
      {content}
    </main>
  );
}
