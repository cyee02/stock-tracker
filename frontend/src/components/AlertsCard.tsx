import { useCallback, useEffect, useState } from "react";
import { AlertsConfig, api } from "../api";
import { formatRelative } from "../format";
import { currentSubscription, disableAlerts, enableAlerts, pushSupport } from "../push";

/** Turn price-alert notifications on or off for this device, and show recent alerts. Owner only. */
export default function AlertsCard() {
  const [config, setConfig] = useState<AlertsConfig | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const support = pushSupport();

  const refresh = useCallback(async () => {
    try {
      const [cfg, sub] = await Promise.all([api.alerts(), currentSubscription()]);
      setConfig(cfg);
      setEndpoint(sub?.endpoint ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = (action: () => Promise<string | null>) => async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      setNote(await action());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const onHere = !!endpoint && !!config?.devices.some((d) => d.endpoint === endpoint);
  const minutes = config ? Math.round(config.interval_seconds / 60) : null;

  return (
    <div className="card alerts-card">
      <div className="alerts-head">
        <div>
          <h2>🔔 Price alerts</h2>
          <p className="muted fin-sub">
            A notification when a watched ticker's price crosses its 25th percentile, 1-year moving average or 75th
            percentile
            {minutes ? `, checked every ${minutes} minute${minutes === 1 ? "" : "s"}` : ""}.
          </p>
        </div>
        {support === "supported" && config && (
          <span className="alerts-actions">
            {onHere ? (
              <>
                <button className="pill" disabled={busy} onClick={run(async () => (await api.testAlert(), "Test notification sent."))}>
                  Send test
                </button>
                <button
                  className="pill"
                  disabled={busy}
                  onClick={run(async () => (await disableAlerts(), "Alerts are off for this device."))}
                >
                  Turn off here
                </button>
              </>
            ) : (
              <button
                disabled={busy}
                onClick={run(async () => (await enableAlerts(config.public_key), "Alerts are on for this device."))}
              >
                {busy ? "Turning on…" : "Turn on for this device"}
              </button>
            )}
          </span>
        )}
      </div>

      {support === "ios-needs-home-screen" && (
        <p className="alerts-hint">
          On iPhone, notifications only work in the app: open <strong>Stocks</strong> from your Home Screen and turn
          them on there.
        </p>
      )}
      {support === "unsupported" && <p className="alerts-hint">This browser can't receive push notifications.</p>}
      {config?.interval_seconds === 0 && (
        <p className="alerts-hint">The alert checker is off on the server (ALERT_INTERVAL_SECONDS=0).</p>
      )}
      {error && <p className="error-text">{error}</p>}
      {note && <p className="alerts-note">{note}</p>}

      {config && config.devices.length > 0 && (
        <p className="muted alerts-devices">
          On for:{" "}
          {config.devices.map((d, i) => (
            <span key={d.endpoint}>
              {i > 0 && ", "}
              {d.device ?? "Unknown device"}
              {d.endpoint === endpoint && " (this one)"}
            </span>
          ))}
        </p>
      )}

      {config && config.events.length > 0 && (
        <details className="alerts-events">
          <summary>Recent alerts ({config.events.length})</summary>
          <ul>
            {config.events.map((e) => (
              <li key={e.id}>
                <a href={`/?ticker=${encodeURIComponent(e.ticker)}&strategy=mean-reversion`}>
                  <strong>{e.ticker}</strong>
                </a>{" "}
                <span className={e.direction === "above" ? "c-up" : "c-down"}>
                  {e.direction === "above" ? "▲ rose above" : "▼ fell below"}
                </span>{" "}
                the {e.line_label} ({e.level.toFixed(2)}) at {e.price.toFixed(2)}
                {e.currency ? ` ${e.currency}` : ""} <span className="muted">· {formatRelative(e.created_at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
