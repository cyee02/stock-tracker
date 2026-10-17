import { useCallback, useEffect, useRef, useState } from "react";
import { api, Period, PERIOD_LABELS, PERIODS, SeriesResponse } from "../api";
import CandlestickChart from "../components/CandlestickChart";
import BandChart from "../components/BandChart";
import CandleSummary from "../components/CandleSummary";
import NewsList from "../components/NewsList";
import SignalBadge from "../components/SignalBadge";
import SmaCrossChart from "../components/SmaCrossChart";
import SmaSummary from "../components/SmaSummary";
import TickerForm from "../components/TickerForm";
import TickerOverview from "../components/TickerOverview";
import { newsWindow } from "../news";
import { Strategy, STRATEGIES, STRATEGY_INFO } from "../strategies";
import { isCovered, TODAY, View, viewEnd } from "../view";

type Tab = "chart" | "news";

function readQuery(): { ticker: string; period: Period; tab: Tab; strategy: Strategy; newsDate: string | null } {
  const q = new URLSearchParams(window.location.search);
  const period = q.get("period") as Period | null;
  const strategy = q.get("strategy") as Strategy | null;
  return {
    ticker: (q.get("ticker") ?? "").toUpperCase(),
    period: period && PERIODS.includes(period) ? period : "1y",
    tab: q.get("tab") === "news" ? "news" : "chart",
    strategy: strategy && STRATEGIES.includes(strategy) ? strategy : "candlestick",
    newsDate: /^\d{4}-\d{2}-\d{2}$/.test(q.get("news_date") ?? "") ? q.get("news_date") : null,
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
  const [tab, setTab] = useState<Tab>(initial.tab);
  const [strategy, setStrategy] = useState<Strategy>(initial.strategy);
  const [period, setPeriod] = useState<Period>(initial.period);
  // Visible date range; null until the first load of a ticker sets it to the latest year.
  const [view, setView] = useState<View | null>(null);
  // Trading day whose news the News tab shows; null shows the latest headlines.
  const [newsDate, setNewsDate] = useState<string | null>(initial.newsDate);
  // Only the newest request may update the page, so slow responses can't overwrite fresh ones.
  const requestId = useRef(0);

  const showNewsFor = (date: string | null) => {
    setNewsDate(date);
    setParam("news_date", date);
  };

  const selectTab = (next: Tab) => {
    setTab(next);
    setParam("tab", next === "chart" ? null : next);
    showNewsFor(null);
  };

  /** From the chart: jump to the News tab showing what was reported on `date`. */
  const openNews = (date: string) => {
    selectTab("news");
    showNewsFor(date);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const selectStrategy = (next: Strategy) => {
    setStrategy(next);
    setParam("strategy", next === "candlestick" ? null : next);
  };

  /** Fetch prices from `start` (default: the latest year) and keep the current view, if any. */
  const load = useCallback((ticker: string, period: Period, start?: string) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    const url = new URL(window.location.href);
    url.searchParams.set("ticker", ticker);
    url.searchParams.set("period", period);
    window.history.replaceState(null, "", url.pathname + url.search);
    api
      .series(ticker, period, start)
      .then((d) => {
        if (id !== requestId.current) return;
        setData(d);
        setView((v) => v ?? { start: d.start, end: TODAY });
      })
      .catch((e) => id === requestId.current && setError(e.message))
      .finally(() => id === requestId.current && setLoading(false));
  }, []);

  const loadTicker = (ticker: string) => {
    setView(null);
    showNewsFor(null);
    load(ticker, period);
  };

  const changePeriod = (p: Period) => {
    setPeriod(p);
    if (data) load(data.ticker, p, data.start);
  };

  // Ranges reaching before the loaded prices fetch the earlier history.
  const changeView = (v: View) => {
    setView(v);
    if (data && v.start < data.start && data.first_date < data.start) {
      load(data.ticker, period, v.start < data.first_date ? data.first_date : v.start);
    }
  };

  useEffect(() => {
    if (initial.ticker) load(initial.ticker, initial.period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const crossesInView =
    data && view && isCovered(view, data.start, data.first_date)
      ? data.sma.crosses.filter((c) => c.date >= view.start && c.date <= viewEnd(view, data.latest.date)).length
      : "…";

  return (
    <main>
      <TickerForm initialTicker={initial.ticker} loading={loading} onSubmit={loadTicker} />
      {error && <div className="card error">{error}</div>}
      {data && view && (
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
              <NewsList
                ticker={data.ticker}
                date={newsDate}
                range={newsDate ? newsWindow(data.points.map((p) => p.date), newsDate) : null}
                onShowLatest={() => showNewsFor(null)}
                onBackToChart={() => selectTab("chart")}
              />
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
              {STRATEGY_INFO[strategy].description && (
                <p className="strategy-desc">{STRATEGY_INFO[strategy].description}</p>
              )}
              {strategy === "mean-reversion" && <SignalBadge data={data} />}
              {strategy === "sma-cross" && <SmaSummary data={data} />}
              {strategy === "candlestick" && <CandleSummary data={data} view={view} />}
              <div className={`card chart-card${loading ? " stale" : ""}`}>
                {strategy === "mean-reversion" && (
                  <div className="chart-toolbar">
                    <label className="inline-select">
                      <span className="muted">Mean reversion window</span>
                      <select value={period} onChange={(e) => changePeriod(e.target.value as Period)}>
                        {PERIODS.map((p) => (
                          <option key={p} value={p}>
                            {PERIOD_LABELS[p]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="muted">
                      Shaded area = 25th–75th percentile of closes over the trailing {data.period} window
                    </span>
                  </div>
                )}
                {strategy === "sma-cross" && (
                  <div className="chart-toolbar">
                    <span className="muted">{crossesInView} golden or death crosses in this range</span>
                  </div>
                )}
                {strategy === "candlestick" ? (
                  <CandlestickChart data={data} view={view} onViewChange={changeView} onOpenNews={openNews} />
                ) : strategy === "mean-reversion" ? (
                  <BandChart data={data} view={view} onViewChange={changeView} />
                ) : (
                  <SmaCrossChart data={data} view={view} onViewChange={changeView} />
                )}
              </div>
            </>
          )}
        </>
      )}
      {!data && !error && !loading && (
        <p className="muted hint">Enter a ticker (Yahoo Finance symbol).</p>
      )}
    </main>
  );
}
