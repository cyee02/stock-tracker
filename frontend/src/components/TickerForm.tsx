import { FormEvent, ReactNode, useEffect, useState } from "react";

interface Props {
  initialTicker: string;
  loading: boolean;
  onSubmit: (ticker: string) => void;
  /** Shown after the Plot button, e.g. the Add to Watchlist button. */
  extra?: ReactNode;
}

export default function TickerForm({ initialTicker, loading, onSubmit, extra }: Props) {
  const [ticker, setTicker] = useState(initialTicker);
  // A ticker opened from elsewhere (e.g. the watchlist) replaces what's typed.
  useEffect(() => setTicker(initialTicker), [initialTicker]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = ticker.trim().toUpperCase();
    if (t) onSubmit(t);
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
      <button type="submit" disabled={loading}>
        {loading ? "Loading…" : "Plot"}
      </button>
      {extra}
    </form>
  );
}
