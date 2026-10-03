import { useCallback, useEffect, useState } from "react";
import { api, Period, PERIODS, SeriesResponse } from "../api";
import BandChart from "../components/BandChart";
import NewsList from "../components/NewsList";
import SignalBadge from "../components/SignalBadge";
import TickerForm from "../components/TickerForm";
import TickerOverview from "../components/TickerOverview";

type Tab = "chart" | "news";

function readQuery(): { ticker: string; period: Period; tab: Tab } {
  const q = new URLSearchParams(window.location.search);
  const period = q.get("period") as Period | null;
  return {
    ticker: (q.get("ticker") ?? "").toUpperCase(),
    period: period && PERIODS.includes(period) ? period : "1y",
    tab: q.get("tab") === "news" ? "news" : "chart",
  };
}

export default function ChartPage() {
  const initial = readQuery();
  const [data, setData] = useState<SeriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [logScale, setLogScale] = useState(false);
  const [tab, setTab] = useState<Tab>(initial.tab);

  const selectTab = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "chart") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.pathname + url.search);
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
                {t === "chart" ? "Chart" : "News"}
              </button>
            ))}
          </div>
          {tab === "news" ? (
            <div className="card news-card" role="tabpanel">
              <NewsList ticker={data.ticker} />
            </div>
          ) : (
            <>
              <SignalBadge data={data} />
              <div className={`card chart-card${loading ? " stale" : ""}`}>
                <div className="chart-toolbar">
                  <span className="muted">
                    Shaded area = 25th–75th percentile of closes over the trailing {data.period} window
                  </span>
                  <label className="toggle">
                    <input type="checkbox" checked={logScale} onChange={(e) => setLogScale(e.target.checked)} />
                    Log scale
                  </label>
                </div>
                <BandChart data={data} logScale={logScale} />
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
