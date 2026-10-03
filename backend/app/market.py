import datetime as dt
import logging
import math
import threading
import time
from dataclasses import dataclass, field

import pandas as pd
import yfinance as yf

log = logging.getLogger(__name__)

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
    # Next earnings announcement. Yahoo gives a single date once the company
    # confirms it, and a start/end window while it's still an estimate.
    earnings_date: dt.date | None = None
    earnings_date_end: dt.date | None = None


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


def next_earnings(dates, today: dt.date | None = None) -> tuple[dt.date | None, dt.date | None]:
    """Pick the upcoming earnings date (or window) from Yahoo's list.

    Returns (date, end): `end` is set when Yahoo only has an estimated range.
    Dates already in the past are ignored.
    """
    today = today or dt.date.today()
    days = sorted({_as_date(d) for d in dates or []} - {None})
    upcoming = [d for d in days if d >= today]
    if not upcoming:
        return None, None
    return upcoming[0], (upcoming[1] if len(upcoming) > 1 else None)


def _as_date(x) -> dt.date | None:
    if isinstance(x, dt.datetime):
        return x.date()
    if isinstance(x, dt.date):
        return x
    if isinstance(x, (int, float)) and not math.isnan(x):
        return dt.datetime.fromtimestamp(x, dt.timezone.utc).date()
    return None


def download_earnings(t: yf.Ticker, info: TickerInfo) -> None:
    """Fill in the next earnings date. Best effort: ETFs and funds have none."""
    try:
        dates = (t.calendar or {}).get("Earnings Date")
    except Exception:
        return
    info.earnings_date, info.earnings_date_end = next_earnings(dates)


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
    info = download_info(t)
    if info.quote_type in (None, "EQUITY"):
        download_earnings(t, info)
    return History(close=close, currency=currency, info=info)


@dataclass
class NewsItem:
    title: str
    url: str | None = None
    publisher: str | None = None
    published_at: dt.datetime | None = None
    summary: str | None = None
    thumbnail: str | None = None


def _parse_time(x) -> dt.datetime | None:
    if isinstance(x, (int, float)):
        return dt.datetime.fromtimestamp(x, dt.timezone.utc)
    if isinstance(x, str):
        try:
            return dt.datetime.fromisoformat(x.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _thumbnail(thumb) -> str | None:
    """Smallest thumbnail at least 100px wide, else the original."""
    if not isinstance(thumb, dict):
        return None
    sizes = [r for r in thumb.get("resolutions") or [] if isinstance(r, dict) and r.get("url")]
    fitting = sorted((r for r in sizes if (r.get("width") or 0) >= 100), key=lambda r: r.get("width") or 0)
    if fitting:
        return fitting[0]["url"]
    return thumb.get("originalUrl") or (sizes[0]["url"] if sizes else None)


def parse_news_item(raw: dict) -> NewsItem | None:
    """Normalise one entry of `Ticker.news`.

    yfinance ≥0.2.48 nests everything under "content"; older versions return
    a flat dict. Both are handled so a yfinance upgrade doesn't blank the tab.
    """
    c = raw.get("content") if isinstance(raw.get("content"), dict) else None
    if c is not None:
        title = c.get("title")
        link = (c.get("clickThroughUrl") or {}).get("url") or (c.get("canonicalUrl") or {}).get("url")
        publisher = (c.get("provider") or {}).get("displayName")
        published = _parse_time(c.get("pubDate") or c.get("displayTime"))
        summary = c.get("summary") or c.get("description")
        thumb = _thumbnail(c.get("thumbnail"))
    else:
        title = raw.get("title")
        link = raw.get("link")
        publisher = raw.get("publisher")
        published = _parse_time(raw.get("providerPublishTime"))
        summary = raw.get("summary")
        thumb = _thumbnail(raw.get("thumbnail"))
    if not title:
        return None
    # Only plain web links reach the page; anything else (javascript: etc.) is dropped.
    if not (isinstance(link, str) and link.startswith(("https://", "http://"))):
        link = None
    if not (isinstance(thumb, str) and thumb.startswith("https://")):
        thumb = None
    return NewsItem(title=title, url=link, publisher=publisher, published_at=published, summary=summary or None, thumbnail=thumb)


def _parse_all(raw) -> list[NewsItem]:
    return [n for n in (parse_news_item(r) for r in raw or [] if isinstance(r, dict)) if n]


def download_news(ticker: str, count: int = 20) -> list[NewsItem]:
    """Latest headlines for `ticker`, newest first.

    `Ticker.get_news` hits Yahoo's quote-page news stream. yfinance swallows
    its errors and returns [] when Yahoo answers with something unexpected, so
    an empty result falls back to Yahoo's search endpoint, which carries news
    for the symbol in the older flat format.
    """
    raw = []
    try:
        raw = yf.Ticker(ticker).get_news(count=count) or []
    except Exception as exc:
        log.warning("news stream failed for %s: %s", ticker, exc)
    items = _parse_all(raw)
    if not items:
        if raw:
            log.warning("news stream for %s had %d entries but none parsed; first keys: %s",
                        ticker, len(raw), sorted(raw[0]) if isinstance(raw[0], dict) else type(raw[0]))
        try:
            fallback = yf.Search(ticker, max_results=0, news_count=count).news
        except Exception as exc:
            log.warning("news search failed for %s: %s", ticker, exc)
            fallback = []
        items = _parse_all(fallback)
    epoch = dt.datetime.min.replace(tzinfo=dt.timezone.utc)
    return sorted(items, key=lambda n: n.published_at or epoch, reverse=True)


class TTLCache:
    """Per-ticker in-memory cache in front of a slow Yahoo loader."""

    def __init__(self, ttl_seconds: int, loader):
        self.ttl = ttl_seconds
        self.loader = loader
        self._data: dict[str, tuple[float, History]] = {}
        self._lock = threading.Lock()

    def get(self, ticker: str):
        now = time.monotonic()
        with self._lock:
            hit = self._data.get(ticker)
            if hit and now - hit[0] < self.ttl:
                return hit[1]
        value = self.loader(ticker)
        # An empty answer is more likely a Yahoo hiccup than the truth, so
        # don't let it stick for the whole TTL.
        if value or not isinstance(value, list):
            with self._lock:
                self._data[ticker] = (now, value)
        return value


class HistoryCache(TTLCache):
    def __init__(self, ttl_seconds: int, loader=download_history):
        super().__init__(ttl_seconds, loader)


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


SMA_FAST = 50
SMA_SLOW = 200


def compute_smas(close: pd.Series, fast: int = SMA_FAST, slow: int = SMA_SLOW) -> pd.DataFrame:
    """Trailing simple moving averages; NaN until each has a full window."""
    return pd.DataFrame(
        {
            "sma_fast": close.rolling(fast, min_periods=fast).mean(),
            "sma_slow": close.rolling(slow, min_periods=slow).mean(),
        }
    )


def find_crosses(fast: pd.Series, slow: pd.Series) -> list[dict]:
    """Dates where the fast SMA crosses the slow one.

    "golden" when fast moves from at-or-below slow to above it, "death" when it
    moves from at-or-above to below. Touching without crossing is not a cross.
    """
    diff = (fast - slow).dropna()
    out = []
    side = 0  # last strict side: 1 above, -1 below, 0 not yet known
    for date, d in diff.items():
        now = 1 if d > 0 else -1 if d < 0 else 0
        if now == 0:
            continue
        if side and now != side:
            out.append({"date": date, "kind": "golden" if now > 0 else "death"})
        side = now
    return out


def sma_trend(fast: float | None, slow: float | None) -> str | None:
    if fast is None or slow is None or math.isnan(fast) or math.isnan(slow):
        return None
    return "bullish" if fast > slow else "bearish" if fast < slow else None


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
