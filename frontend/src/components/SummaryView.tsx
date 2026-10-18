import { ReactNode } from "react";
import { AnalystData, NewsSummary, PriceContext, SummaryEntry } from "../api";
import { formatDay, formatPercent, formatPrice } from "../format";

const SENTIMENT_LABELS = { bullish: "Bullish", bearish: "Bearish", neutral: "Neutral", mixed: "Mixed" };
const STANCE_LABELS = { buy: "Buy", hold: "Hold", sell: "Sell" };
const SIGNAL_LABELS = { underpriced: "Below 25th percentile", fair: "Within 25–75% range", overpriced: "Above 75th percentile" };

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Sources({ urls }: { urls: string[] }) {
  if (!urls.length) return null;
  return (
    <span className="ai-sources">
      {urls.map((u, i) => (
        <a key={`${u}-${i}`} href={u} target="_blank" rel="noopener noreferrer">
          {host(u)}
        </a>
      ))}
    </span>
  );
}

function upDown(v: number | null | undefined): string {
  return v === null || v === undefined ? "" : v >= 0 ? "c-up" : "c-down";
}

/** The buy/hold/sell view, weighed against Wall Street's rating and price targets. */
function AnalystConsensus({ s, a }: { s: NewsSummary; a: AnalystData | null }) {
  const upside = a && a.target_mean !== null && a.current_price ? a.target_mean / a.current_price - 1 : null;
  const counts = a
    ? ([
        ["Strong buy", a.strong_buy],
        ["Buy", a.buy],
        ["Hold", a.hold],
        ["Sell", a.sell],
        ["Strong sell", a.strong_sell],
      ] as const)
    : [];
  const total = counts.reduce((sum, [, n]) => sum + (n ?? 0), 0);
  return (
    <section>
      <h3>Analyst consensus</h3>
      <div className="ai-stance">
        <span className={`badge badge-${s.stance.action}`}>
          {STANCE_LABELS[s.stance.action]} · {s.stance.confidence} confidence
        </span>
        <span className="muted">{s.stance.horizon}</span>
      </div>
      <p>{s.stance.rationale}</p>
      {a ? (
        <>
          <dl className="stats ai-stats">
            <div>
              <dt>Wall Street rating</dt>
              <dd>{a.recommendation ? a.recommendation.replace(/_/g, " ") : "—"}</dd>
              {a.analyst_count !== null && <span className="stat-sub">{a.analyst_count} analysts</span>}
            </div>
            <div>
              <dt>Mean target</dt>
              <dd>{formatPrice(a.target_mean, null)}</dd>
              {upside !== null && <span className={`stat-sub ${upDown(upside)}`}>{formatPercent(upside)} vs price</span>}
            </div>
            <div>
              <dt>Target range</dt>
              <dd className="ai-small">
                {formatPrice(a.target_low, null)} – {formatPrice(a.target_high, null)}
              </dd>
            </div>
          </dl>
          {total > 0 && (
            <div className="ai-ratings" aria-label="Analyst ratings">
              {counts.map(([label, n], i) =>
                n ? (
                  <span key={label} className={`ai-rating r${i}`} style={{ flexGrow: n }} title={`${label}: ${n}`}>
                    {n}
                  </span>
                ) : null,
              )}
            </div>
          )}
        </>
      ) : (
        <p className="muted">No analyst coverage on Yahoo.</p>
      )}
      {s.analyst_view && <p>{s.analyst_view}</p>}
    </section>
  );
}

function Points({ points }: { points?: string[] }) {
  if (!points?.length) return null;
  return (
    <ul className="ai-points">
      {points.map((p, i) => (
        <li key={i}>{p}</li>
      ))}
    </ul>
  );
}

/** What each of the app's charts shows, with Claude's bullet points under each. */
function PriceCharts({ p, text }: { p: PriceContext | null; text: NewsSummary["price_context"] }) {
  const points = typeof text === "string" ? null : text;
  const f = (v: number | null | undefined) => formatPrice(v ?? null, null);
  const mr = p?.mean_reversion_1y;
  return (
    <section>
      <h3>Price context</h3>
      {p && (
        <div className="ai-price-top">
          <dl className="ai-mini ai-ohlc">
            <div>
              <dt>Close · {formatDay(p.as_of)}</dt>
              <dd className="ai-close">{formatPrice(p.close, p.currency)}</dd>
            </div>
            {p.change_pct != null && (
              <div>
                <dt>Change</dt>
                <dd className={`ai-close ${upDown(p.change_pct)}`}>{formatPercent(p.change_pct)}</dd>
              </div>
            )}
            {p.ohlc && (
              <>
                <div>
                  <dt>Open</dt>
                  <dd>{f(p.ohlc.open)}</dd>
                </div>
                <div>
                  <dt>High</dt>
                  <dd>{f(p.ohlc.high)}</dd>
                </div>
                <div>
                  <dt>Low</dt>
                  <dd>{f(p.ohlc.low)}</dd>
                </div>
              </>
            )}
            {Object.entries(p.returns).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd className={upDown(v)}>{formatPercent(v)}</dd>
              </div>
            ))}
          </dl>
          <Points points={points?.candlestick} />
        </div>
      )}
      <div className="ai-charts">
        <div className="ai-chart">
          <h4>Mean reversion (1y)</h4>
          {mr && (
            <>
              {mr.signal && <span className={`badge badge-${mr.signal}`}>{SIGNAL_LABELS[mr.signal]}</span>}
              <dl className="ai-mini">
                <div>
                  <dt>25th pct</dt>
                  <dd className="c-p25">{f(mr.p25)}</dd>
                </div>
                <div>
                  <dt>Average</dt>
                  <dd className="c-ma">{f(mr.moving_average)}</dd>
                </div>
                <div>
                  <dt>75th pct</dt>
                  <dd className="c-p75">{f(mr.p75)}</dd>
                </div>
              </dl>
            </>
          )}
          <Points points={points?.mean_reversion} />
        </div>
        <div className="ai-chart">
          <h4>50/200 SMA</h4>
          {p && (
            <>
              {p.trend && (
                <span className={`badge badge-${p.trend}`}>{p.trend === "bullish" ? "50 above 200" : "50 below 200"}</span>
              )}
              <dl className="ai-mini">
                <div>
                  <dt>50-day</dt>
                  <dd className="c-sma50">{f(p.sma50)}</dd>
                </div>
                <div>
                  <dt>200-day</dt>
                  <dd className="c-sma200">{f(p.sma200)}</dd>
                </div>
                {p.last_cross && (
                  <div>
                    <dt>Last cross</dt>
                    <dd className={`c-${p.last_cross.kind}`}>
                      {p.last_cross.kind === "golden" ? "▲" : "▼"} {formatDay(p.last_cross.date)}
                    </dd>
                  </div>
                )}
              </dl>
            </>
          )}
          <Points points={points?.sma_trend} />
        </div>
      </div>
      {typeof text === "string" && <p>{text}</p>}
    </section>
  );
}

/** One summary, read-only. `footer` holds the actions and status that differ by where it's shown. */
export default function SummaryView({ entry, footer }: { entry: SummaryEntry; footer?: ReactNode }) {
  const s = entry.summary;
  return (
    <div className="ai-summary">
      <div className="ai-verdicts">
        {s.one_liner && (
          <div className="ai-verdict">
            <span className="ai-label">In one sentence</span>
            <p className="ai-one-liner">{s.one_liner}</p>
          </div>
        )}
        <div className="ai-verdict">
          <span className="ai-label">Sentiment · analysts &amp; investors</span>
          <span className={`badge badge-${s.sentiment.label}`}>
            {SENTIMENT_LABELS[s.sentiment.label]} ({s.sentiment.score > 0 ? "+" : ""}
            {s.sentiment.score.toFixed(1)})
          </span>
          <p>{s.sentiment.rationale}</p>
        </div>
      </div>

      {s.top_happenings.length > 0 && (
        <section>
          <h3>Top happenings</h3>
          <ol className="ai-happenings">
            {s.top_happenings.map((h, i) => (
              <li key={i}>
                <span className={`ai-dot impact-${h.impact}`} title={h.impact} />
                <div>
                  <strong>{h.headline}</strong>
                  <p>
                    {h.why_it_matters} <Sources urls={h.urls} />
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="ai-cases">
        <section className="ai-case bull">
          <h3>Bull case</h3>
          <p>{s.bull_case}</p>
        </section>
        <section className="ai-case bear">
          <h3>Bear case</h3>
          <p>{s.bear_case}</p>
        </section>
      </div>

      <div className="ai-cases">
        {s.risks.length > 0 && (
          <section>
            <h3>Risks</h3>
            <ul className="ai-list">
              {s.risks.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </section>
        )}
        {s.catalysts.length > 0 && (
          <section>
            <h3>Catalysts</h3>
            <ul className="ai-list">
              {s.catalysts.map((c, i) => (
                <li key={i}>
                  {c.date && /^\d{4}-\d{2}-\d{2}$/.test(c.date) && <span className="muted">{formatDay(c.date)} · </span>}
                  {c.event}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <AnalystConsensus s={s} a={entry.analyst} />
      <PriceCharts p={entry.price} text={s.price_context} />

      <div className="ai-footer muted">
        {footer}
        <span>
          Read {s.articles_read.length} of {entry.articles_total} articles
          {entry.model ? ` · ${entry.model}` : ""} · AI-generated, not financial advice
        </span>
      </div>
    </div>
  );
}
