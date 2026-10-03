import { ReactNode, useEffect, useRef } from "react";
import Plotly, { PlotlyElement } from "plotly.js-basic-dist-min";
import { Point, SeriesResponse } from "../api";

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function shiftYears(date: string, years: number): string {
  const d = new Date(date);
  d.setMonth(d.getMonth() - Math.round(years * 12));
  return d.toISOString().slice(0, 10);
}

/** Y range covering every plotted value within the visible date window. */
function yRangeFor(
  points: Point[],
  values: (p: Point) => (number | null)[],
  start: string,
  end: string,
  log: boolean,
): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    if (p.date < start || p.date > end) continue;
    for (const v of values(p)) {
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

interface Props {
  data: SeriesResponse;
  logScale: boolean;
  /** How far back the initial view reaches. */
  lookbackYears: number;
  /** Values the y axis must fit for a point. */
  values: (p: Point) => (number | null)[];
  /** Plotly traces; `hover(label)` gives the shared hover template. */
  traces: (hover: (label: string) => string) => object[];
  legend: ReactNode;
}

/** Price chart shared by every strategy: date range buttons, slider, and y axis that refits on zoom. */
export default function PriceChart({ data, logScale, lookbackYears, values, traces, legend }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { points, currency } = data;
    const dates = points.map((p) => p.date);
    const colors = {
      text: cssVar("--fg-muted"),
      grid: cssVar("--grid"),
      bg: cssVar("--surface"),
      fg: cssVar("--fg"),
    };
    const unit = currency ? ` ${currency}` : "";
    const hover = (label: string) => `${label}: %{y:,.2f}${unit}<extra></extra>`;

    const end = dates[dates.length - 1];
    const start = dates[0] > shiftYears(end, lookbackYears) ? dates[0] : shiftYears(end, lookbackYears);
    const yRange = yRangeFor(points, values, start, end, logScale);

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
    Plotly.react(el, traces(hover), layout, { responsive: true, displayModeBar: false }).then(
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
          const r = yRangeFor(points, values, s.slice(0, 10), e.slice(0, 10), logScale);
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
    // traces/values are rebuilt every render from `data`; redraw only when the inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, logScale, lookbackYears]);

  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el) Plotly.purge(el);
    };
  }, []);

  return (
    <>
      <ul className="legend">{legend}</ul>
      <div ref={ref} className="chart" />
    </>
  );
}
