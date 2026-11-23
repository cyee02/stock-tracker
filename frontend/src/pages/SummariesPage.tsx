import { useCallback, useEffect, useState } from "react";
import {
  api,
  FinSummaryEntry,
  isFinKey,
  SavedSummaryRow,
  SummariesOverview,
  SummaryEntry,
  SummaryJobRow,
  SummaryKeyFields,
  UnsavedSummaryRow,
} from "../api";
import FinSummaryView, { HEALTH_LABELS, VALUATION_LABELS } from "../components/FinSummaryView";
import SummaryView from "../components/SummaryView";
import { formatDay, formatRelative } from "../format";

const SENTIMENT_LABELS = { bullish: "Bullish", bearish: "Bearish", neutral: "Neutral", mixed: "Mixed" };
const STANCE_LABELS = { buy: "Buy", hold: "Hold", sell: "Sell" };
const KIND_LABELS = { news: "News", financials: "Financials" };
const POLL_MS = 3000;

type Kind = SummaryKeyFields["kind"];
type AnyEntry = SummaryEntry | FinSummaryEntry;

export function summaryLabel(row: Pick<SummaryKeyFields, "range_key" | "start" | "end" | "period">): string {
  if (isFinKey(row.range_key)) return `Period ended ${formatDay(row.period ?? row.range_key.slice(4))}`;
  if (row.range_key.startsWith("latest:")) return `Latest news · ${formatDay(row.range_key.slice(7))}`;
  if (!row.start || !row.end || row.start === row.end) return formatDay(row.end ?? row.start ?? "");
  return `${formatDay(row.start, false)} – ${formatDay(row.end)}`;
}

/** The ticker page a summary was made from: the headlines, or the Financials tab. */
function sourceUrl(row: SummaryKeyFields): string {
  if (row.kind === "financials") return `/?${new URLSearchParams({ ticker: row.ticker, tab: "financials" })}`;
  const q = new URLSearchParams({ ticker: row.ticker, tab: "news" });
  if (!row.range_key.startsWith("latest:") && row.end) q.set("news_date", row.end);
  return `/?${q}`;
}

function SourceLink({ row }: { row: SummaryKeyFields }) {
  return (
    <a className="sum-link" href={sourceUrl(row)}>
      {row.kind === "financials" ? "Open financials" : "Open headlines"}
    </a>
  );
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
  const [kindFilter, setKindFilter] = useState<Kind | null>(() => {
    const k = new URLSearchParams(window.location.search).get("kind");
    return k === "news" || k === "financials" ? k : null;
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [full, setFull] = useState<Record<string, AnyEntry>>({});
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

  const setParam = (name: string, value: string | null) => {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set(name, value);
    else url.searchParams.delete(name);
    window.history.replaceState(null, "", url.pathname + url.search);
  };
  const selectFilter = (t: string | null) => {
    setFilter(t);
    setParam("ticker", t);
  };
  const selectKind = (k: Kind | null) => {
    setKindFilter(k);
    setParam("kind", k);
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
    const peek: Promise<{ summary: unknown; source?: string }> =
      row.kind === "financials" ? api.peekFinSummary(row.ticker, row.period) : api.peekNewsSummary(row.ticker, rangeOf(row));
    peek
      .then((r) => {
        if (r.summary && r.source === "cache") setFull((f) => ({ ...f, [id]: r as AnyEntry }));
        else setError("This summary has expired.");
      })
      .catch((e) => setError(e.message));
  };

  const save = (row: UnsavedSummaryRow) => {
    const id = rowId(row, "unsaved");
    setBusy(id);
    setError(null);
    (row.kind === "financials" ? api.saveFinSummary(row.ticker, row.period) : api.saveNewsSummary(row.ticker, rangeOf(row)))
      .then(() => {
        setOpenId(null);
        load();
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(null));
  };

  /** While a run is going: have it save its result when it finishes, or take that back. */
  const saveWhenDone = (row: SummaryJobRow, on: boolean) => {
    const id = rowId(row, "job");
    setBusy(id);
    setError(null);
    const call = on
      ? row.kind === "financials"
        ? api.saveFinSummary(row.ticker, row.period, true)
        : api.saveNewsSummary(row.ticker, rangeOf(row), true)
      : row.kind === "financials"
        ? api.cancelFinSaveWhenDone(row.ticker, row.period)
        : api.cancelNewsSaveWhenDone(row.ticker, rangeOf(row));
    call
      .then(load)
      .catch((e) => setError(e.message))
      .finally(() => setBusy(null));
  };

  const remove = (row: SavedSummaryRow) => {
    const what = row.kind === "financials" ? "financial analysis" : "summary";
    if (!window.confirm(`Delete the saved ${row.ticker} ${what} for ${summaryLabel(row)}?`)) return;
    api
      .deleteSavedSummary(row.id)
      .then(load)
      .catch((e) => setError(e.message));
  };

  const retry = (row: SummaryKeyFields) => {
    setError(null);
    (row.kind === "financials" ? api.finSummary(row.ticker, true) : api.newsSummary(row.ticker, rangeOf(row), true))
      .then(load)
      .catch((e) => setError(e.message));
  };

  let content;
  if (state.kind === "loading") content = <p className="muted">Loading summaries…</p>;
  else if (state.kind === "error") content = <p className="error-text">{state.message}</p>;
  else {
    const { items, unsaved, jobs } = state.data;
    const tickers = [...new Set([...jobs, ...unsaved, ...items].map((r) => r.ticker))].sort();
    const kinds = new Set([...jobs, ...unsaved, ...items].map((r) => r.kind));
    const keep = <T extends SummaryKeyFields>(rows: T[]) =>
      rows.filter((r) => (!filter || r.ticker === filter) && (!kindFilter || r.kind === kindFilter));
    const [j, u, s] = [keep(jobs), keep(unsaved), keep(items)];

    const head = (row: SummaryKeyFields, extra: React.ReactNode) => (
      <>
        <span className="sum-ticker">{row.ticker}</span>
        <span className={`sum-kind sum-kind-${row.kind}`}>{KIND_LABELS[row.kind]}</span>
        <strong>{summaryLabel(row)}</strong>
        {extra}
      </>
    );
    const badges = (row: SavedSummaryRow | UnsavedSummaryRow) => (
      <>
        {row.sentiment && <span className={`badge badge-${row.sentiment}`}>{SENTIMENT_LABELS[row.sentiment]}</span>}
        {row.stance && <span className={`badge badge-${row.stance}`}>{STANCE_LABELS[row.stance]}</span>}
        {row.health && <span className={`badge badge-h-${row.health}`}>{HEALTH_LABELS[row.health]}</span>}
        {row.valuation && (
          <span className={`badge badge-v-${row.valuation}`}>{VALUATION_LABELS[row.valuation]}</span>
        )}
      </>
    );
    const view = (row: SummaryKeyFields, entry: AnyEntry, footer?: React.ReactNode) =>
      row.kind === "financials" ? (
        <FinSummaryView entry={entry as FinSummaryEntry} footer={footer} />
      ) : (
        <SummaryView entry={entry as SummaryEntry} footer={footer} />
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
        {kinds.size > 1 && (
          <div className="range-presets sum-filter" role="radiogroup" aria-label="Kind">
            {([null, "news", "financials"] as const).map((k) => (
              <button
                key={k ?? "all"}
                role="radio"
                aria-checked={kindFilter === k}
                className={`range-btn${kindFilter === k ? " active" : ""}`}
                onClick={() => selectKind(k)}
              >
                {k ? KIND_LABELS[k] : "All kinds"}
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
                      <SourceLink row={row} />
                      {isAdmin && row.status === "running" &&
                        (row.save_when_done ? (
                          <>
                            <span className="saved-tag">Will save when done</span>
                            <button
                              className="link-button"
                              onClick={() => saveWhenDone(row, false)}
                              disabled={busy === rowId(row, "job")}
                            >
                              Don't save
                            </button>
                          </>
                        ) : (
                          <button
                            className="ai-save"
                            onClick={() => saveWhenDone(row, true)}
                            disabled={busy === rowId(row, "job")}
                          >
                            Save when done
                          </button>
                        ))}
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
                            {badges(row)}
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
                        <SourceLink row={row} />
                      </span>
                    </div>
                    {open && (full[id] ? view(row, full[id]) : <p className="muted">Loading…</p>)}
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
              Nothing saved yet. On a ticker's News tab click <strong>Summarize with Claude</strong>, or on its
              Financials tab click <strong>Analyse with Claude</strong>, then <strong>Save</strong> to keep the result
              here.
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
                            {badges(row)}
                            <span className="muted saved-when">Saved {formatRelative(row.saved_at)}</span>
                          </>,
                        )}
                      </button>
                      <span className="saved-actions">
                        <SourceLink row={row} />
                        {isAdmin && (
                          <button className="link-button danger-link" onClick={() => remove(row)}>
                            Delete
                          </button>
                        )}
                      </span>
                    </div>
                    {open &&
                      (full[id] ? (
                        view(row, full[id], <span>Generated {formatRelative(full[id].generated_at)}</span>)
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
        <p className="muted">Claude's briefings on the news and analyses of the financials, for every ticker.</p>
      </div>
      {error && <div className="card error">{error}</div>}
      {content}
    </main>
  );
}
