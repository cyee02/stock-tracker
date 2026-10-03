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
