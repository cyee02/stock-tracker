import { Period, SeriesResponse } from "../api";
import PriceChart, { cssVar } from "./PriceChart";

const PERIOD_YEARS: Record<Period, number> = { "3m": 0.25, "6m": 0.5, "1y": 1, "3y": 3, "5y": 5, "10y": 10 };

/** Mean reversion: close, trailing moving average and the 25th–75th percentile band. */
export default function BandChart({ data, logScale }: { data: SeriesResponse; logScale: boolean }) {
  const { points } = data;
  const dates = points.map((p) => p.date);

  const traces = (hover: (label: string) => string) => [
    {
      x: dates,
      y: points.map((p) => p.p75),
      name: "75th percentile",
      type: "scatter",
      mode: "lines",
      line: { color: cssVar("--c-p75"), width: 1.25 },
      hovertemplate: hover("75th pct"),
    },
    {
      x: dates,
      y: points.map((p) => p.p25),
      name: "25th percentile",
      type: "scatter",
      mode: "lines",
      line: { color: cssVar("--c-p25"), width: 1.25 },
      fill: "tonexty",
      fillcolor: cssVar("--c-band"),
      hovertemplate: hover("25th pct"),
    },
    {
      x: dates,
      y: points.map((p) => p.ma),
      name: "Moving average",
      type: "scatter",
      mode: "lines",
      line: { color: cssVar("--c-ma"), width: 1.75, dash: "dash" },
      hovertemplate: hover("MA"),
    },
    {
      x: dates,
      y: points.map((p) => p.close),
      name: "Close",
      type: "scatter",
      mode: "lines",
      line: { color: cssVar("--c-close"), width: 1.5 },
      hovertemplate: hover("Close"),
    },
  ];

  return (
    <PriceChart
      data={data}
      logScale={logScale}
      lookbackYears={Math.max(5, PERIOD_YEARS[data.period] * 2)}
      values={(p) => [p.close, p.ma, p.p25, p.p75]}
      traces={traces}
      legend={
        <>
          <li><i className="swatch s-close" />Close</li>
          <li><i className="swatch s-ma" />Moving average</li>
          <li><i className="swatch s-p75" />75th percentile</li>
          <li><i className="swatch s-p25" />25th percentile</li>
        </>
      }
    />
  );
}
