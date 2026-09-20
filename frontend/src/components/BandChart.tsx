import { useEffect, useRef } from "react";
import Plotly, { PlotlyElement } from "plotly.js-basic-dist-min";
import { Period, Point, SeriesResponse } from "../api";

const PERIOD_YEARS: Record<Period, number> = { "3m": 0.25, "6m": 0.5, "1y": 1, "3y": 3, "5y": 5, "10y": 10 };

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function shiftYears(date: string, years: number): string {
  const d = new Date(date);
  d.setMonth(d.getMonth() - Math.round(years * 12));
  return d.toISOString().slice(0, 10);
}

/** Y range covering every series within the visible date window. */
function yRangeFor(points: Point[], start: string, end: string, log: boolean): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    if (p.date < start || p.date > end) continue;
    for (const v of [p.close, p.ma, p.p25, p.p75]) {
      if (v === null) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!isFinite(lo)) return null;
  if (log) {
    const [a, b] = [Math.log10(Math.max(lo, 1e-6)), Math.log10(hi)];
    const pad = (b - a) * 0.05 || 0.05;
    return [a - pad, b + pad];
  }
  const pad = (hi - lo) * 0.05 || hi * 0.05;
  return [lo - pad, hi + pad];
}

export default function BandChart({ data, logScale }: { data: SeriesResponse; logScale: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { points, currency } = data;
    const dates = points.map((p) => p.date);
    const colors = {
      close: cssVar("--c-close"),
      ma: cssVar("--c-ma"),
      p25: cssVar("--c-p25"),
      p75: cssVar("--c-p75"),
      band: cssVar("--c-band"),
      text: cssVar("--fg-muted"),
      grid: cssVar("--grid"),
      bg: cssVar("--surface"),
      fg: cssVar("--fg"),
    };
    const unit = currency ? ` ${currency}` : "";
    const hover = (label: string) => `${label}: %{y:,.2f}${unit}<extra></extra>`;

    const traces = [
      {
        x: dates,
        y: points.map((p) => p.p75),
        name: "75th percentile",
        type: "scatter",
        mode: "lines",
        line: { color: colors.p75, width: 1.25 },
        hovertemplate: hover("75th pct"),
      },
      {
        x: dates,
        y: points.map((p) => p.p25),
        name: "25th percentile",
        type: "scatter",
        mode: "lines",
        line: { color: colors.p25, width: 1.25 },
        fill: "tonexty",
        fillcolor: colors.band,
        hovertemplate: hover("25th pct"),
      },
      {
        x: dates,
        y: points.map((p) => p.ma),
        name: "Moving average",
        type: "scatter",
        mode: "lines",
        line: { color: colors.ma, width: 1.75, dash: "dash" },
        hovertemplate: hover("MA"),
      },
      {
        x: dates,
        y: points.map((p) => p.close),
        name: "Close",
        type: "scatter",
        mode: "lines",
        line: { color: colors.close, width: 1.5 },
        hovertemplate: hover("Close"),
      },
    ];

    const end = dates[dates.length - 1];
    const lookback = Math.max(5, PERIOD_YEARS[data.period] * 2);
    const start = dates[0] > shiftYears(end, lookback) ? dates[0] : shiftYears(end, lookback);
    const yRange = yRangeFor(points, start, end, logScale);

    const layout = {
      autosize: true,
      height: Math.max(360, Math.min(600, window.innerHeight * 0.62)),
      margin: { l: 48, r: 12, t: 36, b: 8 },
      paper_bgcolor: colors.bg,
      plot_bgcolor: colors.bg,
      font: { color: colors.text, family: "inherit" },
      hovermode: "x unified",
      hoverlabel: { bgcolor: colors.bg, bordercolor: colors.grid, font: { color: colors.fg } },
      showlegend: false,
      xaxis: {
        type: "date",
        hoverformat: "%a %d %b %Y",
        range: [start, end],
        gridcolor: colors.grid,
        showspikes: true,
        spikemode: "across",
        spikethickness: 1,
        spikedash: "dot",
        spikecolor: colors.text,
        rangeselector: {
          x: 0,
          y: 1.01,
          yanchor: "bottom",
          bgcolor: colors.bg,
          activecolor: colors.grid,
          buttons: [
            { count: 1, label: "1Y", step: "year", stepmode: "backward" },
            { count: 3, label: "3Y", step: "year", stepmode: "backward" },
            { count: 5, label: "5Y", step: "year", stepmode: "backward" },
            { count: 10, label: "10Y", step: "year", stepmode: "backward" },
            { step: "all", label: "All" },
          ],
        },
        rangeslider: { visible: true, thickness: 0.08, bgcolor: colors.bg, bordercolor: colors.grid },
      },
      yaxis: {
        type: logScale ? "log" : "linear",
        gridcolor: colors.grid,
        fixedrange: false,
        tickformat: ",.2~f",
        ...(yRange ? { range: yRange, autorange: false } : { autorange: true }),
      },
    };

    let cancelled = false;
    let adjusting = false;
    Plotly.react(el, traces, layout, { responsive: true, displayModeBar: false }).then(
      (gd: PlotlyElement) => {
        if (cancelled) return;
        gd.removeAllListeners?.("plotly_relayout");
        gd.on("plotly_relayout", (ev) => {
          if (adjusting) return;
          let s: string | undefined;
          let e: string | undefined;
          if (Array.isArray(ev["xaxis.range"])) [s, e] = ev["xaxis.range"] as string[];
          else if (ev["xaxis.range[0]"]) [s, e] = [ev["xaxis.range[0]"] as string, ev["xaxis.range[1]"] as string];
          else if (ev["xaxis.autorange"]) [s, e] = [dates[0], end];
          if (!s || !e) return;
          const r = yRangeFor(points, s.slice(0, 10), e.slice(0, 10), logScale);
          if (!r) return;
          adjusting = true;
          Plotly.relayout(gd, { "yaxis.range": r, "yaxis.autorange": false }).finally(() => {
            adjusting = false;
          });
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [data, logScale]);

  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el) Plotly.purge(el);
    };
  }, []);

  return (
    <>
      <ul className="legend">
        <li><i className="swatch s-close" />Close</li>
        <li><i className="swatch s-ma" />Moving average</li>
        <li><i className="swatch s-p75" />75th percentile</li>
        <li><i className="swatch s-p25" />25th percentile</li>
      </ul>
      <div ref={ref} className="chart" />
    </>
  );
}
