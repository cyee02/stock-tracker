import { useEffect, useState } from "react";
import { SeriesResponse } from "../api";
import { formatPercent, formatPrice } from "../format";

const TYPE_LABELS: Record<string, string> = {
  EQUITY: "Stock",
  ETF: "ETF",
  MUTUALFUND: "Mutual fund",
  INDEX: "Index",
  CRYPTOCURRENCY: "Crypto",
  CURRENCY: "Currency",
  FUTURE: "Future",
};

export default function TickerOverview({ data }: { data: SeriesResponse }) {
  const { info, returns, currency } = data;
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [data.ticker]);

  const type = info.quote_type ? TYPE_LABELS[info.quote_type] ?? info.quote_type : null;
  const longDescription = (info.description?.length ?? 0) > 280;

  return (
    <div className="card overview">
      <div className="overview-head">
        <h2>
          {info.name ?? data.ticker} <span className="muted">· {data.ticker}</span>
          {type && <span className="type-tag">{type}</span>}
        </h2>
        {info.nav !== null && (
          <span className="nav muted">
            NAV <strong>{formatPrice(info.nav, currency)}</strong>
          </span>
        )}
      </div>
      {info.description && (
        <>
          <p className={`description${longDescription && !expanded ? " clamped" : ""}`}>{info.description}</p>
          {longDescription && (
            <button className="link-button" onClick={() => setExpanded(!expanded)}>
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </>
      )}
      <dl className="stats returns" title="Total return, including dividends (adjusted close)">
        {returns.map((r) => (
          <div key={r.period}>
            <dt>{r.period} return</dt>
            <dd className={r.total === null ? "" : r.total >= 0 ? "up" : "down"}>
              {formatPercent(r.total)}
              {r.annualized !== null && <span className="ann">{formatPercent(r.annualized)} / yr</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
