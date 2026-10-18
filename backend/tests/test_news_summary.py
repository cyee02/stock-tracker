import datetime as dt
import json

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db import Database
from app.main import create_app
from app.market import AnalystData, History, NewsItem, TickerInfo, download_analyst
from app.summary import (
    ClaudeUnavailable,
    SummaryError,
    SummaryTimeout,
    parse_cli_output,
    range_key,
    run_claude,
)

ADMIN = "admin-key-for-tests-0123456789"
AUTH = {"Authorization": f"Bearer {ADMIN}"}

SUMMARY = {
    "one_liner": "Strong quarter, but the price already reflects it.",
    "sentiment": {"label": "bullish", "score": 0.6, "rationale": "Strong quarter."},
    "stance": {"action": "buy", "confidence": "medium", "horizon": "3-6 months", "rationale": "Momentum."},
    "top_happenings": [
        {"headline": "Beat estimates", "why_it_matters": "Growth", "impact": "positive", "urls": ["https://a"]},
    ],
    "price_context": {
        "candlestick": ["Closed at the high"],
        "mean_reversion": ["Above p75"],
        "sma_trend": ["50 above 200"],
    },
    "risks": ["Regulation"],
    "catalysts": [{"event": "Earnings", "date": "2026-10-27"}],
    "bull_case": "More growth.",
    "bear_case": "Valuation.",
    "articles_read": ["https://a"],
}


def fake_loader(ticker, start=None):
    idx = pd.bdate_range(end=pd.Timestamp.today().normalize(), periods=600)
    info = TickerInfo(name="Fake Corp", quote_type="EQUITY", earnings_date=dt.date(2026, 10, 27))
    close = pd.Series(np.linspace(50, 150, 600), index=idx)
    ohlc = pd.DataFrame({"Open": close - 1, "High": close + 2, "Low": close - 3}, index=idx)
    return History(close=close, currency="USD", info=info, ohlc=ohlc)


@pytest.fixture
def client(tmp_path):
    settings = Settings(
        admin_key=ADMIN,
        db_path=str(tmp_path / "test.db"),
        cache_ttl_seconds=60,
        static_dir=str(tmp_path / "nostatic"),
    )
    prompts = []

    def summarizer(prompt):
        prompts.append(prompt)
        if client.fail:
            raise client.fail
        return {"summary": {**SUMMARY, "bull_case": f"run {len(prompts)}"}, "model": "claude-test"}

    news = [NewsItem(title="Fake beats estimates", url="https://news/fake", publisher="Reuters")]
    c = TestClient(
        create_app(
            settings,
            loader=fake_loader,
            news_loader=lambda t: news,
            dated_news_loader=lambda q, s, e: [NewsItem(title="Old fake news", url="https://news/old")],
            analyst_loader=lambda t: AnalystData(recommendation="buy", analyst_count=30, target_mean=180.0),
            summarizer=summarizer,
        )
    )
    c.prompts = prompts
    c.fail = None
    client = c
    return c


def viewer_auth(c):
    token = c.post("/api/admin/links", json={"name": "Friend"}, headers=AUTH).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def summarize(c, refresh=False, **rng):
    """Start a run, wait for the background job, and return what the page would poll."""
    r = c.post("/api/news/summary", json={"ticker": "fake", "refresh": refresh, **rng}, headers=AUTH)
    if r.status_code != 202:
        return r
    c.app.state.summaries.wait()
    qs = f"&start={rng['start']}&end={rng['end']}" if rng else ""
    return c.get(f"/api/news/summary?ticker=fake{qs}", headers=AUTH)


# --- CLI output parsing ---


def cli_stdout(**extra):
    return json.dumps({"type": "result", "is_error": False, "result": json.dumps(SUMMARY),
                       "structured_output": SUMMARY, "modelUsage": {"claude-sonnet-5-5": {}}, **extra})


def test_parse_cli_output():
    out = parse_cli_output(cli_stdout())
    assert out["summary"]["stance"]["action"] == "buy"
    assert out["model"] == "claude-sonnet-5-5"


def test_parse_cli_output_falls_back_to_result_text():
    out = parse_cli_output(cli_stdout(structured_output=None))
    assert out["summary"]["sentiment"]["label"] == "bullish"


def test_parse_cli_output_error():
    with pytest.raises(SummaryError, match="Not logged in"):
        parse_cli_output(json.dumps({"is_error": True, "result": "Not logged in"}))


@pytest.mark.parametrize("stdout", ["not json", json.dumps({"is_error": False, "structured_output": {"x": 1}})])
def test_parse_cli_output_malformed(stdout):
    with pytest.raises(SummaryError):
        parse_cli_output(stdout)


class _Proc:
    def __init__(self, stdout):
        self.stdout, self.stderr, self.returncode = stdout, "", 0


def test_run_claude_retries_once_on_shape_errors(tmp_path, monkeypatch):
    cli = tmp_path / "claude"
    cli.write_text("")
    outputs = [json.dumps({"is_error": True, "subtype": "error_max_structured_output_retries"}), cli_stdout()]
    monkeypatch.setattr("app.summary.subprocess.run", lambda *a, **k: _Proc(outputs.pop(0)))
    assert run_claude("hi", cli=str(cli))["summary"]["stance"]["action"] == "buy"
    assert outputs == []


def test_run_claude_does_not_retry_other_errors(tmp_path, monkeypatch):
    cli = tmp_path / "claude"
    cli.write_text("")
    calls = []

    def fake_run(*a, **k):
        calls.append(1)
        return _Proc(json.dumps({"is_error": True, "result": "Not logged in"}))

    monkeypatch.setattr("app.summary.subprocess.run", fake_run)
    with pytest.raises(SummaryError, match="Not logged in"):
        run_claude("hi", cli=str(cli))
    assert len(calls) == 1


def test_run_claude_without_cli():
    with pytest.raises(ClaudeUnavailable):
        run_claude("hi", cli=None)
    with pytest.raises(ClaudeUnavailable):
        run_claude("hi", cli="/nonexistent/claude")


# --- generating and caching ---


def test_generate_is_cached_and_refreshable(client):
    r = summarize(client)
    assert r.status_code == 200
    body = r.json()
    assert body["summary"]["stance"]["action"] == "buy"
    assert body["source"] == "cache" and body["saved"] is False
    assert body["analyst"]["target_mean"] == 180.0
    assert body["price"]["close"] == 150.0 and body["price"]["trend"] == "bullish"
    assert body["price"]["ohlc"] == {"open": 149.0, "high": 152.0, "low": 147.0, "close": 150.0}
    assert body["price"]["change_pct"] > 0
    assert len(body["price"]["recent_sessions"]) == 10
    assert body["articles_total"] == 1
    assert len(client.prompts) == 1

    assert summarize(client).json()["summary"]["bull_case"] == "run 1"
    assert len(client.prompts) == 1
    assert summarize(client, refresh=True).json()["summary"]["bull_case"] == "run 2"
    assert len(client.prompts) == 2


def test_prompt_carries_news_price_and_analyst_data(client):
    summarize(client)
    prompt = client.prompts[0]
    assert "https://news/fake" in prompt
    assert "Fake Corp" in prompt
    assert '"recommendation": "buy"' in prompt
    assert '"trend": "bullish"' in prompt
    assert '"recent_sessions"' in prompt and '"high": 152.0' in prompt
    assert "2026-10-27" in prompt


def test_dated_range_is_cached_separately(client):
    summarize(client)
    r = summarize(client, start="2024-07-24", end="2024-07-25")
    assert r.json()["start"] == "2024-07-24"
    assert len(client.prompts) == 2
    assert "https://news/old" in client.prompts[1]
    # Price context is as of the end of the range, not today.
    assert r.json()["price"]["as_of"] <= "2024-07-25"


def test_get_never_generates(client):
    r = client.get("/api/news/summary?ticker=fake", headers=AUTH)
    assert r.json()["summary"] is None
    assert client.prompts == []
    summarize(client)
    assert client.get("/api/news/summary?ticker=fake", headers=AUTH).json()["summary"]["bull_case"] == "run 1"


def test_viewer_can_read_but_not_generate(client):
    v = viewer_auth(client)
    assert client.post("/api/news/summary", json={"ticker": "fake"}, headers=v).status_code == 403
    summarize(client)
    assert client.get("/api/news/summary?ticker=fake", headers=v).json()["summary"] is not None


@pytest.mark.parametrize(
    "exc,status", [(ClaudeUnavailable("no cli"), 503), (SummaryTimeout("slow"), 504), (SummaryError("bad"), 502)]
)
def test_summarizer_errors(client, exc, status):
    client.fail = exc
    body = summarize(client).json()
    assert body["summary"] is None
    assert body["job"] == {"status": "failed", "error": str(exc)}
    # Failures aren't cached, and a new run clears the error.
    client.fail = None
    body = summarize(client).json()
    assert body["summary"]["bull_case"] == "run 2" and body["job"] is None


def test_run_continues_in_background_and_is_joined(client):
    import threading

    release = threading.Event()
    calls = []

    def slow(prompt):
        calls.append(prompt)
        release.wait(5)
        return {"summary": SUMMARY, "model": "m"}

    client.app.state.summarizer = slow
    r = client.post("/api/news/summary", json={"ticker": "fake"}, headers=AUTH)
    assert r.status_code == 202 and r.json()["job"]["status"] == "running"
    # A second click (or another tab) joins the run instead of starting another.
    client.post("/api/news/summary", json={"ticker": "fake", "refresh": True}, headers=AUTH)
    body = client.get("/api/news/summary?ticker=fake", headers=AUTH).json()
    assert body["summary"] is None and body["job"]["status"] == "running"
    jobs = client.get("/api/news/summaries", headers=AUTH).json()["jobs"]
    assert [(j["ticker"], j["status"]) for j in jobs] == [("FAKE", "running")]

    release.set()
    client.app.state.summaries.wait()
    body = client.get("/api/news/summary?ticker=fake", headers=AUTH).json()
    assert body["summary"] is not None and body["job"] is None
    assert len(calls) == 1


def test_overview_lists_unsaved_and_saved_across_tickers(client):
    summarize(client)
    summarize(client, start="2024-07-24", end="2024-07-25")
    client.post("/api/news/summaries", json={"ticker": "fake", "start": "2024-07-24", "end": "2024-07-25"}, headers=AUTH)
    body = client.get("/api/news/summaries", headers=AUTH).json()
    assert [i["range_key"] for i in body["items"]] == ["2024-07-24:2024-07-25"]
    assert len(body["unsaved"]) == 1
    u = body["unsaved"][0]
    assert u["ticker"] == "FAKE" and u["range_key"].startswith("latest:") and u["start"] is None
    assert u["sentiment"] == "bullish" and u["replaces_saved"] is False and u["expires_in"] > 0
    # Filtering by another ticker hides both.
    other = client.get("/api/news/summaries?ticker=msft", headers=AUTH).json()
    assert other == {"items": [], "unsaved": [], "jobs": []}


def test_bad_range(client):
    assert summarize(client, start="2024-07-24").status_code == 422


# --- saving ---


def test_save_and_reuse_after_cache_expires(client):
    summarize(client)
    r = client.post("/api/news/summaries", json={"ticker": "fake"}, headers=AUTH)
    assert r.status_code == 200
    saved_id = r.json()["id"]

    client.app.state.summaries._data.clear()  # the hour is up
    body = client.get("/api/news/summary?ticker=fake", headers=AUTH).json()
    assert body["source"] == "saved" and body["saved_id"] == saved_id
    assert body["summary"]["bull_case"] == "run 1"
    assert body["price"]["close"] == 150.0
    # Generating without refresh uses the saved copy.
    assert summarize(client).json()["source"] == "saved"
    assert len(client.prompts) == 1


def test_refresh_after_save_then_save_replaces(client):
    summarize(client)
    client.post("/api/news/summaries", json={"ticker": "fake"}, headers=AUTH)
    # Make the refresh strictly newer than the saved copy.
    db = client.app.state.db
    with db._connect() as conn:
        conn.execute("UPDATE saved_summaries SET generated_at = '2000-01-01T00:00:00+00:00'")

    body = summarize(client, refresh=True).json()
    assert body["source"] == "cache" and body["saved"] is True and body["has_newer_unsaved"] is True
    assert body["summary"]["bull_case"] == "run 2"

    client.post("/api/news/summaries", json={"ticker": "fake"}, headers=AUTH)
    items = client.get("/api/news/summaries?ticker=fake", headers=AUTH).json()["items"]
    assert len(items) == 1
    assert client.get(f"/api/news/summaries/{items[0]['id']}", headers=AUTH).json()["summary"]["bull_case"] == "run 2"
    assert client.get("/api/news/summary?ticker=fake", headers=AUTH).json()["has_newer_unsaved"] is False


def test_save_requires_cached_summary(client):
    assert client.post("/api/news/summaries", json={"ticker": "fake"}, headers=AUTH).status_code == 409


def test_viewer_permissions_on_saved(client):
    v = viewer_auth(client)
    summarize(client)
    assert client.post("/api/news/summaries", json={"ticker": "fake"}, headers=v).status_code == 403
    saved_id = client.post("/api/news/summaries", json={"ticker": "fake"}, headers=AUTH).json()["id"]
    items = client.get("/api/news/summaries?ticker=fake", headers=v).json()["items"]
    assert items[0]["sentiment"] == "bullish" and items[0]["stance"] == "buy"
    assert "summary" not in items[0]
    assert client.get(f"/api/news/summaries/{saved_id}", headers=v).status_code == 200
    assert client.delete(f"/api/news/summaries/{saved_id}", headers=v).status_code == 403
    assert client.delete(f"/api/news/summaries/{saved_id}", headers=AUTH).status_code == 204
    assert client.get(f"/api/news/summaries/{saved_id}", headers=AUTH).status_code == 404


def test_latest_key_is_per_day():
    assert range_key(None, None, dt.date(2026, 10, 18)) == "latest:2026-10-18"
    assert range_key(dt.date(2024, 8, 1), dt.date(2024, 8, 1)) == "2024-08-01:2024-08-01"


def test_yesterdays_latest_summary_is_listed_not_reused(client):
    yesterday = range_key(None, None, dt.date.today() - dt.timedelta(days=1))
    entry = {"generated_at": "2026-01-01T00:00:00+00:00", "model": "m", "summary": SUMMARY}
    client.app.state.db.save_summary("FAKE", yesterday, None, None, entry)
    assert client.get("/api/news/summary?ticker=fake", headers=AUTH).json()["summary"] is None
    assert len(client.get("/api/news/summaries?ticker=fake", headers=AUTH).json()["items"]) == 1


# --- database ---


def test_db_summaries_upsert_order_delete(tmp_path):
    db = Database(str(tmp_path / "t.db"))
    e = {"generated_at": "2026-10-01T00:00:00+00:00", "model": "m", "summary": SUMMARY, "expires_in": 10}
    a = db.save_summary("AAPL", "2024-08-01:2024-08-01", "2024-08-01", "2024-08-01", e)
    db.save_summary("AAPL", "latest:2026-10-18", None, None, e)
    db.save_summary("AAPL", "2024-08-01:2024-08-01", "2024-08-01", "2024-08-01", {**e, "model": "m2"})
    db.save_summary("MSFT", "latest:2026-10-18", None, None, e)
    items = db.list_summaries("AAPL")
    assert [i["range_key"] for i in items] == ["latest:2026-10-18", "2024-08-01:2024-08-01"]
    assert items[1]["id"] == a["id"] and items[1]["model"] == "m2"
    assert "expires_in" not in db.get_summary_by_id(a["id"])
    assert db.delete_summary(a["id"]) and not db.delete_summary(a["id"])
    assert len(db.list_summaries("AAPL")) == 1


# --- analyst data ---


class FakeTicker:
    def __init__(self, fail=False):
        self.fail = fail

    def _get(self, value):
        if self.fail:
            raise RuntimeError("404")
        return value

    @property
    def analyst_price_targets(self):
        return self._get({"current": 100.0, "low": 80.0, "mean": 120.0, "median": 118.0, "high": 150.0})

    @property
    def recommendations_summary(self):
        return self._get(pd.DataFrame(
            [{"period": "0m", "strongBuy": 5, "buy": 10, "hold": 3, "sell": 1, "strongSell": 0},
             {"period": "-1m", "strongBuy": 1, "buy": 1, "hold": 1, "sell": 1, "strongSell": 1}]
        ))

    @property
    def info(self):
        return self._get({"recommendationKey": "buy", "numberOfAnalystOpinions": 19})


def test_download_analyst(monkeypatch):
    monkeypatch.setattr("app.market.yf.Ticker", lambda t: FakeTicker())
    a = download_analyst("AAPL")
    assert a.recommendation == "buy" and a.analyst_count == 19
    assert (a.target_low, a.target_mean, a.target_high, a.current_price) == (80.0, 120.0, 150.0, 100.0)
    assert (a.strong_buy, a.buy, a.hold, a.sell, a.strong_sell) == (5, 10, 3, 1, 0)


def test_download_analyst_none_when_everything_fails(monkeypatch):
    monkeypatch.setattr("app.market.yf.Ticker", lambda t: FakeTicker(fail=True))
    assert download_analyst("SPY") is None
