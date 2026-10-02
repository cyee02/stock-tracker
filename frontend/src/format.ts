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
