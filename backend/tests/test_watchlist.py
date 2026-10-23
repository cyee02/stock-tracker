import datetime as dt

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.market import History, TickerInfo, TickerNotFound, watch_snapshot

ADMIN = "admin-key-for-tests-0123456789"
AUTH = {"Authorization": f"Bearer {ADMIN}"}


def _history(closes, info=None, with_ohlc=True) -> History:
    idx = pd.bdate_range("2024-01-01", periods=len(closes))
    close = pd.Series(closes, index=idx, dtype=float)
    ohlc = None
    if with_ohlc:
        ohlc = pd.DataFrame({"Open": close - 1, "High": close + 2, "Low": close - 2}, index=idx)
    return History(close=close, currency="USD", info=info or TickerInfo(), ohlc=ohlc)


def test_snapshot_rising_prices_are_overpriced_and_bullish():
    snap = watch_snapshot(_history(np.linspace(50, 150, 500)))
    assert snap["close"] == 150
    assert snap["open"] == 149 and snap["high"] == 152 and snap["low"] == 148
    assert snap["change_pct"] == pytest.approx(150 / snap["prev_close"] - 1)
    assert snap["signal"] == "overpriced"
    assert snap["trend"] == "bullish"
    assert snap["last_cross"] is None


def test_snapshot_reports_last_cross():
    # Up, then down hard enough for the 50-day to cross under the 200-day.
    closes = np.concatenate([np.linspace(50, 150, 300), np.linspace(150, 60, 200)])
    snap = watch_snapshot(_history(closes))
    assert snap["trend"] == "bearish"
    assert snap["last_cross"]["kind"] == "death"
    assert snap["signal"] == "underpriced"


def test_snapshot_short_history_has_no_signals():
    snap = watch_snapshot(_history(np.linspace(10, 20, 30), with_ohlc=False))
    assert snap["signal"] is None and snap["trend"] is None
    assert snap["open"] is None and snap["close"] == 20


@pytest.fixture
def client(tmp_path):
    def loader(ticker, start=None):
        if ticker == "NOPE":
            raise TickerNotFound(ticker)
        if ticker == "SPY":
            info = TickerInfo(name="SPDR S&P 500", quote_type="ETF", nav=600.5)
        else:
            info = TickerInfo(name="Apple", quote_type="EQUITY", earnings_date=dt.date(2026, 10, 30))
        return _history(np.linspace(50, 150, 500), info)

    settings = Settings(
        admin_key=ADMIN, db_path=str(tmp_path / "t.db"), cache_ttl_seconds=60, static_dir=str(tmp_path / "x")
    )
    c = TestClient(create_app(settings, loader=loader))
    _, token = c.app.state.db.create_link("Friend")
    c.viewer = {"Authorization": f"Bearer {token}"}
    return c


def test_add_list_and_remove(client):
    assert client.put("/api/watchlist/aapl", headers=AUTH).json() == {"tickers": ["AAPL"]}
    assert client.put("/api/watchlist/SPY", headers=AUTH).json() == {"tickers": ["AAPL", "SPY"]}
    # Adding again keeps one copy in its original place.
    assert client.put("/api/watchlist/AAPL", headers=AUTH).json() == {"tickers": ["AAPL", "SPY"]}

    body = client.get("/api/watchlist", headers=AUTH).json()
    aapl, spy = body["rows"]
    assert aapl["ticker"] == "AAPL" and aapl["earnings_date"] == "2026-10-30" and aapl["nav"] is None
    assert spy["quote_type"] == "ETF" and spy["nav"] == 600.5
    assert aapl["signal"] == "overpriced" and aapl["trend"] == "bullish"
    assert aapl["open"] is not None and aapl["error"] is None

    assert client.delete("/api/watchlist/AAPL", headers=AUTH).json() == {"tickers": ["SPY"]}
    assert client.get("/api/watchlist/tickers", headers=AUTH).json() == {"tickers": ["SPY"]}


def test_add_unknown_ticker_is_404_and_not_saved(client):
    assert client.put("/api/watchlist/NOPE", headers=AUTH).status_code == 404
    assert client.get("/api/watchlist/tickers", headers=AUTH).json() == {"tickers": []}


def test_add_rejects_junk(client):
    assert client.put("/api/watchlist/a%20b", headers=AUTH).status_code == 422


def test_share_link_viewers_read_but_cannot_edit(client):
    client.put("/api/watchlist/AAPL", headers=AUTH)
    assert client.get("/api/watchlist", headers=client.viewer).json()["rows"][0]["ticker"] == "AAPL"
    assert client.put("/api/watchlist/SPY", headers=client.viewer).status_code == 403
    assert client.delete("/api/watchlist/AAPL", headers=client.viewer).status_code == 403
    assert client.get("/api/watchlist").status_code == 401
