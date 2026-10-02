import { useEffect, useState } from "react";
import { SeriesResponse } from "../api";
import { daysUntil, formatDay, formatPercent, formatPrice } from "../format";

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
        <div className="overview-facts">
          {info.earnings_date && <EarningsDate start={info.earnings_date} end={info.earnings_date_end} />}
          {info.nav !== null && (
            <span className="nav muted">
              NAV <strong>{formatPrice(info.nav, currency)}</strong>
            </span>
          )}
        </div>
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

function EarningsDate({ start, end }: { start: string; end: string | null }) {
  const days = daysUntil(start);
  const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  const label = end ? `${formatDay(start, false)} – ${formatDay(end)}` : formatDay(start);
  return (
    <span
      className="nav muted"
      title={end ? "Estimated: the company hasn't confirmed the exact date yet" : "Confirmed date"}
    >
      Next earnings <strong>{label}</strong> ({end ? "est., " : ""}
      {when})
    </span>
  );
}
