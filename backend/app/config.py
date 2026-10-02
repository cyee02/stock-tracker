import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    admin_key: str
    db_path: str
    cache_ttl_seconds: int
    static_dir: str
    # Trust Tailscale Serve identity headers (see app.auth). Only safe when the
    # app listens on loopback and `tailscale serve` is the only way in.
    tailscale_auth: bool = False
    # Tailnet logins allowed in, lowercased. Empty means "any user on the
    # tailnet", which is right for a single-user tailnet and wrong as soon as
    # you share the tailnet with anyone else.
    tailscale_allowed_logins: tuple[str, ...] = ()


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def _csv(name: str) -> tuple[str, ...]:
    raw = os.environ.get(name, "")
    return tuple(sorted({v.strip().lower() for v in raw.split(",") if v.strip()}))


def get_settings() -> Settings:
    tailscale_auth = _flag("TAILSCALE_AUTH")
    admin_key = os.environ.get("ADMIN_KEY", "")
    if admin_key and len(admin_key) < 16:
        raise RuntimeError("ADMIN_KEY must be at least 16 characters")
    if not admin_key and not tailscale_auth:
        raise RuntimeError("Set ADMIN_KEY (16+ characters), or TAILSCALE_AUTH=1 to let the tailnet authenticate")
    return Settings(
        admin_key=admin_key,
        db_path=os.environ.get("DB_PATH", "app.db"),
        cache_ttl_seconds=int(os.environ.get("CACHE_TTL_SECONDS", "3600")),
        static_dir=os.environ.get(
            "STATIC_DIR",
            os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist"),
        ),
        tailscale_auth=tailscale_auth,
        tailscale_allowed_logins=_csv("TAILSCALE_ALLOWED_LOGINS"),
    )
