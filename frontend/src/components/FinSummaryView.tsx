import { ReactNode } from "react";
import { FinSummaryEntry, MetricTrend, PeerVerdict, RatioKey } from "../api";
import { formatCompact, formatDay } from "../format";
import { formatRatio, RATIO_INFO } from "../ratios";

export const HEALTH_LABELS = { strong: "Strong", solid: "Solid", mixed: "Mixed", weak: "Weak" };
export const VALUATION_LABELS = { cheap: "Looks cheap", fair: "Fairly valued", expensive: "Looks expensive" };
const VERDICT_LABELS: Record<PeerVerdict, string> = {
  favorable: "Better",
  in_line: "In line",
  unfavorable: "Worse",
};
const TREND: Record<MetricTrend, { icon: string; label: string; cls: string }> = {
  improving: { icon: "▲", label: "Improving", cls: "c-up" },
  stable: { icon: "▬", label: "Stable", cls: "" },
  deteriorating: { icon: "▼", label: "Deteriorating", cls: "c-down" },
  unclear: { icon: "?", label: "Unclear", cls: "" },
};
// Columns of the peer table: the ratios most investors compare first.
const PEER_COLUMNS: RatioKey[] = [
  "trailing_pe",
  "forward_pe",
  "price_to_sales",
  "ev_to_ebitda",
  "operating_margin",
  "roe",
  "revenue_growth",
  "debt_to_equity",
];

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Points({ title, points }: { title: string; points: string[] }) {
  return (
    <div className="ai-chart">
      <h4>{title}</h4>
      {points.length ? (
        <ul className="ai-points">
          {points.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nothing notable.</p>
      )}
    </div>
  );
}

/** The company against each peer and the peer median, on the ratios that matter most. */
function PeerTable({ entry }: { entry: FinSummaryEntry }) {
  const cols = PEER_COLUMNS.filter(
    (k) => entry.ratios[k] !== null || entry.peers.some((p) => p.ratios[k] !== null),
  );
  const cell = (k: RatioKey, v: number | null | undefined) => <td key={k}>{formatRatio(v, RATIO_INFO[k].format)}</td>;
  return (
    <div className="table-wrap">
      <table className="fin-table peer-table">
        <thead>
          <tr>
            <th scope="col">Company</th>
            <th scope="col">Mkt cap</th>
            {cols.map((k) => (
              <th key={k} scope="col">
                {RATIO_INFO[k].label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="peer-self">
            <th scope="row">{entry.profile.name ?? "This company"}</th>
            <td>{formatCompact(entry.ratios.market_cap ?? entry.profile.market_cap)}</td>
            {cols.map((k) => cell(k, entry.ratios[k]))}
          </tr>
          {entry.peers.map((p) => (
            <tr key={p.ticker}>
              <th scope="row">
                <a href={`/?ticker=${encodeURIComponent(p.ticker)}&tab=financials`}>{p.ticker}</a>{" "}
                <span className="muted">{p.name}</span>
                {!p.same_industry && <span className="muted peer-other"> · {p.industry ?? "same sector"}</span>}
              </th>
              <td>{formatCompact(p.market_cap)}</td>
              {cols.map((k) => cell(k, p.ratios[k]))}
            </tr>
          ))}
          {entry.peer_median && (
            <tr className="peer-median">
              <th scope="row">Peer median</th>
              <td />
              {cols.map((k) => cell(k, entry.peer_median?.[k]))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** One financial analysis, read-only. `footer` holds the actions and status that differ by where it's shown. */
export default function FinSummaryView({ entry, footer }: { entry: FinSummaryEntry; footer?: ReactNode }) {
  const s = entry.summary;
  const insights = s.statement_insights;
  return (
    <div className="ai-summary">
      <div className="ai-verdicts">
        <div className="ai-verdict">
          <span className="ai-label">In one sentence</span>
          <p className="ai-one-liner">{s.one_liner}</p>
        </div>
        <div className="ai-verdict">
          <span className="ai-label">Financial health</span>
          <span className={`badge badge-h-${s.health.label}`}>{HEALTH_LABELS[s.health.label]}</span>
          <p>{s.health.rationale}</p>
        </div>
        <div className="ai-verdict">
          <span className="ai-label">Valuation vs. peers</span>
          <span className={`badge badge-v-${s.valuation.label}`}>{VALUATION_LABELS[s.valuation.label]}</span>
          <p>{s.valuation.rationale}</p>
        </div>
      </div>

      {s.metrics_to_watch.length > 0 && (
        <section>
          <h3>Metrics to watch</h3>
          <div className="fin-watch">
            {s.metrics_to_watch.map((m, i) => {
              const t = TREND[m.trend];
              return (
                <div key={i} className="ai-chart">
                  <div className="fin-watch-head">
                    <h4>{m.metric}</h4>
                    <span className="fin-watch-value">{m.value}</span>
                    <span className={`fin-trend ${t.cls}`} title={t.label}>
                      {t.icon} {t.label}
                    </span>
                  </div>
                  <p>{m.why}</p>
                  <p className="muted">
                    <em>Watch for:</em> {m.watch_for}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h3>Compared with peers</h3>
        {s.peer_comparison.length > 0 && (
          <div className="table-wrap">
            <table className="fin-table peer-compare">
              <thead>
                <tr>
                  <th scope="col">Ratio</th>
                  <th scope="col">This company</th>
                  <th scope="col">Peer median</th>
                  <th scope="col">Verdict</th>
                  <th scope="col">Why</th>
                </tr>
              </thead>
              <tbody>
                {s.peer_comparison.map((c) => {
                  const info = RATIO_INFO[c.metric];
                  return (
                    <tr key={c.metric}>
                      <th scope="row">{info.label}</th>
                      <td>{formatRatio(entry.ratios[c.metric], info.format)}</td>
                      <td>{formatRatio(entry.peer_median?.[c.metric], info.format)}</td>
                      <td>
                        <span className={`badge badge-p-${c.verdict}`}>{VERDICT_LABELS[c.verdict]}</span>
                      </td>
                      <td className="peer-comment">{c.comment}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {s.peer_notes && <p className="peer-notes">{s.peer_notes}</p>}
        {entry.peers.length > 0 ? (
          <details className="peer-details">
            <summary>The {entry.peers.length} peers, ratio by ratio</summary>
            <PeerTable entry={entry} />
            <p className="muted fin-sub">
              Picked automatically from Yahoo Finance's biggest companies in the same industry
              {entry.profile.industry ? ` (${entry.profile.industry})` : ""}, topped up from the same sector when
              that list is thin.
            </p>
          </details>
        ) : (
          <p className="muted">Yahoo Finance didn't list any peers for this company.</p>
        )}
      </section>

      <section>
        <h3>From the statements</h3>
        <div className="ai-charts">
          <Points title="Growth" points={insights.growth} />
          <Points title="Profitability" points={insights.profitability} />
          <Points title="Cash flow" points={insights.cash_flow} />
          <Points title="Balance sheet" points={insights.balance_sheet} />
        </div>
      </section>

      <div className="ai-cases">
        <section className="ai-case bull">
          <h3>Strengths</h3>
          <ul className="ai-list">
            {s.strengths.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>
        <section className="ai-case bear">
          <h3>Concerns</h3>
          <ul className="ai-list">
            {s.concerns.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>
      </div>

      <div className="ai-footer muted">
        {footer}
        <span>
          Period ended {formatDay(entry.period)}
          {s.sources.length > 0 && (
            <>
              {" · "}
              <span className="ai-sources">
                {s.sources.map((u, i) => (
                  <a key={`${u}-${i}`} href={u} target="_blank" rel="noopener noreferrer">
                    {host(u)}
                  </a>
                ))}
              </span>
            </>
          )}
          {entry.model ? ` · ${entry.model}` : ""} · AI-generated, not financial advice
        </span>
      </div>
    </div>
  );
}
