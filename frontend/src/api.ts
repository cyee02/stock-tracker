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
}

export interface SeriesResponse {
  ticker: string;
  currency: string | null;
  period: Period;
  window: number;
  points: Point[];
  latest: Point & { signal: Signal };
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
  listLinks: () => request<ShareLink[]>("/api/admin/links"),
  createLink: (name: string) =>
    request<ShareLink>("/api/admin/links", { method: "POST", body: JSON.stringify({ name }) }),
  revokeLink: (id: number) => request<void>(`/api/admin/links/${id}`, { method: "DELETE" }),
};
