import datetime as dt

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.market import History, NewsItem, TickerInfo, TTLCache, download_news, next_earnings, parse_news_item

ADMIN = "admin-key-for-tests-0123456789"
AUTH = {"Authorization": f"Bearer {ADMIN}"}


def test_next_earnings_skips_past_dates():
    today = dt.date(2026, 10, 2)
    dates = [dt.date(2026, 7, 30), dt.date(2026, 10, 29)]
    assert next_earnings(dates, today) == (dt.date(2026, 10, 29), None)


def test_next_earnings_estimated_window():
    today = dt.date(2026, 10, 2)
    dates = [dt.date(2026, 10, 30), dt.date(2026, 10, 27)]
    assert next_earnings(dates, today) == (dt.date(2026, 10, 27), dt.date(2026, 10, 30))


@pytest.mark.parametrize("dates", [None, [], [dt.date(2020, 1, 1)]])
def test_next_earnings_none(dates):
    assert next_earnings(dates, dt.date(2026, 10, 2)) == (None, None)


NEW_FORMAT = {
    "id": "abc",
    "content": {
        "title": "Apple beats estimates",
        "summary": "Revenue rose.",
        "pubDate": "2026-10-01T13:45:00Z",
        "provider": {"displayName": "Reuters"},
        "canonicalUrl": {"url": "https://finance.yahoo.com/news/apple"},
        "clickThroughUrl": {"url": "https://example.com/apple"},
        "thumbnail": {
            "originalUrl": "https://img/orig.jpg",
            "resolutions": [
                {"url": "https://img/big.jpg", "width": 800},
                {"url": "https://img/small.jpg", "width": 140},
                {"url": "https://img/tiny.jpg", "width": 50},
            ],
        },
    },
}

OLD_FORMAT = {
    "title": "Old style headline",
    "publisher": "Bloomberg",
    "link": "https://example.com/old",
    "providerPublishTime": 1_790_000_000,
}


def test_parse_new_format():
    n = parse_news_item(NEW_FORMAT)
    assert n.title == "Apple beats estimates"
    assert n.url == "https://example.com/apple"
    assert n.publisher == "Reuters"
    assert n.published_at == dt.datetime(2026, 10, 1, 13, 45, tzinfo=dt.timezone.utc)
    assert n.summary == "Revenue rose."
    assert n.thumbnail == "https://img/small.jpg"


def test_parse_old_format():
    n = parse_news_item(OLD_FORMAT)
    assert n.title == "Old style headline"
    assert n.url == "https://example.com/old"
    assert n.publisher == "Bloomberg"
    assert n.published_at == dt.datetime.fromtimestamp(1_790_000_000, dt.timezone.utc)


def test_parse_drops_untitled_and_unsafe_links():
    assert parse_news_item({"content": {"summary": "no title"}}) is None
    n = parse_news_item({"title": "x", "link": "javascript:alert(1)"})
    assert n.url is None


def test_download_news_sorts_newest_first(monkeypatch):
    class FakeTicker:
        def __init__(self, ticker):
            pass

        def get_news(self, count):
            return [OLD_FORMAT, {"id": "no-title"}, NEW_FORMAT]

    monkeypatch.setattr("app.market.yf.Ticker", FakeTicker)
    titles = [n.title for n in download_news("AAPL")]
    assert titles == ["Apple beats estimates", "Old style headline"]


def test_download_news_falls_back_to_search_when_stream_is_empty(monkeypatch):
    class FakeTicker:
        def __init__(self, ticker):
            pass

        def get_news(self, count):
            return []

    class FakeSearch:
        def __init__(self, query, max_results, news_count):
            assert query == "AAPL"
            self.news = [OLD_FORMAT]

    monkeypatch.setattr("app.market.yf.Ticker", FakeTicker)
    monkeypatch.setattr("app.market.yf.Search", FakeSearch)
    assert [n.title for n in download_news("AAPL")] == ["Old style headline"]


def test_download_news_falls_back_when_stream_raises(monkeypatch):
    class FakeTicker:
        def __init__(self, ticker):
            pass

        def get_news(self, count):
            raise ValueError("bad json")

    class FakeSearch:
        def __init__(self, query, max_results, news_count):
            self.news = [NEW_FORMAT]

    monkeypatch.setattr("app.market.yf.Ticker", FakeTicker)
    monkeypatch.setattr("app.market.yf.Search", FakeSearch)
    assert [n.title for n in download_news("AAPL")] == ["Apple beats estimates"]


def test_empty_news_is_not_cached():
    calls = []

    def loader(ticker):
        calls.append(ticker)
        return []

    cache = TTLCache(60, loader)
    cache.get("AAPL")
    cache.get("AAPL")
    assert calls == ["AAPL", "AAPL"]


@pytest.fixture
def client(tmp_path):
    calls = []

    def loader(ticker):
        idx = pd.bdate_range("2015-01-01", periods=400)
        info = TickerInfo(name="Fake", earnings_date=dt.date(2026, 10, 27), earnings_date_end=dt.date(2026, 10, 30))
        return History(close=pd.Series(np.linspace(50, 150, 400), index=idx), currency="USD", info=info)

    def news_loader(ticker):
        calls.append(ticker)
        if ticker == "DOWN":
            raise ConnectionError("rate limited")
        return [NewsItem(title="Hello", url="https://example.com", published_at=dt.datetime(2026, 10, 1, tzinfo=dt.timezone.utc))]

    settings = Settings(
        admin_key=ADMIN, db_path=str(tmp_path / "t.db"), cache_ttl_seconds=60, static_dir=str(tmp_path / "x")
    )
    c = TestClient(create_app(settings, loader=loader, news_loader=news_loader))
    c.news_calls = calls
    return c


def test_series_includes_earnings_date(client):
    info = client.get("/api/series?ticker=fake", headers=AUTH).json()["info"]
    assert info["earnings_date"] == "2026-10-27"
    assert info["earnings_date_end"] == "2026-10-30"


def test_news_endpoint_is_cached(client):
    r = client.get("/api/news?ticker=aapl", headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["ticker"] == "AAPL"
    assert body["items"][0]["title"] == "Hello"
    assert body["items"][0]["published_at"] == "2026-10-01T00:00:00+00:00"
    client.get("/api/news?ticker=AAPL", headers=AUTH)
    assert client.news_calls == ["AAPL"]


def test_news_requires_auth_and_reports_upstream_errors(client):
    assert client.get("/api/news?ticker=AAPL").status_code == 401
    r = client.get("/api/news?ticker=DOWN", headers=AUTH)
    assert r.status_code == 502 and "rate limited" in r.json()["detail"]
