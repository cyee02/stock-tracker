import datetime as dt

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.alerts import COOLDOWN, AlertChecker, Crossing, detect_crossings, message
from app.config import Settings
from app.main import create_app
from app.market import History, TickerInfo

ADMIN = "admin-key-for-tests-0123456789"
AUTH = {"Authorization": f"Bearer {ADMIN}"}
NOW = dt.datetime(2026, 10, 23, 15, 0, tzinfo=dt.timezone.utc)
LEVELS = {"p25": 90.0, "ma": 100.0, "p75": 110.0}


def test_first_check_only_records_sides():
    state, crossings = detect_crossings(105, LEVELS, {}, NOW)
    assert crossings == []
    assert {k: v["side"] for k, v in state.items()} == {"p25": 1, "ma": 1, "p75": -1}


def test_crossing_above_p75_alerts_once():
    state, _ = detect_crossings(105, LEVELS, {}, NOW)
    state, crossings = detect_crossings(112, LEVELS, state, NOW)
    assert crossings == [Crossing("p75", "above", 110.0)]
    assert state["p75"]["notified_at"] == NOW.isoformat(timespec="seconds")
    # Still above on the next check: nothing new.
    _, again = detect_crossings(113, LEVELS, state, NOW + dt.timedelta(minutes=5))
    assert again == []


def test_price_inside_band_keeps_previous_side():
    state, _ = detect_crossings(105, LEVELS, {}, NOW)
    # 110.1 is within 0.2% of 110, so not yet "above".
    state, crossings = detect_crossings(110.1, LEVELS, state, NOW)
    assert crossings == [] and state["p75"]["side"] == -1


def test_cooldown_silences_a_quick_cross_back():
    state, _ = detect_crossings(105, LEVELS, {}, NOW)
    state, _ = detect_crossings(112, LEVELS, state, NOW)
    state, crossings = detect_crossings(105, LEVELS, state, NOW + dt.timedelta(minutes=30))
    assert crossings == [] and state["p75"]["side"] == -1
    state, _ = detect_crossings(112, LEVELS, state, NOW + COOLDOWN + dt.timedelta(minutes=1))
    _, crossings = detect_crossings(105, LEVELS, state, NOW + COOLDOWN * 2 + dt.timedelta(minutes=2))
    assert crossings == [Crossing("p75", "below", 110.0)]


def test_gap_through_two_lines_reports_both():
    state, _ = detect_crossings(95, LEVELS, {}, NOW)
    _, crossings = detect_crossings(112, LEVELS, state, NOW)
    assert [c.line for c in crossings] == ["ma", "p75"]


def test_message_wording():
    m = message("AAPL", 112.5, "USD", [Crossing("p75", "above", 110.0)])
    assert m["title"] == "AAPL rose above the 75th percentile"
    assert m["body"] == "112.50 USD, now overpriced (75th percentile 110.00)."
    assert m["url"] == "/?ticker=AAPL&strategy=mean-reversion"


@pytest.fixture
def client(tmp_path):
    prices = {"AAPL": 150.0}
    pushed = []

    def loader(ticker, start=None):
        # Flat around 100 for a year: p25 < 100 < p75, all near 100.
        idx = pd.bdate_range("2025-01-01", periods=300)
        close = pd.Series(100 + np.sin(np.arange(300)) * 5, index=idx)
        return History(close=close, currency="USD", info=TickerInfo(name="Apple", quote_type="EQUITY"))

    def pusher(db, sub, payload):
        pushed.append((sub["endpoint"], payload))
        return True

    settings = Settings(
        admin_key=ADMIN, db_path=str(tmp_path / "t.db"), cache_ttl_seconds=60, static_dir=str(tmp_path / "x")
    )
    app = create_app(settings, loader=loader, price_loader=lambda t: prices.get(t), pusher=pusher)
    c = TestClient(app)
    c.prices, c.pushed = prices, pushed
    c.checker = AlertChecker(app, 0, price_loader=lambda t: prices.get(t), pusher=pusher)
    _, token = app.state.db.create_link("Friend")
    c.viewer = {"Authorization": f"Bearer {token}"}
    return c


SUB = {"endpoint": "https://web.push.apple.com/abc", "keys": {"p256dh": "key", "auth": "secret"}, "device": "iPhone"}


def test_subscribe_and_config(client):
    assert client.post("/api/alerts/subscriptions", json=SUB, headers={**AUTH, "Origin": "https://me.ts.net"}).status_code == 204
    cfg = client.get("/api/alerts", headers=AUTH).json()
    assert len(cfg["public_key"]) == 87
    assert cfg["devices"] == [{"endpoint": SUB["endpoint"], "device": "iPhone"}]
    assert client.app.state.db.get_kv("vapid_subject") == "https://me.ts.net"

    client.post("/api/alerts/subscriptions/remove", json={"endpoint": SUB["endpoint"]}, headers=AUTH)
    assert client.get("/api/alerts", headers=AUTH).json()["devices"] == []


def test_rejects_non_https_endpoint(client):
    bad = {**SUB, "endpoint": "http://evil.example/x"}
    assert client.post("/api/alerts/subscriptions", json=bad, headers=AUTH).status_code == 422


def test_alerts_are_owner_only(client):
    assert client.get("/api/alerts", headers=client.viewer).status_code == 403
    assert client.post("/api/alerts/subscriptions", json=SUB, headers=client.viewer).status_code == 403


def test_test_notification(client):
    assert client.post("/api/alerts/test", headers=AUTH).status_code == 422
    client.post("/api/alerts/subscriptions", json=SUB, headers=AUTH)
    assert client.post("/api/alerts/test", headers=AUTH).json() == {"sent": 1, "devices": 1}
    assert client.pushed[0][1]["title"] == "Price alerts are on"


def test_checker_alerts_on_cross_and_logs_event(client):
    client.put("/api/watchlist/AAPL", headers=AUTH)
    client.post("/api/alerts/subscriptions", json=SUB, headers=AUTH)

    assert client.checker.run_once(NOW) == 0  # 150 is above every line: baseline only
    client.prices["AAPL"] = 50.0  # straight through all three
    assert client.checker.run_once(NOW + dt.timedelta(minutes=5)) == 1
    (endpoint, payload), = client.pushed
    assert endpoint == SUB["endpoint"]
    assert payload["title"] == "AAPL fell below the 75th percentile, moving average and 25th percentile"
    assert payload["body"].startswith("50.00 USD, now underpriced")

    events = client.get("/api/alerts", headers=AUTH).json()["events"]
    assert {e["line"] for e in events} == {"p25", "ma", "p75"}
    assert all(e["direction"] == "below" and e["price"] == 50.0 for e in events)


def test_removing_from_watchlist_forgets_state(client):
    client.put("/api/watchlist/AAPL", headers=AUTH)
    client.checker.run_once(NOW)
    assert client.app.state.db.alert_state("AAPL")
    client.delete("/api/watchlist/AAPL", headers=AUTH)
    assert client.app.state.db.alert_state("AAPL") == {}
