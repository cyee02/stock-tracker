import { useEffect, useState } from "react";
import { api } from "../api";

/** Add the charted ticker to the watchlist, or take it off. Owner only. */
export default function WatchButton({ ticker }: { ticker: string }) {
  // null until we know whether it's watched.
  const [watched, setWatched] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set right after adding, to point at where it went.
  const [justAdded, setJustAdded] = useState(false);

  useEffect(() => {
    setWatched(null);
    setError(null);
    setJustAdded(false);
    let live = true;
    api
      .watchlistTickers()
      .then((r) => live && setWatched(r.tickers.includes(ticker)))
      .catch(() => live && setWatched(false));
    return () => {
      live = false;
    };
  }, [ticker]);

  const toggle = () => {
    setBusy(true);
    setError(null);
    (watched ? api.unwatch(ticker) : api.watch(ticker))
      .then((r) => {
        const now = r.tickers.includes(ticker);
        setJustAdded(now);
        setWatched(now);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <span className="watch-control">
      <button
        type="button"
        className={`watch-btn${watched ? " on" : ""}`}
        onClick={toggle}
        disabled={busy || watched === null}
        title={watched ? `Remove ${ticker} from the watchlist` : `Save ${ticker} to the watchlist`}
        aria-pressed={!!watched}
      >
        {busy ? "Saving…" : watched ? "★ In Watchlist" : "☆ Add to Watchlist"}
      </button>
      {justAdded && (
        <a href="/watchlist" className="watch-view">
          View watchlist →
        </a>
      )}
      {error && <span className="error-text watch-error">{error}</span>}
    </span>
  );
}
