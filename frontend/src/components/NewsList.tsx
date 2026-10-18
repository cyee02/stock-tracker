import { useEffect, useState } from "react";
import { api, DateRange, NewsItem } from "../api";
import { formatDay, formatRelative } from "../format";
import NewsSummary from "./NewsSummary";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; items: NewsItem[] };

interface Props {
  ticker: string;
  /** Show the headlines of this range (a trading day plus the days since the previous one) instead of the latest. */
  range?: DateRange | null;
  /** Trading day the range belongs to, for the heading. */
  date?: string | null;
  onShowLatest?: () => void;
  onBackToChart?: () => void;
  /** Owner: may generate and save AI summaries. */
  isAdmin?: boolean;
}

export default function NewsList({ ticker, range, date, onShowLatest, onBackToChart, isAdmin = false }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const rangeKey = range ? `${range.start}:${range.end}` : "";

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    api
      .news(ticker, range ?? undefined)
      .then((r) => !cancelled && setState({ kind: "ok", items: r.items }))
      .catch((e) => !cancelled && setState({ kind: "error", message: e.message }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, rangeKey]);

  const header = range && (
    <div className="news-header">
      <div>
        <h2>
          {ticker} news · {formatDay(date ?? range.end)}
        </h2>
        {range.start !== range.end && (
          <p className="muted">
            Includes {formatDay(range.start, false)}–{formatDay(range.end, false)}, since the previous session
          </p>
        )}
      </div>
      <span className="news-actions">
        {onBackToChart && (
          <button className="link-button" onClick={onBackToChart}>
            ← Back to chart
          </button>
        )}
        {onShowLatest && (
          <button className="link-button" onClick={onShowLatest}>
            Latest news
          </button>
        )}
      </span>
    </div>
  );

  let body;
  if (state.kind === "loading") body = <p className="muted">Loading news…</p>;
  else if (state.kind === "error") body = <p className="error-text">{state.message}</p>;
  else if (state.items.length === 0)
    body = (
      <p className="muted">
        {range ? `No headlines found for ${ticker} on these dates.` : `Yahoo Finance has no recent news for ${ticker}.`}
      </p>
    );
  else
    body = (
      <ul className="news-list">
        {state.items.map((n, i) => (
          <li key={`${n.url ?? n.title}-${i}`}>
            <div className="news-body">
              <h3>
                {n.url ? (
                  <a href={n.url} target="_blank" rel="noopener noreferrer">
                    {n.title}
                  </a>
                ) : (
                  n.title
                )}
              </h3>
              <p className="news-meta muted">
                {[
                  n.publisher,
                  // Dated lookups only know the day, so show it instead of a misleading "3y ago" time.
                  n.published_at && (range ? formatDay(n.published_at.slice(0, 10)) : formatRelative(n.published_at)),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {n.summary && <p className="news-summary">{n.summary}</p>}
            </div>
            {n.thumbnail && <img className="news-thumb" src={n.thumbnail} alt="" loading="lazy" />}
          </li>
        ))}
      </ul>
    );

  return (
    <>
      {header}
      {state.kind === "ok" && state.items.length > 0 && (
        <NewsSummary ticker={ticker} range={range ?? null} isAdmin={isAdmin} />
      )}
      {body}
    </>
  );
}
