import { ReactNode, useEffect, useRef } from "react";
import Plotly, { PlotlyElement } from "plotly.js-finance-dist-min";
import { Point, SeriesResponse } from "../api";
import { monthEnd, Preset, PRESETS, presetStart, TODAY, View, viewEnd } from "../view";

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Year + month dropdowns; `allowToday` adds a "Today" choice to the year list that hides the month. */
function MonthPicker({
  label,
  value,
  years,
  allowToday,
  onChange,
}: {
  label: string;
  value: string;
  years: number[];
  allowToday?: boolean;
  onChange: (ym: string) => void;
}) {
  const today = value === TODAY;
  const [y, m] = today ? ["", ""] : value.split("-");
  return (
    <span className="month-picker">
      <span className="muted">{label}</span>
      {!today && (
        <select aria-label={`${label} month`} value={m} onChange={(e) => onChange(`${y}-${e.target.value}`)}>
          {MONTHS.map((name, i) => (
            <option key={name} value={String(i + 1).padStart(2, "0")}>
              {name}
            </option>
          ))}
        </select>
      )}
      <select
        aria-label={`${label} year`}
        value={today ? TODAY : y}
        onChange={(e) => onChange(e.target.value === TODAY ? TODAY : `${e.target.value}-${m || "12"}`)}
      >
        {allowToday && <option value={TODAY}>Today</option>}
        {years.map((yr) => (
          <option key={yr} value={yr}>
            {yr}
          </option>
        ))}
      </select>
    </span>
  );
}

/** Y range covering every plotted value within the visible date window. */
function yRangeFor(
  points: Point[],
  values: (p: Point) => (number | null)[],
  start: string,
  end: string,
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
  const pad = (hi - lo) * 0.05 || hi * 0.05;
  return [lo - pad, hi + pad];
}

interface Props {
  data: SeriesResponse;
  /** Visible date range, owned by the page so it survives strategy switches and reloads. */
  view: View;
  onViewChange: (view: View) => void;
  /** Values the y axis must fit for a point. */
  values: (p: Point) => (number | null)[];
  /** Plotly traces; `hover(label)` gives the shared hover template. */
  traces: (hover: (label: string) => string) => object[];
  legend?: ReactNode;
  /** Merged into the layout, one level deep (e.g. extra axes, or `yaxis.domain`). */
  layout?: Record<string, unknown>;
  /** Redraws the traces when it changes, for overlays that load after the prices. */
  redrawKey?: unknown;
  /** Clicking the plot reports the date under the pointer. */
  onDateClick?: (date: string) => void;
}

/**
 * Price chart shared by every strategy: range presets, start/end month pickers, slider,
 * and a y axis that refits to whatever is visible.
 */
export default function PriceChart({
  data,
  view,
  onViewChange,
  values,
  traces,
  legend,
  layout: extraLayout,
  redrawKey,
  onDateClick,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const ready = useRef(false);
  // Set while we move the axes ourselves, so the relayout handler doesn't echo it back as a user zoom.
  const selfUpdate = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const onViewRef = useRef(onViewChange);
  onViewRef.current = onViewChange;
  const onClickRef = useRef(onDateClick);
  onClickRef.current = onDateClick;

  const first = data.first_date;
  const last = data.latest.date;
  const xRange = (v: View): [string, string] => [v.start, viewEnd(v, last)];

  const setFrom = (ym: string) => {
    const start = `${ym}-01` < first ? first : `${ym}-01`;
    // Moving the start past the end drags the end along to today.
    onViewChange({ start, end: start > viewEnd(view, last) ? TODAY : view.end });
  };
  const setTo = (ym: string) => {
    const end = ym === TODAY ? TODAY : monthEnd(ym) >= last ? TODAY : monthEnd(ym);
    const start = end !== TODAY && end < view.start ? `${ym}-01` : view.start;
    onViewChange({ start, end });
  };
  const activePreset = PRESETS.find((p) => view.end === TODAY && view.start === presetStart(p, last, first));

  const years: number[] = [];
  for (let y = Number(last.slice(0, 4)); y >= Number(first.slice(0, 4)); y--) years.push(y);

  // Full redraw when the data changes.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { points, currency } = data;
    const colors = {
      text: cssVar("--fg-muted"),
      grid: cssVar("--grid"),
      bg: cssVar("--surface"),
      fg: cssVar("--fg"),
    };
    const unit = currency ? ` ${currency}` : "";
    const hover = (label: string) => `${label}: %{y:,.2f}${unit}<extra></extra>`;
    const [start, end] = xRange(viewRef.current);
    const yRange = yRangeFor(points, values, start, end);

    const base: Record<string, unknown> = {
      autosize: true,
      height: Math.max(360, Math.min(600, window.innerHeight * 0.62)),
      margin: { l: 48, r: 12, t: 12, b: 8 },
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
        rangeslider: { visible: true, thickness: 0.08, bgcolor: colors.bg, bordercolor: colors.grid },
      },
      yaxis: {
        type: "linear",
        gridcolor: colors.grid,
        fixedrange: false,
        tickformat: ",.2~f",
        ...(yRange ? { range: yRange, autorange: false } : { autorange: true }),
      },
    };
    const layout = { ...base };
    for (const [k, v] of Object.entries(extraLayout ?? {})) {
      const cur = layout[k];
      layout[k] = cur && typeof cur === "object" && v && typeof v === "object" ? { ...cur, ...v } : v;
    }

    let cancelled = false;
    ready.current = false;
    Plotly.react(el, traces(hover), layout, { responsive: true, displayModeBar: false }).then(
      (gd: PlotlyElement) => {
        if (cancelled) return;
        ready.current = true;
        gd.removeAllListeners?.("plotly_relayout");
        gd.removeAllListeners?.("plotly_click");
        gd.on("plotly_click", (ev) => {
          const pts = ev.points as { x?: unknown }[] | undefined;
          const x = pts?.[0]?.x;
          if (typeof x === "string") onClickRef.current?.(x.slice(0, 10));
        });
        // Zooming, dragging the slider or double-clicking reports the new range up to the page.
        gd.on("plotly_relayout", (ev) => {
          if (selfUpdate.current) return;
          let s: string | undefined;
          let e: string | undefined;
          if (Array.isArray(ev["xaxis.range"])) [s, e] = ev["xaxis.range"] as string[];
          else if (ev["xaxis.range[0]"]) [s, e] = [ev["xaxis.range[0]"] as string, ev["xaxis.range[1]"] as string];
          else if (ev["xaxis.autorange"]) [s, e] = [points[0].date, last];
          if (!s || !e) return;
          const [s10, e10] = [s.slice(0, 10), e.slice(0, 10)];
          onViewRef.current({ start: s10, end: e10 >= last ? TODAY : e10 });
        });
      },
    );
    return () => {
      cancelled = true;
    };
    // traces/values are rebuilt every render from `data`; redraw only when the data
    // (or an overlay, via redrawKey) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, redrawKey]);

  // Move the axes when the view changes, refitting y to the visible values.
  useEffect(() => {
    const gd = ref.current as PlotlyElement | null;
    if (!gd || !ready.current) return;
    const [s, e] = xRange(view);
    const update: Record<string, unknown> = {};
    const cur = gd.layout?.xaxis?.range;
    if (!cur || String(cur[0]).slice(0, 10) !== s || String(cur[1]).slice(0, 10) !== e) {
      update["xaxis.range"] = [s, e];
    }
    const yr = yRangeFor(data.points, values, s, e);
    if (yr) Object.assign(update, { "yaxis.range": yr, "yaxis.autorange": false });
    if (!Object.keys(update).length) return;
    selfUpdate.current = true;
    Plotly.relayout(gd, update).finally(() => {
      selfUpdate.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.start, view.end]);

  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el) Plotly.purge(el);
    };
  }, []);

  return (
    <>
      <div className="chart-controls">
        <span className="range-presets" role="group" aria-label="Date range">
          {PRESETS.map((p: Preset) => (
            <button
              key={p}
              className={`range-btn${activePreset === p ? " active" : ""}`}
              aria-pressed={activePreset === p}
              onClick={() => onViewChange({ start: presetStart(p, last, first), end: TODAY })}
            >
              {p}
            </button>
          ))}
        </span>
        <span className="range-pickers">
          <MonthPicker label="From" value={view.start.slice(0, 7)} years={years} onChange={setFrom} />
          <MonthPicker
            label="To"
            value={view.end === TODAY ? TODAY : view.end.slice(0, 7)}
            years={years}
            allowToday
            onChange={setTo}
          />
        </span>
      </div>
      {legend && <ul className="legend">{legend}</ul>}
      <div ref={ref} className={`chart${onDateClick ? " clickable" : ""}`} />
    </>
  );
}
