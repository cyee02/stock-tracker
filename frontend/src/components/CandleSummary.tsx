import { SeriesResponse } from "../api";
import { formatDay, formatPrice } from "../format";
import { isCovered, View, viewEnd } from "../view";

/** Latest close, plus the highest high and lowest low within the visible date range. */
export default function CandleSummary({ data, view }: { data: SeriesResponse; view: View }) {
  const { latest, currency } = data;
  const f = (v: number | null) => formatPrice(v, currency);
  const end = viewEnd(view, latest.date);
  // Until the earlier history arrives, a high/low over the loaded part would be wrong, not just incomplete.
  const covered = isCovered(view, data.start, data.first_date);
  const show = (v: { value: number; date: string } | null) =>
    covered ? (
      <>
        {f(v?.value ?? null)}
        {v && <span className="stat-sub">{formatDay(v.date)}</span>}
      </>
    ) : (
      "…"
    );

  let high: { value: number; date: string } | null = null;
  let low: { value: number; date: string } | null = null;
  for (const p of data.points) {
    if (p.date < view.start || p.date > end) continue;
    if (p.high !== null && (!high || p.high > high.value)) high = { value: p.high, date: p.date };
    if (p.low !== null && (!low || p.low < low.value)) low = { value: p.low, date: p.date };
  }

  return (
    <div className="card summary">
      <div className="summary-head">
        <h2>
          {data.ticker}{" "}
          <span className="muted">
            · {formatDay(view.start)} – {formatDay(end)}
          </span>
        </h2>
      </div>
      <dl className="stats">
        <div>
          <dt>Close ({latest.date})</dt>
          <dd>{f(latest.close)}</dd>
        </div>
        <div>
          <dt>High in range</dt>
          <dd className="c-up">{show(high)}</dd>
        </div>
        <div>
          <dt>Low in range</dt>
          <dd className="c-down">{show(low)}</dd>
        </div>
      </dl>
    </div>
  );
}
