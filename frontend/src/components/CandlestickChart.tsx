import { ChartProps } from "../api";
import PriceChart, { cssVar } from "./PriceChart";

/** Daily OHLC candles: green when close > open, red when close < open. */
export default function CandlestickChart({ data, view, onViewChange }: ChartProps) {
  const { points } = data;
  // Rows without OHLC (shouldn't happen from Yahoo) are skipped rather than drawn as gaps.
  const candles = points.filter((p) => p.open !== null && p.high !== null && p.low !== null);

  const traces = () => [
    {
      x: candles.map((p) => p.date),
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
  ];

  return (
    <PriceChart
      data={data}
      view={view}
      onViewChange={onViewChange}
      values={(p) => [p.high, p.low]}
      traces={traces}
    />
  );
}
