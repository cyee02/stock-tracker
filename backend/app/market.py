import threading
import time
from dataclasses import dataclass

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
class History:
    close: pd.Series
    currency: str | None


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
    return History(close=close, currency=currency)


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
