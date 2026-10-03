export const STRATEGIES = ["mean-reversion", "sma-cross"] as const;
export type Strategy = (typeof STRATEGIES)[number];

export const STRATEGY_INFO: Record<Strategy, { label: string; description: string }> = {
  "mean-reversion": {
    label: "Mean reversion",
    description:
      "Assumes prices drift back toward their recent average. The shaded band is the 25th–75th percentile " +
      "of closes over the window you picked above. A close below the band reads as underpriced, above it as overpriced.",
  },
  "sma-cross": {
    label: "50/200 SMA",
    description:
      "A trend-following signal. The 50-day SMA tracks intermediate momentum and the 200-day SMA long-term " +
      "momentum. A golden cross (50 crosses above 200) is bullish; a death cross (50 crosses below 200) is bearish. " +
      "Uses fixed 50 and 200 trading-day windows, so the window picker above doesn't apply.",
  },
};
