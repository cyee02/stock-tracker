import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    admin_key: str
    db_path: str
    cache_ttl_seconds: int
    static_dir: str


def get_settings() -> Settings:
    admin_key = os.environ.get("ADMIN_KEY", "")
    if len(admin_key) < 16:
        raise RuntimeError("ADMIN_KEY env var must be set (at least 16 characters)")
    return Settings(
        admin_key=admin_key,
        db_path=os.environ.get("DB_PATH", "app.db"),
        cache_ttl_seconds=int(os.environ.get("CACHE_TTL_SECONDS", "3600")),
        static_dir=os.environ.get(
            "STATIC_DIR",
            os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist"),
        ),
    )
