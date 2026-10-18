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
