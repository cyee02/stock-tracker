import glob
import os
import shutil
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
    # News summaries run the Claude Code CLI headless, so they use whatever
    # Claude login that CLI has (a Pro/Max subscription) rather than an API key.
    claude_cli: str | None = None
    # CLI model alias or full name; None uses the CLI's default.
    claude_model: str | None = None
    claude_timeout_seconds: int = 240
    summary_ttl_seconds: int = 3600
    # How often the price-alert checker runs; 0 turns it off (as in tests).
    alert_interval_seconds: int = 0


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def _csv(name: str) -> tuple[str, ...]:
    raw = os.environ.get(name, "")
    return tuple(sorted({v.strip().lower() for v in raw.split(",") if v.strip()}))


def _find_claude() -> str | None:
    """CLAUDE_CLI, else `claude` on PATH, else the newest copy bundled with the VS Code extension."""
    explicit = os.environ.get("CLAUDE_CLI", "").strip()
    if explicit:
        return os.path.expanduser(explicit)
    on_path = shutil.which("claude")
    if on_path:
        return on_path
    bundled = glob.glob(
        os.path.expanduser("~/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude")
    )
    return max(bundled, key=os.path.getmtime) if bundled else None


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
        claude_cli=_find_claude(),
        claude_model=os.environ.get("CLAUDE_MODEL", "").strip() or None,
        claude_timeout_seconds=int(os.environ.get("CLAUDE_TIMEOUT_SECONDS", "240")),
        summary_ttl_seconds=int(os.environ.get("SUMMARY_TTL_SECONDS", "3600")),
        alert_interval_seconds=int(os.environ.get("ALERT_INTERVAL_SECONDS", "300")),
    )
