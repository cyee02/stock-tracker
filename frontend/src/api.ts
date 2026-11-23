import { getToken } from "./auth";

export const PERIODS = ["3m", "6m", "1y", "3y", "5y", "10y"] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_LABELS: Record<Period, string> = {
  "3m": "3 months",
  "6m": "6 months",
  "1y": "1 year",
  "3y": "3 years",
  "5y": "5 years",
  "10y": "10 years",
};
export type Signal = "underpriced" | "fair" | "overpriced";

export interface Point {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  ma: number | null;
  p25: number | null;
  p75: number | null;
  sma50: number | null;
  sma200: number | null;
}

export type Trend = "bullish" | "bearish";

export interface SmaCross {
  date: string;
  kind: "golden" | "death";
}

export interface TickerInfo {
  name: string | null;
  quote_type: string | null;
  description: string | null;
  nav: number | null;
  earnings_date: string | null;
  earnings_date_end: string | null;
}

export interface PeriodReturn {
  period: "YTD" | "1Y" | "5Y" | "10Y";
  total: number | null;
  annualized: number | null;
}

export interface SeriesResponse {
  ticker: string;
  currency: string | null;
  info: TickerInfo;
  /** Earliest date Yahoo has for the ticker; `points` may start later. */
  first_date: string;
  /** First date requested; `points` start on the first trading day on or after it. */
  start: string;
  period: Period;
  window: number;
  points: Point[];
  latest: Point & { signal: Signal; trend: Trend | null };
  sma: { fast: number; slow: number; crosses: SmaCross[] };
}

export interface ReturnsResponse {
  ticker: string;
  returns: PeriodReturn[];
}

/** One period of a statement; every line item may be missing for a given company. */
export interface IncomePeriod {
  period: string;
  revenue: number | null;
  cost_of_revenue: number | null;
  gross_profit: number | null;
  r_and_d: number | null;
  sga: number | null;
  operating_expense: number | null;
  operating_income: number | null;
  net_interest_income: number | null;
  pretax_income: number | null;
  tax: number | null;
  net_income: number | null;
  ebitda: number | null;
  diluted_eps: number | null;
  gross_margin: number | null;
  operating_margin: number | null;
  net_margin: number | null;
}

export interface CashflowPeriod {
  period: string;
  operating_cf: number | null;
  capex: number | null;
  free_cf: number | null;
  buybacks: number | null;
  dividends_paid: number | null;
  sbc: number | null;
}

export interface BalancePeriod {
  period: string;
  cash: number | null;
  total_debt: number | null;
  total_assets: number | null;
  total_liabilities: number | null;
  equity: number | null;
  current_assets: number | null;
  current_liabilities: number | null;
}

export interface Statements {
  income: IncomePeriod[];
  cashflow: CashflowPeriod[];
  balance: BalancePeriod[];
}

export interface EpsQuarter {
  quarter: string;
  actual: number | null;
  estimate: number | null;
  /** Fraction: 0.05 = beat by 5%. */
  surprise: number | null;
}

export type RatioKey =
  | "trailing_pe"
  | "forward_pe"
  | "peg"
  | "price_to_book"
  | "price_to_sales"
  | "ev_to_ebitda"
  | "gross_margin"
  | "operating_margin"
  | "net_margin"
  | "roe"
  | "roa"
  | "revenue_growth"
  | "earnings_growth"
  | "debt_to_equity"
  | "current_ratio"
  | "quick_ratio"
  | "free_cash_flow"
  | "dividend_yield"
  | "payout_ratio"
  | "beta"
  | "market_cap";

export interface FinancialsResponse {
  ticker: string;
  /** Currency the statements are reported in, which may differ from the quote's. */
  currency: string | null;
  quarterly: Statements;
  annual: Statements;
  eps_history: EpsQuarter[];
  ratios: Record<RatioKey, number | null>;
}

/** One watched ticker: latest session, signals, and NAV or next earnings. */
export interface WatchRow {
  ticker: string;
  /** Set when the prices couldn't be loaded; the other fields are then missing. */
  error: string | null;
  name?: string | null;
  quote_type?: string | null;
  currency?: string | null;
  nav?: number | null;
  earnings_date?: string | null;
  earnings_date_end?: string | null;
  date?: string;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  prev_close?: number | null;
  change_pct?: number | null;
  ma?: number | null;
  p25?: number | null;
  p75?: number | null;
  signal?: Signal | null;
  sma50?: number | null;
  sma200?: number | null;
  trend?: Trend | null;
  last_cross?: SmaCross | null;
}

export interface WatchlistResponse {
  /** Trading days in the mean-reversion window (1 year). */
  window: number;
  rows: WatchRow[];
}

export interface AlertEvent {
  id: number;
  ticker: string;
  line: "p25" | "ma" | "p75";
  line_label: string;
  direction: "above" | "below";
  price: number;
  level: number;
  currency: string | null;
  created_at: string;
}

export interface AlertsConfig {
  /** VAPID key a device subscribes with. */
  public_key: string;
  interval_seconds: number;
  last_check: string | null;
  devices: { endpoint: string; device: string | null }[];
  events: AlertEvent[];
}

/** Props every strategy chart takes. */
export interface ChartProps {
  data: SeriesResponse;
  view: import("./view").View;
  onViewChange: (view: import("./view").View) => void;
}

export interface NewsItem {
  title: string;
  url: string | null;
  publisher: string | null;
  published_at: string | null;
  summary: string | null;
  thumbnail: string | null;
}

export interface NewsResponse {
  ticker: string;
  /** Set when the headlines were looked up for a date range rather than the latest. */
  start: string | null;
  end: string | null;
  items: NewsItem[];
}

/** Inclusive calendar-date range of a dated news lookup. */
export interface DateRange {
  start: string;
  end: string;
}

export type Sentiment = "bullish" | "bearish" | "neutral" | "mixed";
export type StanceAction = "buy" | "hold" | "sell";
export type Impact = "positive" | "negative" | "neutral";

/** Claude's read of the headlines, shaped by the backend's SUMMARY_SCHEMA. */
export interface PricePoints {
  candlestick: string[];
  mean_reversion: string[];
  sma_trend: string[];
}

export interface NewsSummary {
  /** Missing on summaries saved before it was added. */
  one_liner?: string;
  /** How analysts and investors feel about the stock. */
  sentiment: { label: Sentiment; score: number; rationale: string };
  stance: { action: StanceAction; confidence: "low" | "medium" | "high"; horizon: string; rationale: string };
  top_happenings: { headline: string; why_it_matters: string; impact: Impact; urls: string[] }[];
  /** Bullet points per chart; a paragraph on summaries saved before that. */
  price_context: PricePoints | string;
  /** Only on summaries saved before the view and analyst sections were merged. */
  analyst_view?: string;
  risks: string[];
  catalysts: { event: string; date: string | null }[];
  bull_case: string;
  bear_case: string;
  articles_read: string[];
}

/** Yahoo's analyst consensus, sent alongside the summary as real numbers. */
export interface AnalystData {
  recommendation: string | null;
  analyst_count: number | null;
  current_price: number | null;
  target_low: number | null;
  target_mean: number | null;
  target_median: number | null;
  target_high: number | null;
  strong_buy: number | null;
  buy: number | null;
  hold: number | null;
  sell: number | null;
  strong_sell: number | null;
}

export interface PriceContext {
  as_of: string;
  close: number | null;
  currency: string | null;
  /** The as-of session's candle; missing on older summaries or without OHLC data. */
  ohlc?: { open: number | null; high: number | null; low: number | null; close: number | null } | null;
  prev_close?: number | null;
  change_pct?: number | null;
  mean_reversion_1y: { p25: number | null; p75: number | null; moving_average: number | null; signal: Signal | null };
  sma50: number | null;
  sma200: number | null;
  trend: Trend | null;
  last_cross: SmaCross | null;
  returns: Record<string, number>;
}

/** A generated summary with the data it was based on. */
export interface SummaryEntry {
  generated_at: string;
  model: string | null;
  summary: NewsSummary;
  analyst: AnalystData | null;
  price: PriceContext | null;
  earnings: { date: string; estimated_until: string | null } | null;
  articles_total: number;
}

/** Claude's analysis of a company's financials (see backend app/fin_summary.py). */
export type Health = "strong" | "solid" | "mixed" | "weak";
export type ValuationLabel = "cheap" | "fair" | "expensive";
export type MetricTrend = "improving" | "stable" | "deteriorating" | "unclear";
export type PeerVerdict = "favorable" | "in_line" | "unfavorable";

export interface FinancialSummary {
  one_liner: string;
  health: { label: Health; rationale: string };
  valuation: { label: ValuationLabel; rationale: string };
  metrics_to_watch: { metric: string; value: string; trend: MetricTrend; why: string; watch_for: string }[];
  peer_comparison: { metric: RatioKey; verdict: PeerVerdict; comment: string }[];
  peer_notes: string;
  statement_insights: { growth: string[]; profitability: string[]; cash_flow: string[]; balance_sheet: string[] };
  strengths: string[];
  concerns: string[];
  sources: string[];
}

export interface Peer {
  ticker: string;
  name: string | null;
  industry: string | null;
  same_industry: boolean;
  market_cap: number | null;
  currency: string | null;
  ratios: Record<RatioKey, number | null>;
}

export interface CompanyProfile {
  name: string | null;
  sector: string | null;
  industry: string | null;
  market_cap: number | null;
}

/** A generated financial analysis with the numbers it was based on. */
export interface FinSummaryEntry {
  generated_at: string;
  model: string | null;
  summary: FinancialSummary;
  /** End of the latest reported period the analysis covers. */
  period: string;
  currency: string | null;
  profile: CompanyProfile;
  ratios: Record<RatioKey, number | null>;
  peers: Peer[];
  peer_median: Record<RatioKey, number | null> | null;
}

/** Where a summary came from and whether it's saved; shared by news and financials. */
interface SummaryStatus {
  saved: boolean;
  saved_id: number | null;
  saved_at: string | null;
  /** A refreshed summary in the cache is newer than the saved one. */
  has_newer_unsaved: boolean;
  /** A background Claude run, if one is going or just failed. */
  job: SummaryJobStatus | null;
}

export type FinSummaryResponse = { ticker: string; kind: "financials"; period: string } & SummaryStatus &
  ({ summary: null } | (FinSummaryEntry & { source: "cache" | "saved"; expires_in: number | null }));

export type NewsSummaryResponse = {
  ticker: string;
  start: string | null;
  end: string | null;
  saved: boolean;
  saved_id: number | null;
  saved_at: string | null;
  /** A refreshed summary in the cache is newer than the saved one. */
  has_newer_unsaved: boolean;
  /** A background Claude run for these headlines, if one is going or just failed. */
  job: SummaryJobStatus | null;
} & (
  | { summary: null }
  | (SummaryEntry & { source: "cache" | "saved"; expires_in: number | null })
);

/** List badges: sentiment and stance for news, health and valuation for financials. */
interface SummaryBadges {
  sentiment?: Sentiment | null;
  stance?: StanceAction | null;
  health?: Health | null;
  valuation?: ValuationLabel | null;
}

export interface SavedSummaryRow extends SummaryKeyFields, SummaryBadges {
  id: number;
  generated_at: string;
  saved_at: string;
  model: string | null;
}

type SavedMeta = Omit<SavedSummaryRow, keyof SummaryBadges | "kind" | "period">;
export type SavedSummary = SavedMeta & SummaryEntry;
/** A saved summary of either kind; tell them apart by `range_key` (see `isFinKey`). */
export type SavedAnySummary = SavedMeta & (SummaryEntry | FinSummaryEntry);

export const isFinKey = (rangeKey: string) => rangeKey.startsWith("fin:");

export type SummaryJobStatus =
  /** `save_when_done`: the run saves its result as soon as it finishes. */
  | { status: "running"; started_at: string; save_when_done: boolean }
  | { status: "failed"; error: string };

/** Identifies what a summary covers: the headlines (news) or the reporting period (financials). */
export interface SummaryKeyFields {
  ticker: string;
  range_key: string;
  kind: "news" | "financials";
  start: string | null;
  end: string | null;
  period: string | null;
}

/** A generated summary still in the 1-hour cache and not saved (or newer than the saved copy). */
export interface UnsavedSummaryRow extends SummaryKeyFields, SummaryBadges {
  generated_at: string;
  expires_in: number;
  model: string | null;
  replaces_saved: boolean;
}

export interface SummaryJobRow extends SummaryKeyFields {
  status: "running" | "failed";
  started_at: string | null;
  save_when_done: boolean;
  error: string | null;
}

export interface SummariesOverview {
  items: SavedSummaryRow[];
  unsaved: UnsavedSummaryRow[];
  jobs: SummaryJobRow[];
}

export interface Me {
  role: "admin" | "viewer";
  name: string;
}

export interface ShareLink {
  id: number;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked: boolean;
  token?: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, token = getToken()): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  me: (token?: string | null) => request<Me>("/api/me", {}, token ?? getToken()),
  series: (ticker: string, period: Period, start?: string) =>
    request<SeriesResponse>(
      `/api/series?ticker=${encodeURIComponent(ticker)}&period=${period}${start ? `&start=${start}` : ""}`,
    ),
  returns: (ticker: string) => request<ReturnsResponse>(`/api/returns?ticker=${encodeURIComponent(ticker)}`),
  watchlist: () => request<WatchlistResponse>("/api/watchlist"),
  watchlistTickers: () => request<{ tickers: string[] }>("/api/watchlist/tickers"),
  watch: (ticker: string) =>
    request<{ tickers: string[] }>(`/api/watchlist/${encodeURIComponent(ticker)}`, { method: "PUT" }),
  unwatch: (ticker: string) =>
    request<{ tickers: string[] }>(`/api/watchlist/${encodeURIComponent(ticker)}`, { method: "DELETE" }),
  alerts: () => request<AlertsConfig>("/api/alerts"),
  subscribeAlerts: (sub: { endpoint: string; keys: { p256dh: string; auth: string }; device: string }) =>
    request<void>("/api/alerts/subscriptions", { method: "POST", body: JSON.stringify(sub) }),
  unsubscribeAlerts: (endpoint: string) =>
    request<void>("/api/alerts/subscriptions/remove", { method: "POST", body: JSON.stringify({ endpoint }) }),
  testAlert: () => request<{ sent: number; devices: number }>("/api/alerts/test", { method: "POST" }),
  financials: (ticker: string) =>
    request<FinancialsResponse>(`/api/financials?ticker=${encodeURIComponent(ticker)}`),
  news: (ticker: string, range?: DateRange) =>
    request<NewsResponse>(
      `/api/news?ticker=${encodeURIComponent(ticker)}${range ? `&start=${range.start}&end=${range.end}` : ""}`,
    ),
  /** Saved or cached summary for these headlines; never calls Claude. */
  peekNewsSummary: (ticker: string, range?: DateRange | null) =>
    request<NewsSummaryResponse>(
      `/api/news/summary?ticker=${encodeURIComponent(ticker)}${range ? `&start=${range.start}&end=${range.end}` : ""}`,
    ),
  newsSummary: (ticker: string, range?: DateRange | null, refresh = false) =>
    request<NewsSummaryResponse>("/api/news/summary", {
      method: "POST",
      body: JSON.stringify({ ticker, start: range?.start ?? null, end: range?.end ?? null, refresh }),
    }),
  /** `whenDone` while a run is going: save its result when it finishes instead. */
  saveNewsSummary: (ticker: string, range?: DateRange | null, whenDone = false) =>
    request<unknown>("/api/news/summaries", {
      method: "POST",
      body: JSON.stringify({ ticker, start: range?.start ?? null, end: range?.end ?? null, when_done: whenDone }),
    }),
  cancelNewsSaveWhenDone: (ticker: string, range?: DateRange | null) =>
    request<void>(
      `/api/news/summary/save-when-done?ticker=${encodeURIComponent(ticker)}${range ? `&start=${range.start}&end=${range.end}` : ""}`,
      { method: "DELETE" },
    ),
  /** Saved or cached analysis of the latest (or given) period's financials; never calls Claude. */
  peekFinSummary: (ticker: string, period?: string | null) =>
    request<FinSummaryResponse>(
      `/api/financials/summary?ticker=${encodeURIComponent(ticker)}${period ? `&period=${period}` : ""}`,
    ),
  finSummary: (ticker: string, refresh = false) =>
    request<FinSummaryResponse>("/api/financials/summary", {
      method: "POST",
      body: JSON.stringify({ ticker, refresh }),
    }),
  /** `whenDone` while a run is going: save its result when it finishes instead. */
  saveFinSummary: (ticker: string, period?: string | null, whenDone = false) =>
    request<unknown>("/api/financials/summaries", {
      method: "POST",
      body: JSON.stringify({ ticker, period: period ?? null, when_done: whenDone }),
    }),
  cancelFinSaveWhenDone: (ticker: string, period?: string | null) =>
    request<void>(
      `/api/financials/summary/save-when-done?ticker=${encodeURIComponent(ticker)}${period ? `&period=${period}` : ""}`,
      { method: "DELETE" },
    ),
  /** Saved, unsaved-but-cached and in-progress summaries of both kinds; all tickers unless one is given. */
  summariesOverview: (ticker?: string) =>
    request<SummariesOverview>(`/api/news/summaries${ticker ? `?ticker=${encodeURIComponent(ticker)}` : ""}`),
  getSavedSummary: (id: number) => request<SavedAnySummary>(`/api/news/summaries/${id}`),
  deleteSavedSummary: (id: number) => request<void>(`/api/news/summaries/${id}`, { method: "DELETE" }),
  listLinks: () => request<ShareLink[]>("/api/admin/links"),
  createLink: (name: string) =>
    request<ShareLink>("/api/admin/links", { method: "POST", body: JSON.stringify({ name }) }),
  revokeLink: (id: number) => request<void>(`/api/admin/links/${id}`, { method: "DELETE" }),
};
