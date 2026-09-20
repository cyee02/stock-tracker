import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.market import History, TickerNotFound

ADMIN = "admin-key-for-tests-0123456789"


def fake_loader(ticker: str) -> History:
    if ticker != "FAKE":
        raise TickerNotFound(ticker)
    idx = pd.bdate_range("2015-01-01", periods=400)
    return History(close=pd.Series(np.linspace(50, 150, 400), index=idx), currency="USD")


@pytest.fixture
def client(tmp_path):
    settings = Settings(
        admin_key=ADMIN,
        db_path=str(tmp_path / "test.db"),
        cache_ttl_seconds=60,
        static_dir=str(tmp_path / "nostatic"),
    )
    return TestClient(create_app(settings, loader=fake_loader))


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_health_is_public(client):
    assert client.get("/healthz").status_code == 200


def test_no_token_rejected(client):
    assert client.get("/api/series?ticker=FAKE").status_code == 401
    assert client.get("/api/me").status_code == 401


def test_admin_key_works(client):
    r = client.get("/api/me", headers=auth(ADMIN))
    assert r.json() == {"role": "admin", "name": "Owner"}
    r = client.get("/api/series?ticker=fake&period=1y", headers=auth(ADMIN))
    assert r.status_code == 200
    body = r.json()
    assert body["ticker"] == "FAKE" and body["window"] == 252
    assert len(body["points"]) == 400
    assert body["points"][0]["ma"] is None
    assert body["latest"]["signal"] == "overpriced"  # steadily rising series


def test_share_link_lifecycle(client):
    r = client.post("/api/admin/links", json={"name": "Alice"}, headers=auth(ADMIN))
    assert r.status_code == 201
    link = r.json()
    assert len(link["token"]) >= 40

    assert client.get("/api/me", headers=auth(link["token"])).json() == {"role": "viewer", "name": "Alice"}
    assert client.get("/api/series?ticker=FAKE", headers=auth(link["token"])).status_code == 200
    assert client.get("/api/admin/links", headers=auth(link["token"])).status_code == 403

    listed = client.get("/api/admin/links", headers=auth(ADMIN)).json()
    assert listed[0]["last_used_at"] is not None and "token" not in listed[0]

    assert client.delete(f"/api/admin/links/{link['id']}", headers=auth(ADMIN)).status_code == 204
    assert client.get("/api/me", headers=auth(link["token"])).status_code == 401


def test_bad_inputs(client):
    assert client.get("/api/series?ticker=NOPE", headers=auth(ADMIN)).status_code == 404
    assert client.get("/api/series?ticker=FAKE&period=2y", headers=auth(ADMIN)).status_code == 422
    r = client.get("/api/series?ticker=FAKE&period=3y", headers=auth(ADMIN))
    assert r.status_code == 422 and "needs 756" in r.json()["detail"]
