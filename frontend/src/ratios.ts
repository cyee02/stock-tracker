import type { RatioKey } from "./api";

/** How a ratio's value is shown: a multiple (12.3x), a percentage, a plain number or an amount. */
export type RatioFormat = "x" | "pct" | "num" | "money";

export interface RatioInfo {
  label: string;
  format: RatioFormat;
  /** What it measures. */
  what: string;
  /** How to read it. */
  howToUse: string;
}

export const RATIO_GROUPS: { title: string; keys: RatioKey[] }[] = [
  { title: "Valuation", keys: ["trailing_pe", "forward_pe", "peg", "price_to_book", "price_to_sales", "ev_to_ebitda"] },
  { title: "Profitability", keys: ["gross_margin", "operating_margin", "net_margin", "roe", "roa"] },
  { title: "Growth", keys: ["revenue_growth", "earnings_growth"] },
  { title: "Financial health", keys: ["debt_to_equity", "current_ratio", "quick_ratio", "free_cash_flow"] },
  { title: "Shareholder returns & risk", keys: ["dividend_yield", "payout_ratio", "beta", "market_cap"] },
];

export const RATIO_INFO: Record<RatioKey, RatioInfo> = {
  trailing_pe: {
    label: "P/E (TTM)",
    format: "x",
    what: "Share price ÷ earnings per share over the last 12 months: what you pay for $1 of profit.",
    howToUse:
      "Compare with peers in the same industry and with the stock's own history. A high P/E means the market expects growth; a low one can mean value, or trouble. Meaningless when earnings are negative.",
  },
  forward_pe: {
    label: "Forward P/E",
    format: "x",
    what: "Share price ÷ analysts' estimate of earnings per share for the next 12 months.",
    howToUse:
      "Lower than the trailing P/E means profits are expected to grow. It rests on estimates, so it's only as good as the forecasts behind it.",
  },
  peg: {
    label: "PEG",
    format: "num",
    what: "P/E ÷ expected annual earnings growth (in %). Adjusts the P/E for how fast profits grow.",
    howToUse:
      "Around 1 is often called fairly priced for its growth, under 1 cheap, over 2 expensive. Most useful for growing companies; less so for mature or cyclical ones.",
  },
  price_to_book: {
    label: "P/B",
    format: "x",
    what: "Market value ÷ book value (assets minus liabilities on the balance sheet).",
    howToUse:
      "Most useful for banks, insurers and asset-heavy firms; under 1 can signal undervaluation. Asset-light firms with big buybacks (e.g. Apple) show very high P/B, which says little on its own.",
  },
  price_to_sales: {
    label: "P/S (TTM)",
    format: "x",
    what: "Market value ÷ revenue over the last 12 months.",
    howToUse:
      "Handy for companies that aren't profitable yet. Compare within an industry: high-margin software justifies a far higher P/S than a supermarket.",
  },
  ev_to_ebitda: {
    label: "EV/EBITDA",
    format: "x",
    what: "Enterprise value (market cap + debt − cash) ÷ earnings before interest, tax, depreciation and amortisation.",
    howToUse:
      "Like P/E but neutral to how the company is financed, so it compares firms with different debt levels fairly. Roughly 10x is a common midpoint; varies a lot by sector.",
  },
  gross_margin: {
    label: "Gross margin",
    format: "pct",
    what: "(Revenue − cost of goods sold) ÷ revenue: what's left after making the product.",
    howToUse:
      "Shows pricing power and production efficiency. A high or rising margin is good; watch for a falling trend versus prior quarters and competitors.",
  },
  operating_margin: {
    label: "Operating margin",
    format: "pct",
    what: "Operating income ÷ revenue: profit from the core business after all running costs (R&D, sales, admin).",
    howToUse:
      "Shows how well management controls costs. Compare across quarters: margins that expand as revenue grows mean the business scales well.",
  },
  net_margin: {
    label: "Net margin",
    format: "pct",
    what: "Net income ÷ revenue: the share of every sale that ends up as profit after everything, including interest and tax.",
    howToUse:
      "The bottom line on profitability. One-off gains or charges can distort a single period, so look at the trend.",
  },
  roe: {
    label: "Return on equity",
    format: "pct",
    what: "Net income ÷ shareholders' equity: profit generated per $1 that shareholders own in the business.",
    howToUse:
      "15%+ is generally strong. Very high ROE can come from heavy debt or buybacks shrinking equity, so check it alongside Debt/Equity.",
  },
  roa: {
    label: "Return on assets",
    format: "pct",
    what: "Net income ÷ total assets: how efficiently the company turns its assets into profit.",
    howToUse:
      "Above 5% is decent for most industries; banks run near 1%. Unlike ROE, it isn't flattered by debt.",
  },
  revenue_growth: {
    label: "Revenue growth (YoY)",
    format: "pct",
    what: "Latest quarter's revenue vs. the same quarter a year earlier.",
    howToUse:
      "Year-over-year avoids seasonal swings. Consistent growth is what supports a high P/E; slowing growth often precedes a re-rating down.",
  },
  earnings_growth: {
    label: "Earnings growth (YoY)",
    format: "pct",
    what: "Latest quarter's earnings per share vs. the same quarter a year earlier.",
    howToUse:
      "Earnings growing faster than revenue means margins are widening. Check whether a jump comes from operations or a one-off item.",
  },
  debt_to_equity: {
    label: "Debt/Equity",
    format: "x",
    what: "Total debt ÷ shareholders' equity: how much the company is financed by borrowing.",
    howToUse:
      "Under 1x is generally conservative, over 2x is highly leveraged. Normal levels vary by sector (utilities and banks run higher). Rising debt with falling cash flow is a warning sign.",
  },
  current_ratio: {
    label: "Current ratio",
    format: "x",
    what: "Current assets ÷ current liabilities: can the company pay bills due within a year?",
    howToUse:
      "Above 1 means short-term assets cover short-term debts; 1.5–2 is comfortable. Some strong companies run near 1 on purpose because they collect cash fast.",
  },
  quick_ratio: {
    label: "Quick ratio",
    format: "x",
    what: "(Cash + receivables + short-term investments) ÷ current liabilities: like the current ratio, but excluding inventory.",
    howToUse:
      "A stricter liquidity test. Above 1 means the company could pay short-term debts without selling stock-on-hand.",
  },
  free_cash_flow: {
    label: "Free cash flow (TTM)",
    format: "money",
    what: "Operating cash flow − capital expenditure over the last 12 months: cash left over after running and investing in the business.",
    howToUse:
      "This is the cash available for dividends, buybacks and paying down debt. Positive and growing is what you want; harder to fake than earnings.",
  },
  dividend_yield: {
    label: "Dividend yield",
    format: "pct",
    what: "Annual dividends per share ÷ share price.",
    howToUse:
      "Income you get for holding the stock. An unusually high yield can mean the price has fallen on bad news and the dividend may be cut, so check the payout ratio.",
  },
  payout_ratio: {
    label: "Payout ratio",
    format: "pct",
    what: "Dividends ÷ net income: the share of profit paid out to shareholders.",
    howToUse:
      "Under 60% is usually sustainable for most companies and leaves room to raise it. Over 100% means the dividend is paid from more than it earns.",
  },
  beta: {
    label: "Beta (5Y)",
    format: "num",
    what: "How much the stock moves relative to the overall market, measured over 5 years of monthly returns.",
    howToUse:
      "1 moves with the market, 1.5 swings 50% more, 0.5 half as much. Higher beta means bigger gains and losses; it measures volatility, not quality.",
  },
  market_cap: {
    label: "Market cap",
    format: "money",
    what: "Share price × shares outstanding: what the market values the whole company at.",
    howToUse:
      "Sets the size class (large cap > $10B, mid $2–10B, small < $2B). Large caps tend to be steadier; small caps can grow faster but are riskier.",
  },
};
