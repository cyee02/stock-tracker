import { SeriesResponse } from "../api";
import { formatPrice } from "../format";

const LABELS = {
  underpriced: "Underpriced — below 25th percentile",
  fair: "Within 25–75% range",
  overpriced: "Overpriced — above 75th percentile",
};

export default function SignalBadge({ data }: { data: SeriesResponse }) {
  const { latest, currency } = data;
  const f = (v: number | null) => formatPrice(v, currency);
  return (
    <div className="card summary">
      <div className="summary-head">
        <h2>
          {data.ticker} <span className="muted">· {data.period} window ({data.window} trading days)</span>
        </h2>
        <span className={`badge badge-${latest.signal}`}>{LABELS[latest.signal]}</span>
      </div>
      <dl className="stats">
        <div>
          <dt>Close ({latest.date})</dt>
          <dd>{f(latest.close)}</dd>
        </div>
        <div>
          <dt>75th percentile</dt>
          <dd className="c-p75">{f(latest.p75)}</dd>
        </div>
        <div>
          <dt>Moving average</dt>
          <dd className="c-ma">{f(latest.ma)}</dd>
        </div>
        <div>
          <dt>25th percentile</dt>
          <dd className="c-p25">{f(latest.p25)}</dd>
        </div>
      </dl>
    </div>
  );
}
