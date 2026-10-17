import datetime as dt

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.market import (
    History,
    NewsItem,
    TickerInfo,
    TTLCache,
    download_dated_news,
    download_news,
    news_query,
    next_earnings,
    parse_google_news,
    parse_news_item,
)

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

    def loader(ticker, start=None):
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


@pytest.mark.parametrize(
    "name, query",
    [
        ("Apple Inc.", '"Apple" stock'),
        ("DBS Group Holdings Ltd", '"DBS" stock'),
        ("SPDR S&P 500 ETF Trust", '"SPDR S&P 500 ETF" stock'),
        ("Costco Wholesale Corporation", '"Costco Wholesale" stock'),
        (None, '"F" stock'),
    ],
)
def test_news_query_uses_short_company_name(name, query):
    assert news_query("F", name) == query


GOOGLE_RSS = """<?xml version="1.0"?><rss><channel>
<item><title>Ford shares tumble - CNBC</title><link>https://news.google.com/a</link>
<pubDate>Wed, 24 Jul 2024 07:00:00 GMT</pubDate><source url="https://cnbc.com">CNBC</source></item>
<item><title>Untitled-less</title><link>javascript:x</link><pubDate>Fri, 26 Jul 2024 07:00:00 GMT</pubDate></item>
<item><title></title></item>
</channel></rss>"""


def test_parse_google_news():
    a, b = parse_google_news(GOOGLE_RSS)
    assert (a.title, a.publisher, a.url) == ("Ford shares tumble", "CNBC", "https://news.google.com/a")
    assert a.published_at == dt.datetime(2024, 7, 24, 7, tzinfo=dt.timezone.utc)
    assert b.url is None and b.publisher is None


def test_download_dated_news_trims_to_range(monkeypatch):
    seen = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            pass

        def read(self):
            return GOOGLE_RSS.encode()

    def fake_urlopen(req, timeout):
        seen["url"] = req.full_url
        return FakeResponse()

    monkeypatch.setattr("app.market.urllib.request.urlopen", fake_urlopen)
    items = download_dated_news('"Ford" stock', dt.date(2024, 7, 24), dt.date(2024, 7, 25))
    assert [n.title for n in items] == ["Ford shares tumble"]
    assert "after%3A2024-07-23+before%3A2024-07-26" in seen["url"]


@pytest.fixture
def dated_client(tmp_path):
    calls = []

    def loader(ticker, start=None):
        idx = pd.bdate_range("2015-01-01", periods=400)
        return History(close=pd.Series(np.linspace(50, 150, 400), index=idx), currency="USD", info=TickerInfo(name="Fake Inc."))

    def dated_loader(query, start, end):
        calls.append((query, start, end))
        return [NewsItem(title="Old news", published_at=dt.datetime(2024, 7, 24, 7, tzinfo=dt.timezone.utc))]

    settings = Settings(
        admin_key=ADMIN, db_path=str(tmp_path / "t.db"), cache_ttl_seconds=60, static_dir=str(tmp_path / "x")
    )
    c = TestClient(create_app(settings, loader=loader, news_loader=lambda t: [], dated_news_loader=dated_loader))
    c.dated_calls = calls
    return c


def test_dated_news_uses_cached_company_name(dated_client):
    url = "/api/news?ticker=fake&start=2024-07-24&end=2024-07-25"
    body = dated_client.get(url, headers=AUTH).json()
    assert body["items"][0]["title"] == "Old news"
    assert dated_client.dated_calls == [('"FAKE" stock', dt.date(2024, 7, 24), dt.date(2024, 7, 25))]
    # Once the chart has loaded the ticker, its name is used instead of the symbol.
    dated_client.get("/api/series?ticker=fake", headers=AUTH)
    body = dated_client.get(url, headers=AUTH).json()
    assert (body["start"], body["end"]) == ("2024-07-24", "2024-07-25")
    assert dated_client.dated_calls[-1][0] == '"Fake" stock'


@pytest.mark.parametrize(
    "qs",
    ["start=2024-07-24", "start=2024-07-25&end=2024-07-24", "start=2010-01-01&end=2024-07-24"],
)
def test_dated_news_rejects_bad_ranges(dated_client, qs):
    assert dated_client.get(f"/api/news?ticker=X&{qs}", headers=AUTH).status_code == 422
