import math

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.auth import Viewer, require_viewer
from app.market import (
    PERIOD_WINDOWS,
    SMA_FAST,
    SMA_SLOW,
    TickerNotFound,
    classify,
    compute_bands,
    compute_returns,
    compute_smas,
    find_crosses,
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
    _: Viewer = Depends(require_viewer),
):
    ticker = ticker.strip().upper()
    if period not in PERIOD_WINDOWS:
        raise HTTPException(422, f"period must be one of {', '.join(PERIOD_WINDOWS)}")
    window = PERIOD_WINDOWS[period]

    try:
        history = request.app.state.history.get(ticker)
    except TickerNotFound:
        raise HTTPException(404, f"No price data found for {ticker}")
    except Exception as exc:  # network errors, Yahoo rate limiting, etc.
        raise HTTPException(502, f"Could not fetch prices from Yahoo Finance: {exc}")

    close = history.close
    if len(close) < window:
        raise HTTPException(
            422,
            f"{ticker} has {len(close)} trading days of history; a {period} window needs {window}",
        )

    df = compute_bands(close, window).join(compute_smas(close))
    points = [
        {
            "date": idx.strftime("%Y-%m-%d"),
            "close": _num(row.close),
            "ma": _num(row.ma),
            "p25": _num(row.p25),
            "p75": _num(row.p75),
            "sma50": _num(row.sma_fast),
            "sma200": _num(row.sma_slow),
        }
        for idx, row in zip(df.index, df.itertuples(index=False))
    ]
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
        "returns": [
            {**r, "total": _num(r["total"]), "annualized": _num(r["annualized"])}
            for r in compute_returns(close)
        ],
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
                for c in find_crosses(df["sma_fast"], df["sma_slow"])
            ],
        },
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
