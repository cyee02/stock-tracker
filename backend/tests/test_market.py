import numpy as np
import pandas as pd
import pytest

from app.market import classify, compute_bands, compute_returns, compute_smas, find_crosses, sma_trend


@pytest.fixture
def close():
    rng = np.random.default_rng(0)
    idx = pd.bdate_range("2020-01-01", periods=300)
    return pd.Series(100 + rng.normal(0, 1, 300).cumsum(), index=idx)


def test_bands_match_trailing_slice(close):
    window = 63
    df = compute_bands(close, window)
    for i in [window - 1, 100, 299]:
        trailing = close.iloc[i - window + 1 : i + 1].to_numpy()
        assert df["ma"].iloc[i] == pytest.approx(trailing.mean())
        assert df["p25"].iloc[i] == pytest.approx(np.percentile(trailing, 25))
        assert df["p75"].iloc[i] == pytest.approx(np.percentile(trailing, 75))


def test_bands_nan_before_full_window(close):
    df = compute_bands(close, 63)
    assert df[["ma", "p25", "p75"]].iloc[:62].isna().all().all()
    assert df[["ma", "p25", "p75"]].iloc[62:].notna().all().all()


def test_no_look_ahead(close):
    base = compute_bands(close, 63)
    changed = close.copy()
    changed.iloc[200:] *= 10
    after = compute_bands(changed, 63)
    pd.testing.assert_frame_equal(base.iloc[:200], after.iloc[:200])


@pytest.mark.parametrize(
    "price,expected", [(9, "underpriced"), (10, "fair"), (15, "fair"), (20, "fair"), (21, "overpriced")]
)
def test_classify(price, expected):
    assert classify(price, 10, 20) == expected


def _by_period(close):
    return {r["period"]: r for r in compute_returns(close)}


def test_returns_use_last_close_on_or_before_start():
    idx = pd.bdate_range("2014-06-02", "2025-06-30")
    close = pd.Series(np.arange(1, len(idx) + 1, dtype=float), index=idx)
    r = _by_period(close)
    last = close.iloc[-1]
    assert r["YTD"]["total"] == pytest.approx(last / close.loc[:"2024-12-31"].iloc[-1] - 1)
    assert r["1Y"]["total"] == pytest.approx(last / close.loc[:"2024-06-30"].iloc[-1] - 1)
    five = last / close.loc[:"2020-06-30"].iloc[-1] - 1
    assert r["5Y"]["total"] == pytest.approx(five)
    assert r["5Y"]["annualized"] == pytest.approx((1 + five) ** (1 / 5) - 1)
    assert r["10Y"]["total"] == pytest.approx(last / close.loc[:"2015-06-30"].iloc[-1] - 1)
    assert r["YTD"]["annualized"] is None and r["1Y"]["annualized"] is None


def test_returns_none_when_history_too_short(close):
    # fixture spans 2020-01-01 .. 2021-02-23: covers YTD and 1Y, not 5Y/10Y
    r = _by_period(close)
    assert r["YTD"]["total"] is not None
    assert r["1Y"]["total"] is not None
    assert r["5Y"] == {"period": "5Y", "total": None, "annualized": None}
    assert r["10Y"]["total"] is None


def test_smas_match_trailing_mean(close):
    df = compute_smas(close)
    assert df["sma_fast"].iloc[:49].isna().all()
    assert df["sma_slow"].iloc[:199].isna().all()
    assert df["sma_fast"].iloc[120] == pytest.approx(close.iloc[71:121].mean())
    assert df["sma_slow"].iloc[250] == pytest.approx(close.iloc[51:251].mean())


def test_find_crosses_golden_and_death():
    idx = pd.bdate_range("2024-01-01", periods=7)
    fast = pd.Series([float("nan"), 1, 2, 3, 3, 2, 1], index=idx)
    slow = pd.Series([float("nan"), 2, 2, 2, 3, 3, 3], index=idx)
    # below -> touch (no cross) -> above -> touch -> below
    crosses = find_crosses(fast, slow)
    assert [(c["date"], c["kind"]) for c in crosses] == [(idx[3], "golden"), (idx[5], "death")]


def test_find_crosses_ignores_touch_without_crossing():
    idx = pd.bdate_range("2024-01-01", periods=4)
    fast = pd.Series([1.0, 2, 1, 1], index=idx)
    slow = pd.Series([2.0, 2, 2, 2], index=idx)
    assert find_crosses(fast, slow) == []


@pytest.mark.parametrize(
    "fast,slow,expected", [(2, 1, "bullish"), (1, 2, "bearish"), (1, 1, None), (None, 1, None), (float("nan"), 1, None)]
)
def test_sma_trend(fast, slow, expected):
    assert sma_trend(fast, slow) == expected


def test_download_history_keeps_ohlc(monkeypatch):
    import numpy as np
    import pandas as pd

    from app import market

    idx = pd.date_range("2024-01-01", periods=5, freq="D", tz="America/New_York")
    df = pd.DataFrame(
        {
            "Open": np.arange(10.0, 15),
            "High": np.arange(12.0, 17),
            "Low": np.arange(9.0, 14),
            "Close": np.arange(11.0, 16),
        },
        index=idx,
    )

    class FakeTicker:
        history_metadata = {"currency": "USD"}

        def __init__(self, _):
            pass

        def history(self, **_):
            return df

    monkeypatch.setattr(market.yf, "Ticker", FakeTicker)
    monkeypatch.setattr(market, "download_info", lambda t: market.TickerInfo(quote_type="ETF"))
    h = market.download_history("X")
    assert list(h.ohlc.columns) == ["Open", "High", "Low"]
    assert h.ohlc.index.equals(h.close.index)
    assert (h.ohlc["High"] >= h.ohlc["Low"]).all()


def test_history_cache_reloads_only_for_an_earlier_start():
    import datetime as dt

    from app.market import History, HistoryCache

    calls = []

    def loader(ticker, start):
        calls.append(start)
        return History(close=pd.Series([1.0]), currency=None)

    cache = HistoryCache(60, loader)
    d = dt.date(2024, 1, 1)
    cache.get("X", d)
    cache.get("X", d + dt.timedelta(days=30))  # inside the cached span
    cache.get("X", d - dt.timedelta(days=30))  # earlier: reload
    cache.get("X", None)  # full history: reload
    cache.get("X", d)  # anything after a full load is cached
    assert calls == [d, d - dt.timedelta(days=30), None]
