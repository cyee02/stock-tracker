import json

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.fin_summary import FinancialSummary, build_fin_prompt
from app.main import create_app
from app.market import Financials, choose_peers, latest_period, peer_medians
from app.summary import SummaryError, key_fields, parse_cli_output

ADMIN = "admin-key-for-tests-0123456789"
AUTH = {"Authorization": f"Bearer {ADMIN}"}

FIN_SUMMARY = {
    "one_liner": "Growing fast with fat margins, priced for it.",
    "health": {"label": "strong", "rationale": "Margins and cash flow are high."},
    "valuation": {"label": "expensive", "rationale": "P/E well above peers."},
    "metrics_to_watch": [
        {"metric": "Gross margin", "value": "46.2%", "trend": "improving", "why": "Pricing power", "watch_for": "Above 45%"}
    ],
    "peer_comparison": [{"metric": "trailing_pe", "verdict": "unfavorable", "comment": "Pricier than peers."}],
    "peer_notes": "Peers are the closest large caps.",
    "statement_insights": {"growth": ["Revenue up"], "profitability": [], "cash_flow": [], "balance_sheet": []},
    "strengths": ["Cash"],
    "concerns": ["Valuation"],
    "sources": [],
}


def financials(ticker="FAKE", period="2026-06-30"):
    income = [{"period": period, "revenue": 100.0, "net_income": 10.0, "gross_margin": 0.4}]
    return Financials(
        quarterly={"income": income, "cashflow": [], "balance": []},
        annual={"income": [], "cashflow": [], "balance": []},
        eps_history=[],
        ratios={"trailing_pe": 30.0, "roe": 0.25},
        currency="USD",
        profile={"name": "Fake Corp", "industry": "Widgets", "industry_key": "widgets", "market_cap": 1e9},
    )


PEERS = {
    "peers": [
        {"ticker": "PEER", "name": "Peer Inc", "industry": "Widgets", "same_industry": True,
         "market_cap": 2e9, "currency": "USD", "ratios": {"trailing_pe": 20.0, "roe": None}},
    ],
    "median": {"trailing_pe": 20.0, "roe": None},
}


@pytest.fixture
def client(tmp_path):
    settings = Settings(
        admin_key=ADMIN, db_path=str(tmp_path / "t.db"), cache_ttl_seconds=60, static_dir=str(tmp_path / "x")
    )
    prompts = []
    state = {"period": "2026-06-30"}

    def fin_summarizer(prompt):
        prompts.append(prompt)
        return {"summary": {**FIN_SUMMARY, "peer_notes": f"run {len(prompts)}"}, "model": "claude-test"}

    def loader(t):
        return None if t == "SPY" else financials(t, state["period"])

    c = TestClient(
        create_app(
            settings,
            financials_loader=loader,
            peers_loader=lambda t, profile: PEERS,
            fin_summarizer=fin_summarizer,
        )
    )
    c.prompts = prompts
    c.period = state
    return c


def analyse(c, refresh=False):
    r = c.post("/api/financials/summary", json={"ticker": "fake", "refresh": refresh}, headers=AUTH)
    assert r.status_code == 202
    c.app.state.summaries.wait()
    return c.get("/api/financials/summary?ticker=fake", headers=AUTH).json()


# --- peers ---


def _cand(t, cap, same=True):
    return {"ticker": t, "market_cap": cap, "same_industry": same}


def test_choose_peers_prefers_similar_sized_industry_peers():
    cands = [_cand("TINY", 1e6), _cand("NEAR", 2e9), _cand("FAR", 40e9), _cand("SEC", 1.1e9, same=False)]
    assert [p["ticker"] for p in choose_peers(1e9, cands, n=2)] == ["NEAR", "FAR"]
    # A thin industry is topped up from the sector; far-off industry names are left out.
    assert [p["ticker"] for p in choose_peers(1e9, cands, n=4)] == ["NEAR", "FAR", "SEC"]


def test_choose_peers_without_market_cap_keeps_yahoo_order():
    cands = [_cand("A", None), _cand("B", 5e9), _cand("S", 1e9, same=False)]
    assert [p["ticker"] for p in choose_peers(None, cands, n=3)] == ["A", "B", "S"]


def test_peer_medians():
    peers = [{"ratios": {"trailing_pe": v, "roe": None}} for v in (10.0, 30.0, 20.0, None)]
    med = peer_medians(peers)
    assert med["trailing_pe"] == 20.0
    assert med["roe"] is None
    assert peer_medians(peers[:2])["trailing_pe"] == 20.0


def test_latest_period_prefers_quarterly():
    fin = financials()
    fin.annual["income"] = [{"period": "2025-12-31"}]
    assert latest_period(fin) == "2026-06-30"
    fin.quarterly["income"] = []
    assert latest_period(fin) == "2025-12-31"


def test_key_fields():
    assert key_fields("fin:2026-06-30") == {"kind": "financials", "start": None, "end": None, "period": "2026-06-30"}
    assert key_fields("latest:2026-11-06")["kind"] == "news"
    assert key_fields("2026-01-01:2026-01-31")["start"] == "2026-01-01"


# --- prompt and parsing ---


def test_prompt_carries_statements_ratios_and_peers():
    prompt = build_fin_prompt("FAKE", financials(), PEERS)
    assert "Fake Corp" in prompt
    assert '"trailing_pe": 30.0' in prompt
    assert '"ticker": "PEER"' in prompt and '"peer_median"' in prompt
    assert '"revenue": 100.0' in prompt
    # Missing values are left out rather than sent as null.
    assert '"roe": null' not in prompt


def test_parse_financial_summary():
    stdout = json.dumps({"is_error": False, "structured_output": FIN_SUMMARY, "modelUsage": {"m": {}}})
    assert parse_cli_output(stdout, FinancialSummary)["summary"]["health"]["label"] == "strong"
    bad = {**FIN_SUMMARY, "peer_comparison": [{"metric": "made_up", "verdict": "in_line", "comment": ""}]}
    with pytest.raises(SummaryError):
        parse_cli_output(json.dumps({"is_error": False, "structured_output": bad}), FinancialSummary)


# --- routes ---


def test_generate_cache_and_refresh(client):
    body = analyse(client)
    assert body["kind"] == "financials" and body["period"] == "2026-06-30"
    assert body["source"] == "cache" and body["saved"] is False
    assert body["summary"]["valuation"]["label"] == "expensive"
    assert body["peers"][0]["ticker"] == "PEER" and body["peer_median"]["trailing_pe"] == 20.0
    assert body["ratios"]["trailing_pe"] == 30.0
    assert analyse(client)["summary"]["peer_notes"] == "run 1"
    assert analyse(client, refresh=True)["summary"]["peer_notes"] == "run 2"
    assert len(client.prompts) == 2


def test_get_never_generates(client):
    assert client.get("/api/financials/summary?ticker=fake", headers=AUTH).json()["summary"] is None
    assert client.prompts == []


def test_no_financials_is_404(client):
    assert client.get("/api/financials/summary?ticker=spy", headers=AUTH).status_code == 404
    assert client.post("/api/financials/summary", json={"ticker": "spy"}, headers=AUTH).status_code == 404


def test_save_and_list_with_news_summaries(client):
    analyse(client)
    listing = client.get("/api/news/summaries", headers=AUTH).json()
    (row,) = listing["unsaved"]
    assert row["kind"] == "financials" and row["period"] == "2026-06-30"
    assert row["health"] == "strong" and row["valuation"] == "expensive"

    saved = client.post("/api/financials/summaries", json={"ticker": "fake", "period": "2026-06-30"}, headers=AUTH)
    assert saved.status_code == 200
    listing = client.get("/api/news/summaries", headers=AUTH).json()
    assert listing["unsaved"] == []
    (row,) = listing["items"]
    assert (row["kind"], row["period"], row["health"], row["valuation"]) == ("financials", "2026-06-30", "strong", "expensive")
    full = client.get(f"/api/news/summaries/{row['id']}", headers=AUTH).json()
    assert full["peers"][0]["ticker"] == "PEER"
    body = client.get("/api/financials/summary?ticker=fake", headers=AUTH).json()
    assert body["source"] == "saved" and body["saved"] is True


def test_new_period_starts_a_new_analysis(client):
    analyse(client)
    client.post("/api/financials/summaries", json={"ticker": "fake"}, headers=AUTH)
    # Next quarter reported: the saved analysis stays under its own period.
    client.period["period"] = "2026-09-30"
    client.app.state.financials._data.clear()
    assert client.get("/api/financials/summary?ticker=fake", headers=AUTH).json()["summary"] is None
    old = client.get("/api/financials/summary?ticker=fake&period=2026-06-30", headers=AUTH).json()
    assert old["saved"] is True


def test_save_expired_is_409(client):
    r = client.post("/api/financials/summaries", json={"ticker": "fake"}, headers=AUTH)
    assert r.status_code == 409


def test_viewer_cannot_generate(client):
    token = client.post("/api/admin/links", json={"name": "Friend"}, headers=AUTH).json()["token"]
    v = {"Authorization": f"Bearer {token}"}
    assert client.post("/api/financials/summary", json={"ticker": "fake"}, headers=v).status_code == 403
    assert client.get("/api/financials/summary?ticker=fake", headers=v).status_code == 200


def test_save_when_done(client):
    import threading

    release = threading.Event()
    client.app.state.fin_summarizer = lambda prompt: release.wait(5) and {"summary": FIN_SUMMARY, "model": "m"}
    assert client.post("/api/financials/summary", json={"ticker": "fake"}, headers=AUTH).status_code == 202
    r = client.post("/api/financials/summaries", json={"ticker": "fake", "when_done": True}, headers=AUTH)
    assert r.status_code == 202 and r.json()["period"] == "2026-06-30"
    assert client.get("/api/financials/summary?ticker=fake", headers=AUTH).json()["job"]["save_when_done"] is True

    release.set()
    client.app.state.summaries.wait()
    body = client.get("/api/financials/summary?ticker=fake", headers=AUTH).json()
    assert body["saved"] is True and body["source"] == "saved"
    (row,) = client.get("/api/news/summaries", headers=AUTH).json()["items"]
    assert (row["kind"], row["period"]) == ("financials", "2026-06-30")


def test_cancel_save_when_done(client):
    import threading

    release = threading.Event()
    client.app.state.fin_summarizer = lambda prompt: release.wait(5) and {"summary": FIN_SUMMARY, "model": "m"}
    client.post("/api/financials/summary", json={"ticker": "fake"}, headers=AUTH)
    client.post("/api/financials/summaries", json={"ticker": "fake", "when_done": True}, headers=AUTH)
    assert client.delete("/api/financials/summary/save-when-done?ticker=fake", headers=AUTH).status_code == 204
    release.set()
    client.app.state.summaries.wait()
    assert client.get("/api/financials/summary?ticker=fake", headers=AUTH).json()["saved"] is False
