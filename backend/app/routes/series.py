import math

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.auth import Viewer, require_viewer
from app.market import PERIOD_WINDOWS, TickerNotFound, classify, compute_bands

router = APIRouter(prefix="/api")


def _num(x: float) -> float | None:
    return None if x is None or math.isnan(x) else round(float(x), 4)


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

    df = compute_bands(close, window)
    points = [
        {
            "date": idx.strftime("%Y-%m-%d"),
            "close": _num(row.close),
            "ma": _num(row.ma),
            "p25": _num(row.p25),
            "p75": _num(row.p75),
        }
        for idx, row in zip(df.index, df.itertuples(index=False))
    ]
    last = points[-1]
    return {
        "ticker": ticker,
        "currency": history.currency,
        "period": period,
        "window": window,
        "points": points,
        "latest": {**last, "signal": classify(last["close"], last["p25"], last["p75"])},
    }
