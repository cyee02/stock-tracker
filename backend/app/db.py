import hashlib
import json
import secrets
import sqlite3
from datetime import datetime, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS share_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT
);

-- AI news summaries the owner chose to keep. range_key is "<start>:<end>" for a
-- dated range, or "latest:<day generated>" for the Latest feed, whose headlines
-- change daily. One row per ticker and range: saving again replaces it.
CREATE TABLE IF NOT EXISTS saved_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    range_key TEXT NOT NULL,
    start TEXT,
    "end" TEXT,
    generated_at TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    model TEXT,
    payload TEXT NOT NULL,
    UNIQUE (ticker, range_key)
);

-- The owner's watchlist, shown to everyone with access. Listed in the order added.
CREATE TABLE IF NOT EXISTS watchlist (
    ticker TEXT PRIMARY KEY,
    added_at TEXT NOT NULL
);

-- Small settings the app generates for itself, e.g. its Web Push (VAPID) key.
CREATE TABLE IF NOT EXISTS app_kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Browsers and home-screen apps that asked for price alerts.
CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    device TEXT,
    created_at TEXT NOT NULL
);

-- Which side of each mean-reversion line a ticker was last seen on.
CREATE TABLE IF NOT EXISTS alert_state (
    ticker TEXT NOT NULL,
    line TEXT NOT NULL,
    side INTEGER NOT NULL,
    notified_at TEXT,
    PRIMARY KEY (ticker, line)
);

CREATE TABLE IF NOT EXISTS alert_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    line TEXT NOT NULL,
    direction TEXT NOT NULL,
    price REAL NOT NULL,
    level REAL NOT NULL,
    currency TEXT,
    created_at TEXT NOT NULL
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class Database:
    def __init__(self, path: str):
        self.path = path
        with self._connect() as conn:
            conn.executescript(SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def create_link(self, name: str) -> tuple[dict, str]:
        token = secrets.token_urlsafe(32)
        with self._connect() as conn:
            cur = conn.execute(
                "INSERT INTO share_links (name, token_hash, created_at) VALUES (?, ?, ?)",
                (name, hash_token(token), _now()),
            )
            row = conn.execute("SELECT * FROM share_links WHERE id = ?", (cur.lastrowid,)).fetchone()
        return _row_to_dict(row), token

    def list_links(self) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM share_links ORDER BY id DESC").fetchall()
        return [_row_to_dict(r) for r in rows]

    def revoke_link(self, link_id: int) -> bool:
        with self._connect() as conn:
            cur = conn.execute(
                "UPDATE share_links SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
                (_now(), link_id),
            )
            return cur.rowcount > 0

    def find_active_link(self, token: str) -> dict | None:
        """Return the active link for a raw token and record its use."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM share_links WHERE token_hash = ? AND revoked_at IS NULL",
                (hash_token(token),),
            ).fetchone()
            if row is None:
                return None
            conn.execute("UPDATE share_links SET last_used_at = ? WHERE id = ?", (_now(), row["id"]))
        return _row_to_dict(row)

    def save_summary(self, ticker: str, range_key: str, start: str | None, end: str | None, entry: dict) -> dict:
        """Keep a generated summary; `entry` is a cache entry ({generated_at, model, ...payload})."""
        payload = {k: v for k, v in entry.items() if k not in ("generated_at", "model", "expires_in")}
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO saved_summaries (ticker, range_key, start, "end", generated_at, saved_at, model, payload)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (ticker, range_key) DO UPDATE SET
                    start = excluded.start, "end" = excluded."end", generated_at = excluded.generated_at,
                    saved_at = excluded.saved_at, model = excluded.model, payload = excluded.payload
                """,
                (ticker, range_key, start, end, entry["generated_at"], _now(), entry.get("model"), json.dumps(payload)),
            )
            row = conn.execute(
                "SELECT * FROM saved_summaries WHERE ticker = ? AND range_key = ?", (ticker, range_key)
            ).fetchone()
        return _summary_row(row)

    def get_summary(self, ticker: str, range_key: str) -> dict | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM saved_summaries WHERE ticker = ? AND range_key = ?", (ticker, range_key)
            ).fetchone()
        return _summary_row(row) if row else None

    def get_summary_by_id(self, summary_id: int) -> dict | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM saved_summaries WHERE id = ?", (summary_id,)).fetchone()
        return _summary_row(row) if row else None

    def list_summaries(self, ticker: str | None = None) -> list[dict]:
        """Saved summaries (one ticker's, or all), newest news first, without the full payload."""
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM saved_summaries WHERE ? IS NULL OR ticker = ?
                ORDER BY COALESCE("end", substr(range_key, 8)) DESC, saved_at DESC
                """,
                (ticker, ticker),
            ).fetchall()
        out = []
        for r in rows:
            full = _summary_row(r)
            summary = full.pop("summary") or {}
            for k in ("analyst", "price", "earnings", "articles_total"):
                full.pop(k, None)
            full["sentiment"] = (summary.get("sentiment") or {}).get("label")
            full["stance"] = (summary.get("stance") or {}).get("action")
            out.append(full)
        return out

    def delete_summary(self, summary_id: int) -> bool:
        with self._connect() as conn:
            return conn.execute("DELETE FROM saved_summaries WHERE id = ?", (summary_id,)).rowcount > 0

    def list_watchlist(self) -> list[str]:
        with self._connect() as conn:
            rows = conn.execute("SELECT ticker FROM watchlist ORDER BY added_at, rowid").fetchall()
        return [r["ticker"] for r in rows]

    def add_to_watchlist(self, ticker: str) -> bool:
        """False when it was already there."""
        with self._connect() as conn:
            cur = conn.execute(
                "INSERT INTO watchlist (ticker, added_at) VALUES (?, ?) ON CONFLICT (ticker) DO NOTHING",
                (ticker, _now()),
            )
            return cur.rowcount > 0

    def remove_from_watchlist(self, ticker: str) -> bool:
        with self._connect() as conn:
            # Forget its alert state too, so re-adding it later starts fresh instead of
            # alerting on a cross that happened while it wasn't watched.
            conn.execute("DELETE FROM alert_state WHERE ticker = ?", (ticker,))
            return conn.execute("DELETE FROM watchlist WHERE ticker = ?", (ticker,)).rowcount > 0

    def get_kv(self, key: str) -> str | None:
        with self._connect() as conn:
            row = conn.execute("SELECT value FROM app_kv WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else None

    def set_kv(self, key: str, value: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO app_kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                (key, value),
            )

    def save_subscription(self, endpoint: str, p256dh: str, auth: str, device: str | None) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO push_subscriptions (endpoint, p256dh, auth, device, created_at) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth,
                    device = excluded.device
                """,
                (endpoint, p256dh, auth, device, _now()),
            )

    def list_subscriptions(self) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM push_subscriptions ORDER BY created_at").fetchall()
        return [dict(r) for r in rows]

    def delete_subscription(self, endpoint: str) -> bool:
        with self._connect() as conn:
            return conn.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,)).rowcount > 0

    def alert_state(self, ticker: str) -> dict[str, dict]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM alert_state WHERE ticker = ?", (ticker,)).fetchall()
        return {r["line"]: {"side": r["side"], "notified_at": r["notified_at"]} for r in rows}

    def set_alert_state(self, ticker: str, state: dict[str, dict]) -> None:
        with self._connect() as conn:
            conn.executemany(
                """
                INSERT INTO alert_state (ticker, line, side, notified_at) VALUES (?, ?, ?, ?)
                ON CONFLICT (ticker, line) DO UPDATE SET side = excluded.side, notified_at = excluded.notified_at
                """,
                [(ticker, line, s["side"], s["notified_at"]) for line, s in state.items()],
            )

    def add_alert_event(self, ticker: str, line: str, direction: str, price: float, level: float, currency: str | None) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO alert_events (ticker, line, direction, price, level, currency, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (ticker, line, direction, price, level, currency, _now()),
            )

    def list_alert_events(self, limit: int = 20) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM alert_events ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]


def _summary_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "ticker": row["ticker"],
        "range_key": row["range_key"],
        "start": row["start"],
        "end": row["end"],
        "generated_at": row["generated_at"],
        "saved_at": row["saved_at"],
        "model": row["model"],
        **json.loads(row["payload"]),
    }


def _row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "created_at": row["created_at"],
        "last_used_at": row["last_used_at"],
        "revoked": row["revoked_at"] is not None,
    }
