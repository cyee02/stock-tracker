import { getToken } from "./auth";

export const PERIODS = ["3m", "6m", "1y", "3y", "5y", "10y"] as const;
export type Period = (typeof PERIODS)[number];
export type Signal = "underpriced" | "fair" | "overpriced";

export interface Point {
  date: string;
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
  returns: PeriodReturn[];
  period: Period;
  window: number;
  points: Point[];
  latest: Point & { signal: Signal; trend: Trend | null };
  sma: { fast: number; slow: number; crosses: SmaCross[] };
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
  items: NewsItem[];
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
  series: (ticker: string, period: Period) =>
    request<SeriesResponse>(`/api/series?ticker=${encodeURIComponent(ticker)}&period=${period}`),
  news: (ticker: string) => request<NewsResponse>(`/api/news?ticker=${encodeURIComponent(ticker)}`),
  listLinks: () => request<ShareLink[]>("/api/admin/links"),
  createLink: (name: string) =>
    request<ShareLink>("/api/admin/links", { method: "POST", body: JSON.stringify({ name }) }),
  revokeLink: (id: number) => request<void>(`/api/admin/links/${id}`, { method: "DELETE" }),
};
