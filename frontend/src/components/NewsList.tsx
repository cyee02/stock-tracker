import { useEffect, useState } from "react";
import { api, NewsItem } from "../api";
import { formatRelative } from "../format";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; items: NewsItem[] };

export default function NewsList({ ticker }: { ticker: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    api
      .news(ticker)
      .then((r) => !cancelled && setState({ kind: "ok", items: r.items }))
      .catch((e) => !cancelled && setState({ kind: "error", message: e.message }));
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  if (state.kind === "loading") return <p className="muted">Loading news…</p>;
  if (state.kind === "error") return <p className="error-text">{state.message}</p>;
  if (state.items.length === 0) return <p className="muted">Yahoo Finance has no recent news for {ticker}.</p>;

  return (
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
              {[n.publisher, n.published_at && formatRelative(n.published_at)].filter(Boolean).join(" · ")}
            </p>
            {n.summary && <p className="news-summary">{n.summary}</p>}
          </div>
          {n.thumbnail && <img className="news-thumb" src={n.thumbnail} alt="" loading="lazy" />}
        </li>
      ))}
    </ul>
  );
}
