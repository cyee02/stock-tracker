/** The visible date range of the charts, shared by every strategy. */

export const TODAY = "today";

/** `start` and `end` are ISO dates; `end` may be TODAY, meaning the latest close. */
export interface View {
  start: string;
  end: string;
}

export const PRESETS = ["YTD", "1Y", "3Y", "5Y", "10Y", "All"] as const;
export type Preset = (typeof PRESETS)[number];

export function viewEnd(view: View, lastDate: string): string {
  return view.end === TODAY ? lastDate : view.end;
}

export function shiftYears(date: string, years: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

/** Last calendar day of a "YYYY-MM" month. */
export function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/**
 * Whether the loaded prices cover the whole view. False while earlier history is
 * still being fetched, when stats over the view would be computed from a partial range.
 */
export function isCovered(view: View, loadedStart: string, firstDate: string): boolean {
  return view.start >= loadedStart || loadedStart <= firstDate;
}

/** Start date of a preset range ending at the latest close, never before the ticker's first date. */
export function presetStart(preset: Preset, lastDate: string, firstDate: string): string {
  const start =
    preset === "All"
      ? firstDate
      : preset === "YTD"
        ? `${lastDate.slice(0, 4)}-01-01`
        : shiftYears(lastDate, Number(preset.slice(0, -1)));
  return start < firstDate ? firstDate : start;
}
