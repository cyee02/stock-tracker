import math
import threading
import time
from dataclasses import dataclass, field

import pandas as pd
import yfinance as yf

# Approximate trading days per period.
PERIOD_WINDOWS: dict[str, int] = {
    "3m": 63,
    "6m": 126,
    "1y": 252,
    "3y": 756,
    "5y": 1260,
    "10y": 2520,
}


class TickerNotFound(Exception):
    pass


@dataclass
class TickerInfo:
    name: str | None = None
    quote_type: str | None = None
    description: str | None = None
    nav: float | None = None


@dataclass
class History:
    close: pd.Series
    currency: str | None
    info: TickerInfo = field(default_factory=TickerInfo)


def _float(x) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(v) else v


def download_info(t: yf.Ticker) -> TickerInfo:
    """Name, description and NAV. Best effort: Yahoo's quote summary is flaky."""
    try:
        info = t.info or {}
    except Exception:
        return TickerInfo()
    quote_type = info.get("quoteType")
    nav = _float(info.get("navPrice"))
    if nav is None and quote_type == "MUTUALFUND":
        # Mutual funds trade at NAV, so the quoted price is the NAV.
        nav = _float(info.get("regularMarketPrice")) or _float(info.get("previousClose"))
    return TickerInfo(
        name=info.get("longName") or info.get("shortName"),
        quote_type=quote_type,
        description=info.get("longBusinessSummary") or info.get("description"),
        nav=nav,
    )


def download_history(ticker: str) -> History:
    t = yf.Ticker(ticker)
    df = t.history(period="max", interval="1d", auto_adjust=True)
    if df is None or df.empty or "Close" not in df:
        raise TickerNotFound(ticker)
    close = df["Close"].dropna()
    if close.empty:
        raise TickerNotFound(ticker)
    close.index = pd.DatetimeIndex(close.index).tz_localize(None).normalize()
    currency = None
    try:
        currency = t.history_metadata.get("currency")
    except Exception:
        pass
    return History(close=close, currency=currency, info=download_info(t))


class HistoryCache:
    def __init__(self, ttl_seconds: int, loader=download_history):
        self.ttl = ttl_seconds
        self.loader = loader
        self._data: dict[str, tuple[float, History]] = {}
        self._lock = threading.Lock()

    def get(self, ticker: str) -> History:
        now = time.monotonic()
        with self._lock:
            hit = self._data.get(ticker)
            if hit and now - hit[0] < self.ttl:
                return hit[1]
        history = self.loader(ticker)
        with self._lock:
            self._data[ticker] = (now, history)
        return history


def compute_bands(close: pd.Series, window: int) -> pd.DataFrame:
    """Trailing moving average and 25th/75th price percentiles.

    The value at each date uses only the `window` closes ending on that date.
    """
    rolling = close.rolling(window, min_periods=window)
    return pd.DataFrame(
        {
            "close": close,
            "ma": rolling.mean(),
            "p25": rolling.quantile(0.25, interpolation="linear"),
            "p75": rolling.quantile(0.75, interpolation="linear"),
        }
    )


def classify(close: float, p25: float, p75: float) -> str:
    if close < p25:
        return "underpriced"
    if close > p75:
        return "overpriced"
    return "fair"


# (label, years back); YTD is measured from the prior year's last close.
RETURN_PERIODS: list[tuple[str, int | None]] = [("YTD", None), ("1Y", 1), ("5Y", 5), ("10Y", 10)]


def compute_returns(close: pd.Series) -> list[dict]:
    """Price change from the last close on or before each period's start date.

    `close` is dividend-adjusted, so these are total returns. A period is None
    when the history doesn't reach back to its start date.
    """
    last_date = close.index[-1]
    last = close.iloc[-1]
    out = []
    for label, years in RETURN_PERIODS:
        if years is None:
            start = pd.Timestamp(last_date.year - 1, 12, 31)
        else:
            start = last_date - pd.DateOffset(years=years)
        base = close.loc[:start]
        total = annualized = None
        if not base.empty and base.iloc[-1] > 0:
            total = float(last / base.iloc[-1] - 1)
            if years and years > 1:
                annualized = float((1 + total) ** (1 / years) - 1)
        out.append({"period": label, "total": total, "annualized": annualized})
    return out
