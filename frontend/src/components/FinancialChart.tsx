import { useEffect, useRef } from "react";
import Plotly from "plotly.js-finance-dist-min";
import { cssVar, IS_TOUCH } from "./PriceChart";

export interface Series {
  name: string;
  /** CSS custom property holding the series colour, e.g. "--s1". */
  color: string;
  values: (number | null)[];
  /** Extra line in this series' hover, per period. */
  hoverExtra?: (string | null)[];
  /** Small label drawn at the bar tip, per period. */
  labels?: (string | null)[];
}

export type Unit = "money" | "pct" | "eps";

interface Props {
  periods: string[];
  series: Series[];
  kind: "bar" | "stack" | "line";
  unit: Unit;
  currency: string | null;
}

/** Scale big amounts to billions or millions so axis ticks stay short. */
function scaleFor(series: Series[], unit: Unit): [number, string] {
  if (unit !== "money") return [1, ""];
  const max = Math.max(0, ...series.flatMap((s) => s.values.map((v) => Math.abs(v ?? 0))));
  return max >= 1e9 ? [1e9, "B"] : max >= 1e6 ? [1e6, "M"] : max >= 1e3 ? [1e3, "K"] : [1, ""];
}

/** Bars, stacked bars or lines over a few reporting periods, on one y-axis. */
export default function FinancialChart({ periods, series, kind, unit, currency }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const colors = { text: cssVar("--fg-muted"), grid: cssVar("--grid"), bg: cssVar("--surface"), fg: cssVar("--fg") };
    const [div, suffix] = scaleFor(series, unit);
    const pct = unit === "pct";
    const valueFmt = pct ? "%{y:.1%}" : unit === "eps" ? "%{y:.2f}" : `%{y:,.2f}${suffix}`;
    const cur = currency && !pct ? ` ${currency}` : "";

    const traces = series.map((s) => ({
      type: kind === "line" ? "scatter" : "bar",
      mode: kind === "line" ? "lines+markers" : undefined,
      name: s.name,
      x: periods,
      y: s.values.map((v) => (v === null ? null : v / div)),
      customdata: s.hoverExtra,
      text: s.labels,
      textposition: s.labels ? "outside" : undefined,
      textfont: { color: colors.text, size: 11 },
      cliponaxis: false,
      marker: kind === "line" ? { color: cssVar(s.color), size: 8, line: { color: colors.bg, width: 2 } } : { color: cssVar(s.color) },
      line: kind === "line" ? { color: cssVar(s.color), width: 2 } : undefined,
      connectgaps: false,
      hovertemplate: `${s.name}: ${valueFmt}${cur}${s.hoverExtra ? "%{customdata}" : ""}<extra></extra>`,
    }));

    const layout = {
      autosize: true,
      height: 280,
      margin: { l: 52, r: 8, t: 8, b: 28 },
      paper_bgcolor: colors.bg,
      plot_bgcolor: colors.bg,
      font: { color: colors.text, family: "inherit", size: 12 },
      hovermode: "x unified",
      hoverlabel: { bgcolor: colors.bg, bordercolor: colors.grid, font: { color: colors.fg } },
      dragmode: IS_TOUCH ? false : "zoom",
      barmode: kind === "stack" ? "relative" : "group",
      bargap: 0.3,
      bargroupgap: 0.08,
      barcornerradius: 4,
      showlegend: series.length > 1,
      legend: { orientation: "h", x: 0, y: 1.02, yanchor: "bottom", font: { size: 12 } },
      xaxis: { type: "category", gridcolor: colors.grid, fixedrange: true },
      yaxis: {
        gridcolor: colors.grid,
        zerolinecolor: colors.text,
        zerolinewidth: 1,
        fixedrange: true,
        tickformat: pct ? ".0%" : unit === "eps" ? ".2f" : ",.0f",
        ticksuffix: suffix,
        automargin: true,
      },
    };
    Plotly.react(el, traces, layout, { responsive: true, displayModeBar: false });
  }, [periods, series, kind, unit, currency]);

  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el) Plotly.purge(el);
    };
  }, []);

  return <div ref={ref} className="chart fin-chart" />;
}
