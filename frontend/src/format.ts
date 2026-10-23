export function formatPrice(v: number | null, currency: string | null): string {
  if (v === null) return "—";
  const digits = Math.abs(v) < 1 ? 4 : 2;
  const num = v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return currency ? `${num} ${currency}` : num;
}

export function formatPercent(v: number | null): string {
  if (v === null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(2)}%`;
}

/** Large amounts as 109.4B / -3.2M / 850K. */
export function formatCompact(v: number | null): string {
  if (v === null) return "—";
  const a = Math.abs(v);
  const [div, unit] = a >= 1e12 ? [1e12, "T"] : a >= 1e9 ? [1e9, "B"] : a >= 1e6 ? [1e6, "M"] : a >= 1e3 ? [1e3, "K"] : [1, ""];
  return `${(v / div).toFixed(div === 1 ? 2 : 1)}${unit}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "Jun '26" for a quarter ending in June 2026; "FY Sep '25" for a fiscal year.
 * Named by the period-end month rather than "Q2", because fiscal quarters
 * (Apple's Q3 ends in June) rarely match calendar ones.
 */
export function periodLabel(iso: string, annual: boolean): string {
  const [y, m] = iso.split("-").map(Number);
  const label = `${MONTHS[m - 1]} '${String(y).slice(2)}`;
  return annual ? `FY ${label}` : label;
}

const DAY_MS = 86_400_000;

function parseDay(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// Calendar dates ("2026-10-27") are shown as-is, independent of the viewer's timezone.
export function formatDay(iso: string, withYear = true): string {
  return parseDay(iso).toLocaleDateString(undefined, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

export function daysUntil(iso: string, now = new Date()): number {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((parseDay(iso).getTime() - today) / DAY_MS);
}

export function formatRelative(iso: string, now = new Date()): string {
  const mins = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
