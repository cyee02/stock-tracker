import hmac
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

bearer = HTTPBearer(auto_error=False)


@dataclass
class Viewer:
    role: str  # "admin" | "viewer"
    name: str


def require_viewer(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> Viewer:
    if creds is None or not creds.credentials:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing access token")
    token = creds.credentials
    settings = request.app.state.settings
    if hmac.compare_digest(token.encode(), settings.admin_key.encode()):
        return Viewer(role="admin", name="Owner")
    link = request.app.state.db.find_active_link(token)
    if link is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "This link is invalid or has been revoked")
    return Viewer(role="viewer", name=link["name"])


def require_admin(viewer: Viewer = Depends(require_viewer)) -> Viewer:
    if viewer.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin access required")
    return viewer
