import datetime as dt
import math
import re
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import Viewer, require_admin, require_viewer
from app.market import SMA_SLOW, WATCH_WINDOW, TickerNotFound, lookback_days, watch_snapshot

router = APIRouter(prefix="/api/watchlist")

MAX_TICKERS = 60
TICKER_RE = re.compile(r"^[A-Z0-9.^=\-]{1,20}$")


def _start() -> dt.date:
    # Two years: enough for a full 1y percentile window on the latest close and
    # for the 50/200 SMA to have crossed at least once in most histories.
    return dt.date.today() - dt.timedelta(days=lookback_days(WATCH_WINDOW + SMA_SLOW + 252))


def _clean(ticker: str) -> str:
    t = ticker.strip().upper()
    if not TICKER_RE.match(t):
        raise HTTPException(422, f"Not a valid ticker: {ticker!r}")
    return t


def _num(x):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else x


def _row(request: Request, ticker: str) -> dict:
    try:
        history = request.app.state.history.get(ticker, _start())
    except TickerNotFound:
        return {"ticker": ticker, "error": "No price data found"}
    except Exception as exc:  # network errors, Yahoo rate limiting, etc.
        return {"ticker": ticker, "error": f"Could not fetch prices: {exc}"}
    info = history.info
    return {
        "ticker": ticker,
        "name": info.name,
        "quote_type": info.quote_type,
        "currency": history.currency,
        "nav": _num(info.nav),
        "earnings_date": info.earnings_date.isoformat() if info.earnings_date else None,
        "earnings_date_end": info.earnings_date_end.isoformat() if info.earnings_date_end else None,
        **watch_snapshot(history),
        "error": None,
    }


@router.get("/tickers")
def tickers(request: Request, _: Viewer = Depends(require_viewer)):
    """Just the symbols, for the add/remove button on the chart page."""
    return {"tickers": request.app.state.db.list_watchlist()}


@router.get("")
def watchlist(request: Request, _: Viewer = Depends(require_viewer)):
    """Every watched ticker with its latest prices and signals, in the order added."""
    symbols = request.app.state.db.list_watchlist()
    # Each cold ticker is a Yahoo round trip; fetch them side by side.
    with ThreadPoolExecutor(max_workers=8) as pool:
        rows = list(pool.map(lambda t: _row(request, t), symbols))
    return {"window": WATCH_WINDOW, "rows": rows}


@router.put("/{ticker}")
def add(request: Request, ticker: str, _: Viewer = Depends(require_admin)):
    t = _clean(ticker)
    db = request.app.state.db
    if t not in db.list_watchlist():
        if len(db.list_watchlist()) >= MAX_TICKERS:
            raise HTTPException(422, f"The watchlist holds at most {MAX_TICKERS} tickers")
        row = _row(request, t)
        if row["error"]:
            raise HTTPException(404 if row["error"] == "No price data found" else 502, f"{t}: {row['error']}")
        db.add_to_watchlist(t)
    return {"tickers": db.list_watchlist()}


@router.delete("/{ticker}")
def remove(request: Request, ticker: str, _: Viewer = Depends(require_admin)):
    db = request.app.state.db
    db.remove_from_watchlist(_clean(ticker))
    return {"tickers": db.list_watchlist()}
