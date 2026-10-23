import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.market import INCOME_ROWS, Financials, _statement, add_margins, normalize_ratios

ADMIN = "admin-key-for-tests-0123456789"
AUTH = {"Authorization": f"Bearer {ADMIN}"}


def _df(rows: dict[str, list], periods: list[str]) -> pd.DataFrame:
    return pd.DataFrame(rows, index=pd.to_datetime(periods)).T


def test_statement_is_oldest_first_with_nan_as_none():
    df = _df(
        {"Total Revenue": [200.0, 100.0], "Net Income": [20.0, np.nan]},
        ["2026-06-30", "2026-03-31"],
    )
    recs = _statement(df, INCOME_ROWS)
    assert [r["period"] for r in recs] == ["2026-03-31", "2026-06-30"]
    assert recs[0]["revenue"] == 100.0 and recs[0]["net_income"] is None
    assert recs[1]["net_income"] == 20.0


def test_statement_falls_back_to_second_row_name_and_misses_bank_rows():
    df = _df({"Operating Revenue": [50.0], "Net Interest Income": [30.0]}, ["2026-06-30"])
    (rec,) = _statement(df, INCOME_ROWS)
    assert rec["revenue"] == 50.0
    assert rec["net_interest_income"] == 30.0
    assert rec["gross_profit"] is None and rec["operating_income"] is None


def test_statement_drops_empty_columns_and_empty_frames():
    df = _df({"Total Revenue": [10.0, np.nan]}, ["2026-06-30", "2025-03-31"])
    assert [r["period"] for r in _statement(df, INCOME_ROWS)] == ["2026-06-30"]
    assert _statement(pd.DataFrame(), INCOME_ROWS) == []
    assert _statement(None, INCOME_ROWS) == []


def test_add_margins():
    (rec,) = add_margins([{"revenue": 200.0, "gross_profit": 100.0, "operating_income": None, "net_income": 50.0}])
    assert rec["gross_margin"] == 0.5
    assert rec["operating_margin"] is None
    assert rec["net_margin"] == 0.25
    (zero,) = add_margins([{"revenue": 0.0, "net_income": 5.0}])
    assert zero["net_margin"] is None


def test_normalize_ratios_converts_percentages_and_falls_back_for_peg():
    r = normalize_ratios({"debtToEquity": 78.4, "dividendYield": 0.31, "pegRatio": 2.75, "trailingPE": "n/a"})
    assert r["debt_to_equity"] == pytest.approx(0.784)
    assert r["dividend_yield"] == pytest.approx(0.0031)
    assert r["peg"] == 2.75
    assert r["trailing_pe"] is None
    assert r["roe"] is None


@pytest.fixture
def client(tmp_path):
    def financials_loader(ticker):
        if ticker == "SPY":
            return None
        if ticker == "DOWN":
            raise ConnectionError("rate limited")
        income = [{"period": "2026-06-30", "revenue": 100.0, "net_income": 10.0}]
        return Financials(
            quarterly={"income": income, "cashflow": [], "balance": []},
            annual={"income": [], "cashflow": [], "balance": []},
            eps_history=[{"quarter": "2026-06-30", "actual": 2.0, "estimate": 1.9, "surprise": 0.05}],
            ratios={"trailing_pe": 30.0},
            currency="USD",
        )

    settings = Settings(
        admin_key=ADMIN, db_path=str(tmp_path / "t.db"), cache_ttl_seconds=60, static_dir=str(tmp_path / "x")
    )
    return TestClient(create_app(settings, financials_loader=financials_loader))


def test_financials_route(client):
    body = client.get("/api/financials?ticker=aapl", headers=AUTH).json()
    assert body["ticker"] == "AAPL"
    assert body["currency"] == "USD"
    assert body["quarterly"]["income"][0]["revenue"] == 100.0
    assert body["eps_history"][0]["surprise"] == 0.05
    assert body["ratios"]["trailing_pe"] == 30.0


def test_financials_404_for_funds(client):
    r = client.get("/api/financials?ticker=SPY", headers=AUTH)
    assert r.status_code == 404


def test_financials_502_on_yahoo_error(client):
    assert client.get("/api/financials?ticker=DOWN", headers=AUTH).status_code == 502


def test_financials_requires_auth(client):
    assert client.get("/api/financials?ticker=AAPL").status_code == 401
