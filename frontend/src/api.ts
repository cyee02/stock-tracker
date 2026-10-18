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

export interface SavedSummaryRow {
  id: number;
  ticker: string;
  range_key: string;
  start: string | null;
  end: string | null;
  generated_at: string;
  saved_at: string;
  model: string | null;
  sentiment: Sentiment | null;
  stance: StanceAction | null;
}

export type SavedSummary = Omit<SavedSummaryRow, "sentiment" | "stance"> & SummaryEntry;

export type SummaryJobStatus = { status: "running"; started_at: string } | { status: "failed"; error: string };

/** Identifies the headlines a summary covers. */
export interface SummaryKeyFields {
  ticker: string;
  range_key: string;
  start: string | null;
  end: string | null;
}

/** A generated summary still in the 1-hour cache and not saved (or newer than the saved copy). */
export interface UnsavedSummaryRow extends SummaryKeyFields {
  generated_at: string;
  expires_in: number;
  model: string | null;
  sentiment: Sentiment;
  stance: StanceAction;
  replaces_saved: boolean;
}

export interface SummaryJobRow extends SummaryKeyFields {
  status: "running" | "failed";
  started_at: string | null;
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
  saveNewsSummary: (ticker: string, range?: DateRange | null) =>
    request<SavedSummary>("/api/news/summaries", {
      method: "POST",
      body: JSON.stringify({ ticker, start: range?.start ?? null, end: range?.end ?? null }),
    }),
  /** Saved, unsaved-but-cached and in-progress summaries; all tickers unless one is given. */
  summariesOverview: (ticker?: string) =>
    request<SummariesOverview>(`/api/news/summaries${ticker ? `?ticker=${encodeURIComponent(ticker)}` : ""}`),
  getSavedSummary: (id: number) => request<SavedSummary>(`/api/news/summaries/${id}`),
  deleteSavedSummary: (id: number) => request<void>(`/api/news/summaries/${id}`, { method: "DELETE" }),
  listLinks: () => request<ShareLink[]>("/api/admin/links"),
  createLink: (name: string) =>
    request<ShareLink>("/api/admin/links", { method: "POST", body: JSON.stringify({ name }) }),
  revokeLink: (id: number) => request<void>(`/api/admin/links/${id}`, { method: "DELETE" }),
};
