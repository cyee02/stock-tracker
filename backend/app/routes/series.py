import datetime as dt
import math

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.auth import Viewer, require_viewer
from app.market import (
    PERIOD_WINDOWS,
    RETURN_PERIODS,
    SMA_FAST,
    SMA_SLOW,
    TickerNotFound,
    classify,
    compute_bands,
    compute_returns,
    compute_smas,
    find_crosses,
    lookback_days,
    sma_trend,
)

router = APIRouter(prefix="/api")


def _num(x: float) -> float | None:
    return None if x is None or math.isnan(x) else round(float(x), 4)


def _iso(d) -> str | None:
    return d.isoformat() if d else None


@router.get("/me")
def me(viewer: Viewer = Depends(require_viewer)):
    return {"role": viewer.role, "name": viewer.name}


@router.get("/series")
def series(
    request: Request,
    ticker: str = Query(..., min_length=1, max_length=20),
    period: str = Query("1y"),
    start: dt.date | None = Query(None, description="First date to return; defaults to a year before the latest close"),
    _: Viewer = Depends(require_viewer),
):
    ticker = ticker.strip().upper()
    if period not in PERIOD_WINDOWS:
        raise HTTPException(422, f"period must be one of {', '.join(PERIOD_WINDOWS)}")
    window = PERIOD_WINDOWS[period]

    # Only pull what this view needs: its own dates plus enough earlier closes
    # to fill the longest trailing window (mean reversion or the slow SMA).
    view_start = start or (dt.date.today() - dt.timedelta(days=365))
    fetch_start = view_start - dt.timedelta(days=lookback_days(max(window, SMA_SLOW)))
    history = _history(request, ticker, fetch_start)

    close = history.close
    if start is None:
        # Relative to the data rather than the wall clock, for tickers that stopped trading.
        start = (close.index[-1] - pd.DateOffset(years=1)).date()
    if len(close) < window:
        raise HTTPException(
            422,
            f"{ticker} has {len(close)} trading days of history; a {period} window needs {window}",
        )

    df = compute_bands(close, window).join(compute_smas(close))
    # Crosses before `start` too, so "last cross" can look past the visible window.
    crosses = find_crosses(df["sma_fast"], df["sma_slow"])
    ohlc = getattr(history, "ohlc", None)
    if ohlc is not None:
        df = df.join(ohlc.rename(columns=str.lower))
    for col in ("open", "high", "low"):
        if col not in df:
            df[col] = float("nan")
    points = [
        {
            "date": idx.strftime("%Y-%m-%d"),
            "open": _num(row.open),
            "high": _num(row.high),
            "low": _num(row.low),
            "close": _num(row.close),
            "ma": _num(row.ma),
            "p25": _num(row.p25),
            "p75": _num(row.p75),
            "sma50": _num(row.sma_fast),
            "sma200": _num(row.sma_slow),
        }
        for idx, row in zip(df.index, df.itertuples(index=False))
        if idx.date() >= start
    ]
    if not points:
        raise HTTPException(422, f"No prices for {ticker} on or after {start.isoformat()}")
    last = points[-1]
    info = history.info
    return {
        "ticker": ticker,
        "currency": history.currency,
        "info": {
            "name": info.name,
            "quote_type": info.quote_type,
            "description": info.description,
            "nav": _num(info.nav),
            "earnings_date": _iso(info.earnings_date),
            "earnings_date_end": _iso(info.earnings_date_end),
        },
        "first_date": (history.first_date or close.index[0].date()).isoformat(),
        "start": start.isoformat(),
        "period": period,
        "window": window,
        "points": points,
        "latest": {
            **last,
            "signal": classify(last["close"], last["p25"], last["p75"]),
            "trend": sma_trend(last["sma50"], last["sma200"]),
        },
        "sma": {
            "fast": SMA_FAST,
            "slow": SMA_SLOW,
            "crosses": [
                {"date": c["date"].strftime("%Y-%m-%d"), "kind": c["kind"]}
                for c in crosses
            ],
        },
    }


def _history(request: Request, ticker: str, start: dt.date | None):
    try:
        return request.app.state.history.get(ticker, start)
    except TickerNotFound:
        raise HTTPException(404, f"No price data found for {ticker}")
    except Exception as exc:  # network errors, Yahoo rate limiting, etc.
        raise HTTPException(502, f"Could not fetch prices from Yahoo Finance: {exc}")


@router.get("/returns")
def returns(
    request: Request,
    ticker: str = Query(..., min_length=1, max_length=20),
    _: Viewer = Depends(require_viewer),
):
    """YTD/1Y/5Y/10Y returns. Separate from /series because it needs ten years of prices."""
    ticker = ticker.strip().upper()
    longest = max(y for _, y in RETURN_PERIODS if y)
    today = dt.date.today()
    start = today.replace(year=today.year - longest) - dt.timedelta(days=14)
    history = _history(request, ticker, start)
    return {
        "ticker": ticker,
        "returns": [
            {**r, "total": _num(r["total"]), "annualized": _num(r["annualized"])}
            for r in compute_returns(history.close)
        ],
    }


@router.get("/news")
def news(
    request: Request,
    ticker: str = Query(..., min_length=1, max_length=20),
    _: Viewer = Depends(require_viewer),
):
    ticker = ticker.strip().upper()
    try:
        items = request.app.state.news.get(ticker)
    except Exception as exc:  # network errors, Yahoo rate limiting, etc.
        raise HTTPException(502, f"Could not fetch news from Yahoo Finance: {exc}")
    return {
        "ticker": ticker,
        "items": [
            {
                "title": n.title,
                "url": n.url,
                "publisher": n.publisher,
                "published_at": _iso(n.published_at),
                "summary": n.summary,
                "thumbnail": n.thumbnail,
            }
            for n in items
        ],
    }
