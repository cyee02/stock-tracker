import { FormEvent, useState } from "react";
import { Period, PERIODS } from "../api";

const PERIOD_LABELS: Record<Period, string> = {
  "3m": "3 months",
  "6m": "6 months",
  "1y": "1 year",
  "3y": "3 years",
  "5y": "5 years",
  "10y": "10 years",
};

interface Props {
  initialTicker: string;
  initialPeriod: Period;
  loading: boolean;
  onSubmit: (ticker: string, period: Period) => void;
}

export default function TickerForm({ initialTicker, initialPeriod, loading, onSubmit }: Props) {
  const [ticker, setTicker] = useState(initialTicker);
  const [period, setPeriod] = useState<Period>(initialPeriod);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = ticker.trim().toUpperCase();
    if (t) onSubmit(t, period);
  };

  return (
    <form className="ticker-form card" onSubmit={submit}>
      <label>
        <span>Ticker</span>
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="e.g. AAPL, SPY, D05.SI"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          required
        />
      </label>
      <label>
        <span>Moving average period</span>
        <select
          value={period}
          onChange={(e) => {
            const p = e.target.value as Period;
            setPeriod(p);
            if (ticker.trim()) onSubmit(ticker.trim().toUpperCase(), p);
          }}
        >
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {PERIOD_LABELS[p]}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={loading}>
        {loading ? "Loading…" : "Plot"}
      </button>
    </form>
  );
}
