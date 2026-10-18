import datetime as dt
import email.utils
import logging
import math
import re
import threading
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
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
    # Daily Open/High/Low aligned to `close`'s index; None when the loader has no OHLC.
    ohlc: pd.DataFrame | None = None
    # Earliest date Yahoo has for the ticker, which may be before `close` starts
    # when the loader was asked for a recent window only.
    first_date: dt.date | None = None


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


def download_history(ticker: str, start: dt.date | None = None) -> History:
    """Daily adjusted prices from `start` onward, or the full history when it's None."""
    t = yf.Ticker(ticker)
    if start is None:
        df = t.history(period="max", interval="1d", auto_adjust=True)
    else:
        df = t.history(start=start.isoformat(), interval="1d", auto_adjust=True)
    if df is None or df.empty or "Close" not in df:
        raise TickerNotFound(ticker)
    close = df["Close"].dropna()
    if close.empty:
        raise TickerNotFound(ticker)
    close.index = pd.DatetimeIndex(close.index).tz_localize(None).normalize()
    ohlc = None
    if {"Open", "High", "Low"} <= set(df.columns):
        ohlc = df.loc[df["Close"].notna(), ["Open", "High", "Low"]].copy()
        ohlc.index = close.index
    currency = None
    first_date = close.index[0].date() if start is None else None
    try:
        meta = t.history_metadata
        currency = meta.get("currency")
        if first_date is None and meta.get("firstTradeDate") is not None:
            # A Timestamp in recent yfinance, epoch seconds in older ones.
            ftd = meta["firstTradeDate"]
            first_date = (pd.Timestamp(ftd, unit="s") if isinstance(ftd, (int, float)) else pd.Timestamp(ftd)).date()
    except Exception:
        pass
    info = download_info(t)
    if info.quote_type in (None, "EQUITY"):
        download_earnings(t, info)
    return History(close=close, currency=currency, info=info, ohlc=ohlc, first_date=first_date)


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


GOOGLE_NEWS_RSS = "https://news.google.com/rss/search"
# Legal-form suffixes that articles rarely repeat ("Apple Inc." is written "Apple").
_NAME_SUFFIXES = re.compile(
    r"[,.]?\s+(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|holdings?|group|"
    r"trust|n\.?v|s\.?a|ag|se|class [a-z])\.?$",
    re.IGNORECASE,
)


def news_query(ticker: str, name: str | None) -> str:
    """Google News search for a ticker's coverage.

    The company name finds far more relevant stories than the symbol, which is
    often a common word ("F", "SPY") or never printed at all ("D05.SI").
    """
    if not name:
        return f'"{ticker}" stock'
    short = name.strip()
    while (trimmed := _NAME_SUFFIXES.sub("", short).strip()) and trimmed != short:
        short = trimmed
    return f'"{short}" stock'


def parse_google_news(xml_text: str) -> list[NewsItem]:
    """Items of a Google News RSS feed; titles lose their " - Publisher" tail."""
    root = ET.fromstring(xml_text)
    items = []
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        if not title:
            continue
        publisher = (it.findtext("source") or "").strip() or None
        if publisher and title.endswith(f" - {publisher}"):
            title = title[: -len(publisher) - 3]
        link = it.findtext("link")
        if not (isinstance(link, str) and link.startswith(("https://", "http://"))):
            link = None
        published = None
        if raw := it.findtext("pubDate"):
            try:
                published = email.utils.parsedate_to_datetime(raw).astimezone(dt.timezone.utc)
            except (TypeError, ValueError):
                pass
        items.append(NewsItem(title=title, url=link, publisher=publisher, published_at=published))
    return items


def download_dated_news(query: str, start: dt.date, end: dt.date) -> list[NewsItem]:
    """Headlines matching `query` published from `start` to `end` (inclusive), newest first.

    Yahoo only serves the latest ~20 stories, so dated lookups go to Google
    News, whose search takes date bounds. It returns at most 100 items, picked
    by relevance, so long ranges get the most prominent stories only.
    """
    # Google's after:/before: bounds are exclusive.
    q = f"{query} after:{(start - dt.timedelta(days=1)).isoformat()} before:{(end + dt.timedelta(days=1)).isoformat()}"
    url = f"{GOOGLE_NEWS_RSS}?{urllib.parse.urlencode({'q': q, 'hl': 'en-US', 'gl': 'US', 'ceid': 'US:en'})}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (stock-tracker)"})
    with urllib.request.urlopen(req, timeout=15) as res:
        items = parse_google_news(res.read().decode("utf-8", "replace"))
    # The bounds are fuzzy at the edges (Google dates items by day), so trim to the range.
    items = [n for n in items if n.published_at is None or start <= n.published_at.date() <= end]
    epoch = dt.datetime.min.replace(tzinfo=dt.timezone.utc)
    return sorted(items, key=lambda n: n.published_at or epoch, reverse=True)


@dataclass
class AnalystData:
    """Wall Street consensus from Yahoo: rating, price targets and rating counts."""

    recommendation: str | None = None  # Yahoo's recommendationKey, e.g. "buy"
    analyst_count: int | None = None
    current_price: float | None = None
    target_low: float | None = None
    target_mean: float | None = None
    target_median: float | None = None
    target_high: float | None = None
    # This month's spread of ratings.
    strong_buy: int | None = None
    buy: int | None = None
    hold: int | None = None
    sell: int | None = None
    strong_sell: int | None = None


def _int(x) -> int | None:
    v = _float(x)
    return None if v is None else int(v)


def download_analyst(ticker: str) -> AnalystData | None:
    """Analyst consensus for a stock. Best effort: ETFs and funds have none, so None."""
    t = yf.Ticker(ticker)
    out = AnalystData()
    try:
        targets = t.analyst_price_targets or {}
        out.current_price = _float(targets.get("current"))
        out.target_low = _float(targets.get("low"))
        out.target_mean = _float(targets.get("mean"))
        out.target_median = _float(targets.get("median"))
        out.target_high = _float(targets.get("high"))
    except Exception as exc:
        log.info("no price targets for %s: %s", ticker, exc)
    try:
        rec = t.recommendations_summary
        if rec is not None and not rec.empty:
            row = rec[rec["period"] == "0m"].iloc[0] if "period" in rec else rec.iloc[0]
            out.strong_buy = _int(row.get("strongBuy"))
            out.buy = _int(row.get("buy"))
            out.hold = _int(row.get("hold"))
            out.sell = _int(row.get("sell"))
            out.strong_sell = _int(row.get("strongSell"))
    except Exception as exc:
        log.info("no recommendations for %s: %s", ticker, exc)
    try:
        info = t.info or {}
        key = info.get("recommendationKey")
        out.recommendation = key if key and key != "none" else None
        out.analyst_count = _int(info.get("numberOfAnalystOpinions"))
        out.current_price = out.current_price or _float(info.get("currentPrice"))
    except Exception as exc:
        log.info("no quote summary for %s: %s", ticker, exc)
    if out.recommendation is None and out.target_mean is None and out.buy is None:
        return None
    return out


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


class HistoryCache:
    """Per-ticker price history cache that remembers how far back each entry reaches.

    A request for an earlier start than the cached one reloads from that start;
    anything inside the cached span is served from memory.
    """

    def __init__(self, ttl_seconds: int, loader=download_history):
        self.ttl = ttl_seconds
        self.loader = loader
        # ticker -> (loaded at, start it was loaded from (None = full history), history)
        self._data: dict[str, tuple[float, dt.date | None, History]] = {}
        self._lock = threading.Lock()

    def get(self, ticker: str, start: dt.date | None = None) -> History:
        now = time.monotonic()
        with self._lock:
            hit = self._data.get(ticker)
            if hit and now - hit[0] < self.ttl and (hit[1] is None or (start is not None and hit[1] <= start)):
                return hit[2]
        value = self.loader(ticker, start)
        with self._lock:
            self._data[ticker] = (now, start, value)
        return value

    def peek(self, ticker: str) -> History | None:
        """Cached history of any age or span, without loading anything."""
        with self._lock:
            hit = self._data.get(ticker)
        return hit[2] if hit else None


def lookback_days(trading_days: int) -> int:
    """Calendar days that comfortably hold `trading_days` sessions, holidays included."""
    return math.ceil(trading_days * 7 / 5 * 1.1) + 10


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
