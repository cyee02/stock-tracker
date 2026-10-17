import { useEffect, useMemo, useState } from "react";
import { api, ChartProps, NewsItem } from "../api";
import { byTradingDay, monthAligned, monthChunks } from "../news";
import { shiftYears, viewEnd } from "../view";
import PriceChart, { cssVar } from "./PriceChart";

const PREVIEW_HEADLINES = 3;
const PREVIEW_CHARS = 72;
// Parallel lookups per view; more spreads the markers more evenly over long ranges.
const NEWS_CHUNKS = 8;
const LOOKUP_LIMIT = 100;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

/** Hover text for one day of the news lane: a count and the first few headlines. */
function preview(items: NewsItem[] | undefined): string {
  if (!items?.length) return "<i>Click for this day's news</i>";
  const lines = items
    .slice(0, PREVIEW_HEADLINES)
    .map((n) => `• ${escapeHtml(truncate(n.title, PREVIEW_CHARS))}${n.publisher ? ` <i>(${escapeHtml(n.publisher)})</i>` : ""}`);
  const more = items.length - PREVIEW_HEADLINES;
  return [
    `<b>${items.length} headline${items.length === 1 ? "" : "s"}</b>`,
    ...lines,
    `<i>${more > 0 ? `+${more} more · ` : ""}click to read</i>`,
  ].join("<br>");
}

type Props = ChartProps & { onOpenNews: (date: string) => void };

/**
 * Daily OHLC candles: green when close > open, red when close < open. A news lane
 * under the candles marks days with headlines; hover previews them and clicking any
 * day opens that day's news, like event markers on Bloomberg's GP chart.
 */
export default function CandlestickChart({ data, view, onViewChange, onOpenNews }: Props) {
  const { points } = data;
  // Rows without OHLC (shouldn't happen from Yahoo) are skipped rather than drawn as gaps.
  const candles = points.filter((p) => p.open !== null && p.high !== null && p.low !== null);
  const dates = useMemo(() => candles.map((p) => p.date), [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Headlines for the visible months; the lookup is capped at the API's ten-year limit.
  const last = data.latest.date;
  const end = viewEnd(view, last);
  const tenYears = shiftYears(end, 10);
  const range = monthAligned(view.start < tenYears ? tenYears : view.start, end, last);
  const [news, setNews] = useState<{ key: string; items: NewsItem[]; capped: boolean } | null>(null);
  const [newsError, setNewsError] = useState(false);
  const rangeKey = `${data.ticker}:${range.start}:${range.end}`;

  useEffect(() => {
    let cancelled = false;
    setNewsError(false);
    // Wait for zooming and slider drags to settle before looking anything up.
    const timer = setTimeout(() => {
      Promise.all(monthChunks(range, NEWS_CHUNKS).map((r) => api.news(data.ticker, r)))
        .then((rs) => {
          if (cancelled) return;
          const items = rs.flatMap((r) => r.items);
          setNews({ key: rangeKey, items, capped: rs.some((r) => r.items.length >= LOOKUP_LIMIT) });
        })
        .catch(() => !cancelled && setNewsError(true));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  const perDay = useMemo(() => byTradingDay(news?.items ?? [], dates), [news, dates]);
  const sizes = dates.map((d) => {
    const n = perDay.get(d)?.length ?? 0;
    return n ? Math.min(6 + n * 1.5, 14) : 0;
  });

  const traces = () => [
    {
      x: dates,
      open: candles.map((p) => p.open),
      high: candles.map((p) => p.high),
      low: candles.map((p) => p.low),
      close: candles.map((p) => p.close),
      name: data.ticker,
      type: "candlestick",
      increasing: { line: { color: cssVar("--c-up"), width: 1 }, fillcolor: cssVar("--c-up") },
      decreasing: { line: { color: cssVar("--c-down"), width: 1 }, fillcolor: cssVar("--c-down") },
      whiskerwidth: 0.6,
    },
    {
      // One point per session (invisible on days without news) so every day hovers and clicks.
      x: dates,
      y: dates.map(() => 0.5),
      yaxis: "y2",
      type: "scatter",
      mode: "markers",
      name: "News",
      marker: { size: sizes, color: cssVar("--accent"), line: { width: 0 } },
      hovertext: dates.map((d) => preview(perDay.get(d))),
      hovertemplate: "%{hovertext}<extra></extra>",
    },
  ];

  let inView: number | null = null;
  if (news) {
    inView = 0;
    for (const [d, items] of perDay) if (d >= view.start && d <= end) inView += items.length;
  }
  // A full lookup may have left stories out, so the count is of the top ones only.
  const capped = news?.capped ?? false;

  return (
    <PriceChart
      data={data}
      view={view}
      onViewChange={onViewChange}
      values={(p) => [p.high, p.low]}
      traces={traces}
      redrawKey={news}
      onDateClick={onOpenNews}
      layout={{
        // Hovering the candles also reports the news lane below them, and vice versa.
        hoversubplots: "axis",
        yaxis: { domain: [0.09, 1] },
        yaxis2: { domain: [0, 0.06], range: [0, 1], fixedrange: true, showgrid: false, zeroline: false, showticklabels: false },
      }}
      legend={
        <li>
          <i className="marker m-news">●</i>
          {newsError
            ? "News markers unavailable"
            : inView === null || news?.key !== rangeKey
              ? "Loading news markers…"
              : `${inView} ${capped ? "top " : ""}headline${inView === 1 ? "" : "s"} in view`}
          <span className="muted"> · hover a day to preview, click to open its news</span>
        </li>
      }
    />
  );
}
