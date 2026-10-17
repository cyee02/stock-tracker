import { DateRange, NewsItem } from "./api";

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Calendar days whose news a trading day's candle reflects: everything since the
 * previous session, so Monday's candle carries the weekend's stories.
 * `tradingDates` must be sorted ascending.
 */
export function newsWindow(tradingDates: string[], date: string): DateRange {
  const i = tradingDates.indexOf(date);
  const prev = i > 0 ? tradingDates[i - 1] : null;
  return { start: prev ? addDays(prev, 1) : date, end: date };
}

/**
 * Headlines grouped under the trading day they belong to (the first session on or
 * after publication). Stories outside the loaded sessions are left out.
 */
export function byTradingDay(items: NewsItem[], tradingDates: string[]): Map<string, NewsItem[]> {
  const out = new Map<string, NewsItem[]>();
  for (const n of items) {
    if (!n.published_at) continue;
    const day = n.published_at.slice(0, 10);
    // Binary search for the first trading date >= day.
    let lo = 0;
    let hi = tradingDates.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tradingDates[mid] < day) lo = mid + 1;
      else hi = mid;
    }
    // Before the first loaded session there's no telling which day it belongs to.
    if (lo === tradingDates.length || day < tradingDates[0]) continue;
    const key = tradingDates[lo];
    const list = out.get(key);
    if (list) list.push(n);
    else out.set(key, [n]);
  }
  return out;
}

/** Widen a range to whole months so small pans and zooms reuse the same lookup. */
export function monthAligned(start: string, end: string, cap: string): DateRange {
  const [y, m] = end.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start: `${start.slice(0, 7)}-01`, end: last > cap ? cap : last };
}

/**
 * Split a month-aligned range into at most `max` lookups of whole months. Each lookup
 * returns at most 100 stories by relevance, so one big lookup would leave most of a
 * long range empty. Chunks start on multiples of their length in months, so panning
 * reuses the same lookups.
 */
export function monthChunks(range: DateRange, max: number): DateRange[] {
  const index = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
  const ym = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
  const first = index(range.start);
  const last = index(range.end);
  const size = Math.max(1, Math.ceil((last - first + 1) / max));
  const out: DateRange[] = [];
  for (let i = first - (first % size); i <= last; i += size) {
    const r = monthAligned(ym(i), ym(i + size - 1), range.end);
    out.push({ start: r.start < range.start ? range.start : r.start, end: r.end });
  }
  return out;
}
