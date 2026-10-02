import numpy as np
import pandas as pd
import pytest

from app.market import classify, compute_bands, compute_returns


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
