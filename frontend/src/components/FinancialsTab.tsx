import { useEffect, useMemo, useState } from "react";
import { api, BalancePeriod, CashflowPeriod, FinancialsResponse, IncomePeriod, Statements } from "../api";
import { formatCompact, formatDay, periodLabel } from "../format";
import { RATIO_GROUPS, RATIO_INFO, RatioFormat } from "../ratios";
import FinancialChart, { Series } from "./FinancialChart";
import InfoTip from "./InfoTip";

type Freq = "quarterly" | "annual";

const hasData = (s: Series) => s.values.some((v) => v !== null);

function formatRatio(v: number | null, format: RatioFormat): string {
  if (v === null) return "—";
  if (format === "pct") return `${(v * 100).toFixed(1)}%`;
  if (format === "x") return `${v.toFixed(2)}x`;
  if (format === "money") return formatCompact(v);
  return v.toFixed(2);
}

/** Values of `key` for each period, null where that statement has no such period. */
function pick<T extends { period: string }>(rows: T[], periods: string[], key: keyof T): (number | null)[] {
  const byPeriod = new Map(rows.map((r) => [r.period, r]));
  return periods.map((p) => (byPeriod.get(p)?.[key] as number | null | undefined) ?? null);
}

function minus(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a - b;
}

export default function FinancialsTab({ ticker }: { ticker: string }) {
  const [data, setData] = useState<FinancialsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [freq, setFreq] = useState<Freq>("quarterly");

  useEffect(() => {
    setData(null);
    setError(null);
    let live = true;
    api
      .financials(ticker)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [ticker]);

  if (error) return <div className="card error">{error}</div>;
  if (!data)
    return (
      <div className="card fin-loading">
        <span className="spinner" /> Loading financial statements…
      </div>
    );

  const st = data[freq];
  const annual = freq === "annual";
  const latest = st.income.at(-1)?.period ?? null;

  return (
    <div className="financials" role="tabpanel">
      <div className="fin-head">
        <div className="strategies" role="radiogroup" aria-label="Reporting period">
          {(["quarterly", "annual"] as const).map((f) => (
            <button
              key={f}
              role="radio"
              aria-checked={freq === f}
              className={`pill${freq === f ? " active" : ""}`}
              onClick={() => setFreq(f)}
            >
              {f === "quarterly" ? "Quarterly" : "Annual"}
            </button>
          ))}
        </div>
        <span className="muted fin-meta">
          {data.currency && <>Reported in {data.currency}</>}
          {latest && <> · latest period ended {formatDay(latest)}</>}
        </span>
      </div>

      <Ratios data={data} />
      <Charts st={st} annual={annual} data={data} />
      <StatementTable st={st} annual={annual} />
    </div>
  );
}

function Ratios({ data }: { data: FinancialsResponse }) {
  return (
    <div className="card">
      <h2>Key ratios</h2>
      <p className="muted fin-sub">Latest figures from Yahoo Finance (trailing 12 months unless noted). Tap ⓘ for what each means.</p>
      <div className="ratio-groups">
        {RATIO_GROUPS.map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            <dl className="ratio-list">
              {g.keys.map((k) => {
                const info = RATIO_INFO[k];
                return (
                  <div key={k}>
                    <dt>
                      {info.label}
                      <InfoTip label={info.label}>
                        <strong>{info.label}</strong>
                        <span>{info.what}</span>
                        <span>
                          <em>How to use it:</em> {info.howToUse}
                        </span>
                      </InfoTip>
                    </dt>
                    <dd>{formatRatio(data.ratios[k], info.format)}</dd>
                  </div>
                );
              })}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}

function ChartCard({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="card fin-chart-card">
      <h3>{title}</h3>
      {note && <p className="muted fin-sub">{note}</p>}
      {children}
    </div>
  );
}

function Charts({ st, annual, data }: { st: Statements; annual: boolean; data: FinancialsResponse }) {
  const cur = data.currency;
  const charts = useMemo(() => {
    const inc = st.income;
    const periods = inc.map((r) => r.period);
    const labels = periods.map((p) => periodLabel(p, annual));
    const v = (key: keyof IncomePeriod) => pick(inc, periods, key);

    const profit: Series[] = [
      { name: "Revenue", color: "--s1", values: v("revenue") },
      { name: "Gross profit", color: "--s2", values: v("gross_profit") },
      { name: "Net interest income", color: "--s2", values: v("gross_profit").some((x) => x !== null) ? [] : v("net_interest_income") },
      { name: "Operating income", color: "--s3", values: v("operating_income") },
      { name: "Net income", color: "--s4", values: v("net_income") },
    ].filter(hasData);

    const margins: Series[] = [
      { name: "Gross margin", color: "--s2", values: v("gross_margin") },
      { name: "Operating margin", color: "--s3", values: v("operating_margin") },
      { name: "Net margin", color: "--s4", values: v("net_margin") },
    ].filter(hasData);

    // Other opex = what's in operating expense beyond R&D and SG&A.
    const opex = v("operating_expense");
    const rnd = v("r_and_d");
    const sga = v("sga");
    const other = opex.map((o, i) => (o === null ? null : Math.max(0, o - (rnd[i] ?? 0) - (sga[i] ?? 0))));
    let expenses: Series[] = [
      { name: "Cost of revenue", color: "--s1", values: v("cost_of_revenue") },
      { name: "R&D", color: "--s2", values: rnd },
      { name: "SG&A", color: "--s3", values: sga },
      { name: "Other operating", color: "--s4", values: other.some((x) => x) ? other : [] },
      { name: "Income tax", color: "--s5", values: v("tax") },
    ].filter(hasData);
    let expensesNote = "Cost of revenue plus operating costs, stacked, with income tax on top.";
    if (!expenses.some((s) => s.name !== "Income tax")) {
      // Banks and insurers don't split costs this way; show the total it implies.
      const total = v("revenue").map((r, i) => minus(r, v("pretax_income")[i]));
      expenses = [{ name: "Total expenses", color: "--s1", values: total }, ...expenses].filter(hasData);
      expensesNote = "This company doesn't break costs down by type, so this is revenue − pre-tax income (including any loan-loss provisions).";
    }

    const eps = data.eps_history;
    const epsSeries: Series[] = [
      { name: "Estimate", color: "--s5", values: eps.map((e) => e.estimate) },
      {
        name: "Actual",
        color: "--s1",
        values: eps.map((e) => e.actual),
        labels: eps.map((e) =>
          e.surprise === null ? null : `${e.surprise >= 0 ? "Beat" : "Miss"} ${(Math.abs(e.surprise) * 100).toFixed(1)}%`,
        ),
      },
    ];

    const cfPeriods = st.cashflow.map((r) => r.period);
    const cf = (key: keyof CashflowPeriod) => pick(st.cashflow, cfPeriods, key);
    const cashflow: Series[] = [
      { name: "Operating cash flow", color: "--s1", values: cf("operating_cf") },
      { name: "Capex", color: "--s2", values: cf("capex") },
      { name: "Free cash flow", color: "--s3", values: cf("free_cf") },
      { name: "Buybacks", color: "--s4", values: cf("buybacks") },
      { name: "Dividends paid", color: "--s5", values: cf("dividends_paid") },
    ].filter(hasData);

    const bPeriods = st.balance.map((r) => r.period);
    const b = (key: keyof BalancePeriod) => pick(st.balance, bPeriods, key);
    const currentRatio = b("current_assets").map((a, i) => {
      const l = b("current_liabilities")[i];
      return a !== null && l ? `<br>Current ratio: ${(a / l).toFixed(2)}x` : null;
    });
    const balance: Series[] = [
      { name: "Cash & short-term investments", color: "--s1", values: b("cash"), hoverExtra: currentRatio },
      { name: "Total debt", color: "--s2", values: b("total_debt") },
      { name: "Shareholders' equity", color: "--s3", values: b("equity") },
    ].filter(hasData);

    return {
      labels,
      profit,
      margins,
      expenses,
      expensesNote,
      epsLabels: eps.map((e) => periodLabel(e.quarter, false)),
      epsSeries,
      cfLabels: cfPeriods.map((p) => periodLabel(p, annual)),
      cashflow,
      bLabels: bPeriods.map((p) => periodLabel(p, annual)),
      balance,
    };
  }, [st, annual, data.eps_history]);

  return (
    <div className="fin-charts">
      {charts.profit.length > 0 && (
        <ChartCard title="Revenue & profit" note="Each step down is what's left after another layer of costs.">
          <FinancialChart periods={charts.labels} series={charts.profit} kind="bar" unit="money" currency={cur} />
        </ChartCard>
      )}
      {charts.margins.length > 0 && (
        <ChartCard title="Margins" note="Share of revenue kept as profit. Rising lines mean the business is getting more efficient.">
          <FinancialChart periods={charts.labels} series={charts.margins} kind="line" unit="pct" currency={cur} />
        </ChartCard>
      )}
      {charts.expenses.length > 0 && (
        <ChartCard title="Expenses" note={charts.expensesNote}>
          <FinancialChart periods={charts.labels} series={charts.expenses} kind="stack" unit="money" currency={cur} />
        </ChartCard>
      )}
      {!annual && data.eps_history.length > 0 && (
        <ChartCard title="EPS vs. analyst estimate" note="Diluted earnings per share against the consensus estimate before each report.">
          <FinancialChart periods={charts.epsLabels} series={charts.epsSeries} kind="bar" unit="eps" currency={cur} />
        </ChartCard>
      )}
      {charts.cashflow.length > 0 && (
        <ChartCard title="Cash flow" note="Capex, buybacks and dividends are cash going out, so they're negative.">
          <FinancialChart periods={charts.cfLabels} series={charts.cashflow} kind="bar" unit="money" currency={cur} />
        </ChartCard>
      )}
      {charts.balance.length > 0 && (
        <ChartCard title="Balance sheet" note="Cash against debt shows how easily the company could pay what it owes. Hover for the current ratio.">
          <FinancialChart periods={charts.bLabels} series={charts.balance} kind="bar" unit="money" currency={cur} />
        </ChartCard>
      )}
    </div>
  );
}

type Row = {
  label: string;
  get: (st: Statements, period: string) => number | null;
  format: "money" | "pct" | "eps";
  /** Whether an increase is good news; null = neither. */
  goodUp: boolean | null;
};

const inc = (key: keyof IncomePeriod) => (st: Statements, p: string) =>
  (st.income.find((r) => r.period === p)?.[key] as number | null | undefined) ?? null;
const cfl = (key: keyof CashflowPeriod) => (st: Statements, p: string) =>
  (st.cashflow.find((r) => r.period === p)?.[key] as number | null | undefined) ?? null;
const bal = (key: keyof BalancePeriod) => (st: Statements, p: string) =>
  (st.balance.find((r) => r.period === p)?.[key] as number | null | undefined) ?? null;

const SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: "Income statement",
    rows: [
      { label: "Revenue", get: inc("revenue"), format: "money", goodUp: true },
      { label: "Cost of revenue", get: inc("cost_of_revenue"), format: "money", goodUp: null },
      { label: "Gross profit", get: inc("gross_profit"), format: "money", goodUp: true },
      { label: "Net interest income", get: inc("net_interest_income"), format: "money", goodUp: true },
      { label: "R&D", get: inc("r_and_d"), format: "money", goodUp: null },
      { label: "SG&A", get: inc("sga"), format: "money", goodUp: null },
      { label: "Operating income", get: inc("operating_income"), format: "money", goodUp: true },
      { label: "Net income", get: inc("net_income"), format: "money", goodUp: true },
      { label: "EBITDA", get: inc("ebitda"), format: "money", goodUp: true },
      { label: "Diluted EPS", get: inc("diluted_eps"), format: "eps", goodUp: true },
      { label: "Gross margin", get: inc("gross_margin"), format: "pct", goodUp: true },
      { label: "Operating margin", get: inc("operating_margin"), format: "pct", goodUp: true },
      { label: "Net margin", get: inc("net_margin"), format: "pct", goodUp: true },
    ],
  },
  {
    title: "Cash flow",
    rows: [
      { label: "Operating cash flow", get: cfl("operating_cf"), format: "money", goodUp: true },
      { label: "Capex", get: cfl("capex"), format: "money", goodUp: null },
      { label: "Free cash flow", get: cfl("free_cf"), format: "money", goodUp: true },
      { label: "Buybacks", get: cfl("buybacks"), format: "money", goodUp: null },
      { label: "Dividends paid", get: cfl("dividends_paid"), format: "money", goodUp: null },
      { label: "Stock-based comp.", get: cfl("sbc"), format: "money", goodUp: null },
    ],
  },
  {
    title: "Balance sheet",
    rows: [
      { label: "Cash & short-term inv.", get: bal("cash"), format: "money", goodUp: true },
      { label: "Total debt", get: bal("total_debt"), format: "money", goodUp: false },
      { label: "Total assets", get: bal("total_assets"), format: "money", goodUp: null },
      { label: "Total liabilities", get: bal("total_liabilities"), format: "money", goodUp: false },
      { label: "Shareholders' equity", get: bal("equity"), format: "money", goodUp: true },
    ],
  },
];

const DAY_MS = 86_400_000;

/** The period about a year before `p`, if the statements have one (fiscal calendars drift by a few days). */
function yearBefore(periods: string[], p: string): string | null {
  const target = new Date(p).getTime() - 365 * DAY_MS;
  return periods.find((q) => Math.abs(new Date(q).getTime() - target) <= 20 * DAY_MS) ?? null;
}

// Half-yearly reporters leave gaps, so the previous column isn't always a quarter back.
function gapDays(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / DAY_MS;
}

function formatCell(v: number | null, format: Row["format"]): string {
  if (v === null) return "—";
  if (format === "pct") return `${(v * 100).toFixed(1)}%`;
  if (format === "eps") return v.toFixed(2);
  return formatCompact(v);
}

function Change({ cur, prev, row, kind }: { cur: number | null; prev: number | null; row: Row; kind: string }) {
  if (cur === null || prev === null || prev === 0) return null;
  // Margins change in percentage points; amounts by percent of the earlier (absolute) value.
  const d = row.format === "pct" ? cur - prev : (cur - prev) / Math.abs(prev);
  const text = row.format === "pct" ? `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)}pp` : `${d >= 0 ? "+" : ""}${(d * 100).toFixed(0)}%`;
  const tone = row.goodUp === null || Math.abs(d) < 0.0005 ? "" : d > 0 === row.goodUp ? " c-up" : " c-down";
  return (
    <span className={`fin-change${tone}`}>
      {text} {kind}
    </span>
  );
}

function StatementTable({ st, annual }: { st: Statements; annual: boolean }) {
  const all = [...new Set([...st.income, ...st.cashflow, ...st.balance].map((r) => r.period))].sort();
  const shown = [...all].reverse();
  return (
    <div className="card fin-table-card">
      <h2>Statements</h2>
      <p className="muted fin-sub">
        Under each value: change vs. the same period a year earlier (YoY), or the previous quarter (QoQ) when Yahoo
        doesn't have that far back. Green and red mark good and bad news; costs are left uncoloured.
      </p>
      <div className="table-wrap">
        <table className="fin-table">
          <thead>
            <tr>
              <th />
              {shown.map((p) => (
                <th key={p} title={`Period ended ${formatDay(p)}`}>
                  {periodLabel(p, annual)}
                </th>
              ))}
            </tr>
          </thead>
          {SECTIONS.map((sec) => {
            const rows = sec.rows.filter((r) => shown.some((p) => r.get(st, p) !== null));
            if (!rows.length) return null;
            return (
              <tbody key={sec.title}>
                <tr className="fin-section">
                  <th colSpan={shown.length + 1}>{sec.title}</th>
                </tr>
                {rows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    {shown.map((p) => {
                      const i = all.indexOf(p);
                      const yoy = yearBefore(all, p);
                      const prevP = yoy ?? (!annual && i > 0 ? all[i - 1] : null);
                      return (
                        <td key={p}>
                          {formatCell(row.get(st, p), row.format)}
                          {prevP && (
                            <Change
                              cur={row.get(st, p)}
                              prev={row.get(st, prevP)}
                              row={row}
                              kind={yoy ? "YoY" : gapDays(prevP, p) <= 100 ? "QoQ" : "vs prev."}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}
