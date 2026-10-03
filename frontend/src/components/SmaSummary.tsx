import { SeriesResponse } from "../api";
import { formatDay, formatPrice } from "../format";

export default function SmaSummary({ data }: { data: SeriesResponse }) {
  const { latest, currency, sma } = data;
  const f = (v: number | null) => formatPrice(v, currency);
  const last = sma.crosses[sma.crosses.length - 1];
  const badge =
    latest.trend === "bullish"
      ? { cls: "badge-bullish", text: `Bullish — ${sma.fast}-day above ${sma.slow}-day` }
      : latest.trend === "bearish"
        ? { cls: "badge-bearish", text: `Bearish — ${sma.fast}-day below ${sma.slow}-day` }
        : { cls: "badge-fair", text: `Needs ${sma.slow} trading days of history` };

  return (
    <div className="card summary">
      <div className="summary-head">
        <h2>
          {data.ticker} <span className="muted">· {sma.fast}/{sma.slow}-day SMA</span>
        </h2>
        <span className={`badge ${badge.cls}`}>{badge.text}</span>
      </div>
      <dl className="stats">
        <div>
          <dt>Close ({latest.date})</dt>
          <dd>{f(latest.close)}</dd>
        </div>
        <div>
          <dt>{sma.fast}-day SMA</dt>
          <dd className="c-sma50">{f(latest.sma50)}</dd>
        </div>
        <div>
          <dt>{sma.slow}-day SMA</dt>
          <dd className="c-sma200">{f(latest.sma200)}</dd>
        </div>
        <div>
          <dt>Last cross</dt>
          <dd className={last ? `c-${last.kind}` : undefined}>
            {last ? (last.kind === "golden" ? "Golden" : "Death") : "None"}
            {last && <span className="stat-sub">{formatDay(last.date)}</span>}
          </dd>
        </div>
      </dl>
    </div>
  );
}
