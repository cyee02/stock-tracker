import { Point, SeriesResponse } from "../api";
import PriceChart, { cssVar } from "./PriceChart";

/** 50/200-day SMA crossover: close, both SMAs, and a marker at each golden or death cross. */
export default function SmaCrossChart({ data, logScale }: { data: SeriesResponse; logScale: boolean }) {
  const { points, sma } = data;
  const dates = points.map((p) => p.date);
  const byDate = new Map<string, Point>(points.map((p) => [p.date, p]));

  const crossTrace = (kind: "golden" | "death", hover: (label: string) => string) => {
    const hits = sma.crosses.filter((c) => c.kind === kind);
    const golden = kind === "golden";
    return {
      x: hits.map((c) => c.date),
      y: hits.map((c) => byDate.get(c.date)?.sma50 ?? null),
      name: golden ? "Golden cross" : "Death cross",
      type: "scatter",
      mode: "markers",
      marker: {
        symbol: golden ? "triangle-up" : "triangle-down",
        size: 13,
        color: cssVar(golden ? "--c-golden" : "--c-death"),
        line: { color: cssVar("--surface"), width: 1 },
      },
      hovertemplate: hover(golden ? "Golden cross" : "Death cross"),
    };
  };

  const traces = (hover: (label: string) => string) => [
    {
      x: dates,
      y: points.map((p) => p.close),
      name: "Close",
      type: "scatter",
      mode: "lines",
      line: { color: cssVar("--c-close"), width: 1.25 },
      opacity: 0.7,
      hovertemplate: hover("Close"),
    },
    {
      x: dates,
      y: points.map((p) => p.sma200),
      name: `${sma.slow}-day SMA`,
      type: "scatter",
      mode: "lines",
      line: { color: cssVar("--c-sma200"), width: 2 },
      hovertemplate: hover(`${sma.slow}d SMA`),
    },
    {
      x: dates,
      y: points.map((p) => p.sma50),
      name: `${sma.fast}-day SMA`,
      type: "scatter",
      mode: "lines",
      line: { color: cssVar("--c-sma50"), width: 2 },
      hovertemplate: hover(`${sma.fast}d SMA`),
    },
    crossTrace("golden", hover),
    crossTrace("death", hover),
  ];

  return (
    <PriceChart
      data={data}
      logScale={logScale}
      lookbackYears={5}
      values={(p) => [p.close, p.sma50, p.sma200]}
      traces={traces}
      legend={
        <>
          <li><i className="swatch s-close" />Close</li>
          <li><i className="swatch s-sma50" />{sma.fast}-day SMA</li>
          <li><i className="swatch s-sma200" />{sma.slow}-day SMA</li>
          <li><i className="marker m-golden">▲</i>Golden cross</li>
          <li><i className="marker m-death">▼</i>Death cross</li>
        </>
      }
    />
  );
}
