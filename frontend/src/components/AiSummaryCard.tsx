import { ReactNode, useEffect, useRef, useState } from "react";
import { SummaryJobStatus } from "../api";
import { formatRelative } from "../format";

const POLL_MS = 3000;

/** What the summary endpoints return, for news and financials alike. */
export interface SummaryResponseLike {
  summary: unknown | null;
  source?: "cache" | "saved";
  saved: boolean;
  saved_at: string | null;
  has_newer_unsaved: boolean;
  generated_at?: string;
  expires_in?: number | null;
  job: SummaryJobStatus | null;
}

type Loaded<R> = Extract<R, { source: "cache" | "saved" }> & { source: "cache" | "saved"; generated_at: string };

interface Props<R extends SummaryResponseLike> {
  title: string;
  /** Changes when the card should show a different summary (another ticker or range). */
  resetKey: string;
  isAdmin: boolean;
  /** The saved or cached summary and run status; never starts a run. */
  peek: () => Promise<R>;
  generate: (refresh: boolean) => Promise<R>;
  save: () => Promise<unknown>;
  intro: ReactNode;
  buttonLabel: string;
  workingText: string;
  noneText: string;
  render: (entry: Loaded<R>, footer: ReactNode) => ReactNode;
}

function secondsSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
}

/**
 * A Claude summary card. Clicking starts a run on the server, which keeps going
 * if you leave the page; this polls until the result is ready, then offers Save.
 */
export default function AiSummaryCard<R extends SummaryResponseLike>(props: Props<R>) {
  const { resetKey, isAdmin, peek } = props;
  const [resp, setResp] = useState<R | null>(null);
  const [peeking, setPeeking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  // Which summary is on screen, so a slow response for another one can't overwrite it.
  const current = useRef("");

  const show = (key: string) => (r: R) => {
    if (key === current.current) setResp(r);
  };

  useEffect(() => {
    current.current = resetKey;
    let cancelled = false;
    setPeeking(true);
    setResp(null);
    setError(null);
    peek()
      .then((r) => !cancelled && show(resetKey)(r))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setPeeking(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const running = resp?.job?.status === "running";

  // While a run is going: poll for the result and tick the elapsed-time counter.
  useEffect(() => {
    if (!running) return;
    const key = current.current;
    const poll = setInterval(() => {
      peek().then(show(key)).catch((e) => setError(e.message));
    }, POLL_MS);
    const tick = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, resetKey]);

  const generate = (refresh: boolean) => {
    setError(null);
    props.generate(refresh).then(show(current.current)).catch((e) => setError(e.message));
  };

  const save = () => {
    const key = current.current;
    setSaving(true);
    setError(null);
    props
      .save()
      .then(() => peek())
      .then(show(key))
      .catch((e) => setError(e.message))
      .finally(() => setSaving(false));
  };

  const data = resp?.summary ? (resp as Loaded<R>) : null;
  const job = resp?.job ?? null;
  const startedAt = job?.status === "running" ? job.started_at : null;

  let body;
  if (peeking) body = <p className="muted">Checking for a summary…</p>;
  else if (running && !data)
    body = (
      <div className="ai-working">
        <span className="spinner" aria-hidden />
        <div>
          <p>
            {props.workingText} ({startedAt && secondsSince(startedAt)}s)
          </p>
          <p className="muted">
            It keeps running if you leave this page. You'll find it under <a href="/summaries">AI Summaries</a>.
          </p>
        </div>
      </div>
    );
  else if (!data)
    body = isAdmin ? (
      <div className="ai-empty">
        <p className="muted">{props.intro}</p>
        <button onClick={() => generate(false)}>{props.buttonLabel}</button>
      </div>
    ) : (
      <p className="muted">{props.noneText}</p>
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
    body = props.render(data, footer);
  }

  return (
    <section className="ai-card" aria-label={props.title}>
      <h2 className="ai-title">
        <span className="ai-spark" aria-hidden>
          ✦
        </span>{" "}
        {props.title}
      </h2>
      {body}
      {job?.status === "failed" && <p className="error-text">Claude couldn't summarize: {job.error}</p>}
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
