import hmac
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

bearer = HTTPBearer(auto_error=False)

# Addresses that mean "the connection came from this machine". `tailscale serve`
# terminates TLS and proxies to us over loopback, so a loopback peer is the
# signal that Tailscale — not a remote caller — set the identity headers.
LOOPBACK = frozenset({"127.0.0.1", "::1", "::ffff:127.0.0.1"})


@dataclass
class Viewer:
    role: str  # "admin" | "viewer"
    name: str


def _tailnet_viewer(request: Request) -> Viewer | None:
    """Identify the caller from Tailscale Serve's identity headers, or None.

    These headers are ordinary HTTP headers: anything that can open a socket to
    us can invent them. They are only trustworthy because of two conditions we
    check here and one the operator must hold up:

    1. TAILSCALE_AUTH is on, so this is a deployment that sits behind Serve.
    2. The TCP peer is loopback. Remote tailnet traffic arrives via the Serve
       proxy on loopback; anything reaching this socket from elsewhere is not
       Tailscale and gets no identity.
    3. The operator binds uvicorn to 127.0.0.1 and does NOT pass
       --proxy-headers/--forwarded-allow-ips. With those flags, `request.client`
       is taken from X-Forwarded-For, which a caller controls, and condition 2
       collapses. scripts/tailscale.sh binds correctly.
    """
    settings = request.app.state.settings
    if not settings.tailscale_auth:
        return None

    # Funnel republishes a Serve endpoint to the public internet. Tailscale does
    # not attach identity to those requests, so refuse them outright rather than
    # fall through to a header an anonymous caller might have supplied.
    if "tailscale-funnel-request" in request.headers:
        return None

    client = request.client
    if client is None or client.host not in LOOPBACK:
        return None

    login = request.headers.get("tailscale-user-login", "").strip().lower()
    if not login:
        return None
    allowed = settings.tailscale_allowed_logins
    if allowed and login not in allowed:
        return None

    return Viewer(role="admin", name=request.headers.get("tailscale-user-name", "").strip() or login)


def require_viewer(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> Viewer:
    viewer = _tailnet_viewer(request)
    if viewer is not None:
        return viewer

    if creds is None or not creds.credentials:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing access token")
    token = creds.credentials
    settings = request.app.state.settings
    # Guard the empty key: under TAILSCALE_AUTH there may be no ADMIN_KEY at
    # all, and comparing "" against "" would hand admin to any empty token.
    if settings.admin_key and hmac.compare_digest(token.encode(), settings.admin_key.encode()):
        return Viewer(role="admin", name="Owner")
    link = request.app.state.db.find_active_link(token)
    if link is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "This link is invalid or has been revoked")
    return Viewer(role="viewer", name=link["name"])


def require_admin(viewer: Viewer = Depends(require_viewer)) -> Viewer:
    if viewer.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin access required")
    return viewer
