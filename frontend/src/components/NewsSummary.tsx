import { useEffect, useRef, useState } from "react";
import { api, DateRange, NewsSummaryResponse } from "../api";
import { formatRelative } from "../format";
import SummaryView from "./SummaryView";

type Loaded = Extract<NewsSummaryResponse, { source: string }>;

const POLL_MS = 3000;

interface Props {
  ticker: string;
  range: DateRange | null;
  isAdmin: boolean;
}

function secondsSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
}

/**
 * AI summary of the headlines below it. Clicking starts a Claude run on the server,
 * which keeps going if you leave the page; this polls until the result is ready.
 */
export default function NewsSummary({ ticker, range, isAdmin }: Props) {
  const [resp, setResp] = useState<NewsSummaryResponse | null>(null);
  const [peeking, setPeeking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const rangeKey = range ? `${range.start}:${range.end}` : "";
  // Which headlines are on screen, so a slow response for other headlines can't overwrite them.
  const current = useRef("");

  const show = (key: string) => (r: NewsSummaryResponse) => {
    if (key === current.current) setResp(r);
  };

  useEffect(() => {
    current.current = `${ticker}|${rangeKey}`;
    let cancelled = false;
    setPeeking(true);
    setResp(null);
    setError(null);
    api
      .peekNewsSummary(ticker, range)
      .then((r) => !cancelled && show(current.current)(r))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setPeeking(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, rangeKey]);

  const running = resp?.job?.status === "running";

  // While a run is going: poll for the result and tick the elapsed-time counter.
  useEffect(() => {
    if (!running) return;
    const key = current.current;
    const poll = setInterval(() => {
      api.peekNewsSummary(ticker, range).then(show(key)).catch((e) => setError(e.message));
    }, POLL_MS);
    const tick = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, ticker, rangeKey]);

  const generate = (refresh: boolean) => {
    setError(null);
    api
      .newsSummary(ticker, range, refresh)
      .then(show(current.current))
      .catch((e) => setError(e.message));
  };

  const save = () => {
    const key = current.current;
    setSaving(true);
    setError(null);
    api
      .saveNewsSummary(ticker, range)
      .then(() => api.peekNewsSummary(ticker, range))
      .then(show(key))
      .catch((e) => setError(e.message))
      .finally(() => setSaving(false));
  };

  const data = resp?.summary ? (resp as Loaded) : null;
  const job = resp?.job ?? null;
  const startedAt = job?.status === "running" ? job.started_at : null;

  let body;
  if (peeking) body = <p className="muted">Checking for a summary…</p>;
  else if (running && !data)
    body = (
      <div className="ai-working">
        <span className="spinner" aria-hidden />
        <div>
          <p>Claude is reading the articles… usually a minute or two ({startedAt && secondsSince(startedAt)}s)</p>
          <p className="muted">
            It keeps running if you leave this page. You'll find it under <a href="/summaries">AI Summaries</a>.
          </p>
        </div>
      </div>
    );
  else if (!data)
    body = isAdmin ? (
      <div className="ai-empty">
        <p className="muted">
          Get Claude's read on these headlines: sentiment, a buy/hold/sell view, the top happenings, risks and more.
        </p>
        <button onClick={() => generate(false)}>Summarize with Claude</button>
      </div>
    ) : (
      <p className="muted">No AI summary for these headlines yet.</p>
    );
  else {
    const unsaved = data.source === "cache" && (!data.saved || data.has_newer_unsaved);
    const footer = (
      <span className="ai-status">
        {running ? (
          <span className="ai-refreshing">
            <span className="spinner" aria-hidden /> Refreshing… ({startedAt && secondsSince(startedAt)}s)
          </span>
        ) : data.has_newer_unsaved ? (
          <span>New version, not saved</span>
        ) : data.saved ? (
          <span className="saved-tag">Saved {data.saved_at && formatRelative(data.saved_at)}</span>
        ) : (
          <span>Not saved · cached for {Math.max(1, Math.round((data.expires_in ?? 0) / 60))}m</span>
        )}
        <span>Generated {formatRelative(data.generated_at)}</span>
        {isAdmin && unsaved && (
          <button className="ai-save" onClick={save} disabled={saving}>
            {saving ? "Saving…" : data.saved ? "Save (replace saved)" : "Save"}
          </button>
        )}
        {isAdmin && !running && (
          <button className="link-button" onClick={() => generate(true)}>
            Refresh
          </button>
        )}
      </span>
    );
    body = <SummaryView entry={data} footer={footer} />;
  }

  return (
    <section className="ai-card" aria-label="AI summary">
      <h2 className="ai-title">
        <span className="ai-spark" aria-hidden>
          ✦
        </span>{" "}
        AI summary
      </h2>
      {body}
      {job?.status === "failed" && <p className="error-text">Claude couldn't summarize: {job.error}</p>}
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
