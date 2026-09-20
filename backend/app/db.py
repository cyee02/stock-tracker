import hashlib
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
)
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class Database:
    def __init__(self, path: str):
        self.path = path
        with self._connect() as conn:
            conn.execute(SCHEMA)

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


def _row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "created_at": row["created_at"],
        "last_used_at": row["last_used_at"],
        "revoked": row["revoked_at"] is not None,
    }
