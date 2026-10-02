"""Tailscale Serve identity headers are only trustworthy under narrow conditions.

These tests pin those conditions: the headers count when Serve delivers them
over loopback, and never otherwise.
"""

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app
from app.market import History

LOGIN = {"Tailscale-User-Login": "me@example.com", "Tailscale-User-Name": "Yee Chia"}


def fake_loader(ticker: str) -> History:
    idx = pd.bdate_range("2015-01-01", periods=400)
    return History(close=pd.Series(np.linspace(50, 150, 400), index=idx), currency="USD")


def build(**overrides):
    """A client whose TCP peer looks like the Serve proxy unless told otherwise."""
    peer = overrides.pop("peer", ("127.0.0.1", 41234))
    settings = Settings(
        admin_key=overrides.pop("admin_key", ""),
        db_path=overrides.pop("db_path"),
        cache_ttl_seconds=60,
        static_dir="/nonexistent",
        tailscale_auth=overrides.pop("tailscale_auth", True),
        tailscale_allowed_logins=overrides.pop("tailscale_allowed_logins", ()),
    )
    return TestClient(create_app(settings, loader=fake_loader), client=peer)


@pytest.fixture
def client(tmp_path):
    return build(db_path=str(tmp_path / "t.db"))


def test_tailnet_identity_grants_admin_without_any_key(client):
    r = client.get("/api/me", headers=LOGIN)
    assert r.status_code == 200
    assert r.json() == {"role": "admin", "name": "Yee Chia"}


def test_login_used_when_display_name_absent(client):
    r = client.get("/api/me", headers={"Tailscale-User-Login": "me@example.com"})
    assert r.json()["name"] == "me@example.com"


def test_no_headers_still_rejected(client):
    assert client.get("/api/me").status_code == 401


def test_identity_ignored_when_peer_is_not_loopback(tmp_path):
    """A caller reaching the socket from off-box cannot assert an identity.

    This is what stops a device on the same cafe wifi from walking in if the
    app is ever bound to 0.0.0.0 instead of loopback.
    """
    off_box = build(db_path=str(tmp_path / "t.db"), peer=("100.64.0.9", 1234))
    assert off_box.get("/api/me", headers=LOGIN).status_code == 401


def test_funnel_requests_get_no_identity(client):
    """Funnel is public internet traffic and carries no verified identity."""
    r = client.get("/api/me", headers={**LOGIN, "Tailscale-Funnel-Request": "true"})
    assert r.status_code == 401


def test_identity_ignored_when_tailscale_auth_is_off(tmp_path):
    client = build(db_path=str(tmp_path / "t.db"), tailscale_auth=False, admin_key="admin-key-for-tests-0123")
    assert client.get("/api/me", headers=LOGIN).status_code == 401


def test_allowlist_rejects_other_tailnet_users(tmp_path):
    client = build(db_path=str(tmp_path / "t.db"), tailscale_allowed_logins=("me@example.com",))
    assert client.get("/api/me", headers=LOGIN).status_code == 200
    assert client.get("/api/me", headers={"Tailscale-User-Login": "someone@else.com"}).status_code == 401


def test_login_match_is_case_insensitive(tmp_path):
    client = build(db_path=str(tmp_path / "t.db"), tailscale_allowed_logins=("me@example.com",))
    assert client.get("/api/me", headers={"Tailscale-User-Login": "ME@Example.com"}).status_code == 200


def test_empty_admin_key_does_not_accept_an_empty_token(client):
    """With no ADMIN_KEY set, a blank bearer token must not compare equal to it."""
    for token in ("", " "):
        r = client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 401


def test_share_links_still_work_alongside_tailnet_identity(client):
    created = client.post("/api/admin/links", json={"name": "Alice"}, headers=LOGIN)
    assert created.status_code == 201
    token = created.json()["token"]
    r = client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
    assert r.json() == {"role": "viewer", "name": "Alice"}


def test_settings_require_a_key_or_tailscale(monkeypatch):
    monkeypatch.delenv("ADMIN_KEY", raising=False)
    monkeypatch.delenv("TAILSCALE_AUTH", raising=False)
    with pytest.raises(RuntimeError):
        get_settings()
    monkeypatch.setenv("TAILSCALE_AUTH", "1")
    assert get_settings().admin_key == ""


def test_settings_parse_allowed_logins(monkeypatch):
    monkeypatch.setenv("TAILSCALE_AUTH", "1")
    monkeypatch.delenv("ADMIN_KEY", raising=False)
    monkeypatch.setenv("TAILSCALE_ALLOWED_LOGINS", " Me@Example.com , other@x.io ,")
    assert get_settings().tailscale_allowed_logins == ("me@example.com", "other@x.io")
