import { useCallback, useEffect, useState } from "react";
import { api, Period, PERIODS, SeriesResponse } from "../api";
import BandChart from "../components/BandChart";
import NewsList from "../components/NewsList";
import SignalBadge from "../components/SignalBadge";
import SmaCrossChart from "../components/SmaCrossChart";
import SmaSummary from "../components/SmaSummary";
import TickerForm from "../components/TickerForm";
import TickerOverview from "../components/TickerOverview";
import { Strategy, STRATEGIES, STRATEGY_INFO } from "../strategies";

type Tab = "chart" | "news";

function readQuery(): { ticker: string; period: Period; tab: Tab; strategy: Strategy } {
  const q = new URLSearchParams(window.location.search);
  const period = q.get("period") as Period | null;
  const strategy = q.get("strategy") as Strategy | null;
  return {
    ticker: (q.get("ticker") ?? "").toUpperCase(),
    period: period && PERIODS.includes(period) ? period : "1y",
    tab: q.get("tab") === "news" ? "news" : "chart",
    strategy: strategy && STRATEGIES.includes(strategy) ? strategy : "mean-reversion",
  };
}

/** Set or clear a query param without adding a history entry. */
function setParam(key: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value === null) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  window.history.replaceState(null, "", url.pathname + url.search);
}

export default function ChartPage() {
  const initial = readQuery();
  const [data, setData] = useState<SeriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [logScale, setLogScale] = useState(false);
  const [tab, setTab] = useState<Tab>(initial.tab);
  const [strategy, setStrategy] = useState<Strategy>(initial.strategy);

  const selectTab = (next: Tab) => {
    setTab(next);
    setParam("tab", next === "chart" ? null : next);
  };

  const selectStrategy = (next: Strategy) => {
    setStrategy(next);
    setParam("strategy", next === "mean-reversion" ? null : next);
  };

  const load = useCallback((ticker: string, period: Period) => {
    setLoading(true);
    setError(null);
    const url = new URL(window.location.href);
    url.searchParams.set("ticker", ticker);
    url.searchParams.set("period", period);
    window.history.replaceState(null, "", url.pathname + url.search);
    api
      .series(ticker, period)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (initial.ticker) load(initial.ticker, initial.period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main>
      <TickerForm
        initialTicker={initial.ticker}
        initialPeriod={initial.period}
        loading={loading}
        onSubmit={load}
      />
      {error && <div className="card error">{error}</div>}
      {data && (
        <>
          <TickerOverview data={data} />
          <div className="tabs" role="tablist">
            {(["chart", "news"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={`tab${tab === t ? " active" : ""}`}
                onClick={() => selectTab(t)}
              >
                {t === "chart" ? "Charts" : "News"}
              </button>
            ))}
          </div>
          {tab === "news" ? (
            <div className="card news-card" role="tabpanel">
              <NewsList ticker={data.ticker} />
            </div>
          ) : (
            <>
              <div className="strategies" role="radiogroup" aria-label="Strategy">
                {STRATEGIES.map((s) => (
                  <button
                    key={s}
                    role="radio"
                    aria-checked={strategy === s}
                    className={`pill${strategy === s ? " active" : ""}`}
                    onClick={() => selectStrategy(s)}
                  >
                    {STRATEGY_INFO[s].label}
                  </button>
                ))}
              </div>
              <p className="strategy-desc">{STRATEGY_INFO[strategy].description}</p>
              {strategy === "mean-reversion" ? <SignalBadge data={data} /> : <SmaSummary data={data} />}
              <div className={`card chart-card${loading ? " stale" : ""}`}>
                <div className="chart-toolbar">
                  <span className="muted">
                    {strategy === "mean-reversion"
                      ? `Shaded area = 25th–75th percentile of closes over the trailing ${data.period} window`
                      : `${data.sma.crosses.length} golden or death crosses in the full history`}
                  </span>
                  <label className="toggle">
                    <input type="checkbox" checked={logScale} onChange={(e) => setLogScale(e.target.checked)} />
                    Log scale
                  </label>
                </div>
                {strategy === "mean-reversion" ? (
                  <BandChart data={data} logScale={logScale} />
                ) : (
                  <SmaCrossChart data={data} logScale={logScale} />
                )}
              </div>
            </>
          )}
        </>
      )}
      {!data && !error && !loading && (
        <p className="muted hint">Enter a ticker (Yahoo Finance symbol) and pick a moving-average period.</p>
      )}
    </main>
  );
}
