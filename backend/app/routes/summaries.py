"""AI news summaries: generate (owner only), cache for an hour, and save for later."""

import dataclasses
import datetime as dt

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.auth import Viewer, require_admin, require_viewer
from app.market import (
    PERIOD_WINDOWS,
    History,
    classify,
    compute_bands,
    compute_returns,
    compute_smas,
    find_crosses,
    lookback_days,
    sma_trend,
)
from app.routes.series import _check_range, _history, _iso, _news_items, _num
from app.summary import ClaudeUnavailable, SummaryError, SummaryTimeout, build_prompt, now_iso, range_key

router = APIRouter(prefix="/api/news")

# Mean-reversion window used for the price context: one year of sessions.
CONTEXT_WINDOW = PERIOD_WINDOWS["1y"]


class SummaryKey(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=20)
    start: dt.date | None = None
    end: dt.date | None = None


class GenerateRequest(SummaryKey):
    refresh: bool = False


def _key(ticker: str, start: dt.date | None, end: dt.date | None) -> tuple[str, str]:
    _check_range(start, end)
    return ticker.strip().upper(), range_key(start, end)


def price_context(history: History, as_of: dt.date | None) -> dict | None:
    """Where the price stood at `as_of` (default: the latest close) by the app's own signals."""
    close = history.close
    if as_of is not None:
        close = close.loc[: pd.Timestamp(as_of)]
    if close.empty:
        return None
    bands = compute_bands(close, CONTEXT_WINDOW).iloc[-1]
    smas = compute_smas(close)
    last = smas.iloc[-1]
    crosses = find_crosses(smas["sma_fast"], smas["sma_slow"])
    p25, p75 = _num(bands.p25), _num(bands.p75)
    return {
        "as_of": close.index[-1].strftime("%Y-%m-%d"),
        "close": _num(close.iloc[-1]),
        "currency": history.currency,
        **_candles(history, close),
        "mean_reversion_1y": {
            "p25": p25,
            "p75": p75,
            "moving_average": _num(bands.ma),
            "signal": classify(close.iloc[-1], p25, p75) if p25 is not None and p75 is not None else None,
        },
        "sma50": _num(last.sma_fast),
        "sma200": _num(last.sma_slow),
        "trend": sma_trend(last.sma_fast, last.sma_slow),
        "last_cross": (
            {"date": crosses[-1]["date"].strftime("%Y-%m-%d"), "kind": crosses[-1]["kind"]} if crosses else None
        ),
        "returns": {
            r["period"]: _num(r["total"]) for r in compute_returns(close) if r["total"] is not None
        },
    }


# Recent daily candles sent to Claude so it can read the price action.
RECENT_SESSIONS = 10


def _candles(history: History, close: pd.Series) -> dict:
    """The last session's OHLC and change, plus the recent candles leading up to it."""
    prev = _num(close.iloc[-2]) if len(close) > 1 else None
    last_close = _num(close.iloc[-1])
    out = {
        "ohlc": None,
        "prev_close": prev,
        "change_pct": round(last_close / prev - 1, 4) if prev and last_close is not None else None,
        "recent_sessions": [],
    }
    ohlc = history.ohlc
    if ohlc is None or ohlc.empty:
        return out
    rows = ohlc.rename(columns=str.lower).join(close.rename("close"), how="inner").loc[: close.index[-1]]
    recent = rows.tail(RECENT_SESSIONS)
    out["recent_sessions"] = [
        {"date": d.strftime("%Y-%m-%d"), "open": _num(r.open), "high": _num(r.high), "low": _num(r.low), "close": _num(r.close)}
        for d, r in zip(recent.index, recent.itertuples(index=False))
    ]
    if out["recent_sessions"] and out["recent_sessions"][-1]["date"] == close.index[-1].strftime("%Y-%m-%d"):
        last = out["recent_sessions"][-1]
        out["ohlc"] = {k: last[k] for k in ("open", "high", "low", "close")}
    return out


def _response(ticker: str, start, end, saved: dict | None, cached: dict | None) -> dict:
    """The newer of the saved and cached summaries, with where it came from."""
    base = {"ticker": ticker, "start": _iso(start), "end": _iso(end)}
    status = {
        "saved": saved is not None,
        "saved_id": saved["id"] if saved else None,
        "saved_at": saved["saved_at"] if saved else None,
        "has_newer_unsaved": bool(saved and cached and cached["generated_at"] > saved["generated_at"]),
    }
    if cached and (not saved or cached["generated_at"] > saved["generated_at"]):
        return {**base, **cached, **status, "source": "cache"}
    if saved:
        entry = {k: v for k, v in saved.items() if k not in ("id", "ticker", "range_key", "start", "end", "saved_at")}
        return {**base, **entry, **status, "source": "saved", "expires_in": None}
    return {**base, "summary": None, **status}


@router.get("/summary")
def get_summary(
    request: Request,
    ticker: str = Query(..., min_length=1, max_length=20),
    start: dt.date | None = Query(None),
    end: dt.date | None = Query(None),
    _: Viewer = Depends(require_viewer),
):
    """The summary for these headlines if one is saved or cached, and whether a run is going.

    Never calls Claude; the page polls this while a background run is in progress.
    """
    ticker, rk = _key(ticker, start, end)
    return _status(request.app.state, ticker, rk, start, end)


def _status(state, ticker: str, rk: str, start, end) -> dict:
    saved = state.db.get_summary(ticker, rk)
    cached = state.summaries.peek((ticker, rk))
    job = state.summaries.job((ticker, rk))
    out = _response(ticker, start, end, saved, cached)
    if job and "error" not in job:
        out["job"] = {"status": "running", "started_at": job["started_at"]}
    elif job:
        out["job"] = {"status": "failed", "error": job["error"]}
    else:
        out["job"] = None
    return out


@router.post("/summary", status_code=202)
def generate_summary(request: Request, body: GenerateRequest, _: Viewer = Depends(require_admin)):
    """Start summarizing the headlines with Claude in the background.

    Skipped when a saved or cached summary exists, unless `refresh`. The run keeps
    going if the browser leaves; poll GET /summary for the result.
    """
    ticker, rk = _key(body.ticker, body.start, body.end)
    start, end = body.start, body.end
    state = request.app.state
    if not body.refresh and (state.db.get_summary(ticker, rk) or state.summaries.peek((ticker, rk))):
        return _status(state, ticker, rk, start, end)

    # Runs on a background thread after this request has returned; it only uses
    # request.app (via the shared helpers), never the request itself.
    def generate() -> dict:
        items = _news_items(request, ticker, start, end)
        if not items:
            raise HTTPException(422, f"No headlines to summarize for {ticker}")
        history = state.history.peek(ticker)
        needed = (end or dt.date.today()) - dt.timedelta(days=lookback_days(CONTEXT_WINDOW) + 365)
        if history is None or history.close.index[0].date() > needed:
            history = _history(request, ticker, needed)
        price = price_context(history, end)
        try:
            analyst = state.analyst.get(ticker)
        except Exception:
            analyst = None
        info = history.info
        earnings = (
            {"date": _iso(info.earnings_date), "estimated_until": _iso(info.earnings_date_end)}
            if info.earnings_date
            else None
        )
        prompt = build_prompt(ticker, info.name, items, start, end, price, analyst, earnings)
        try:
            result = state.summarizer(prompt)
        except ClaudeUnavailable as exc:
            raise HTTPException(503, str(exc))
        except SummaryTimeout as exc:
            raise HTTPException(504, str(exc))
        except SummaryError as exc:
            raise HTTPException(502, str(exc))
        return {
            "generated_at": now_iso(),
            "model": result.get("model"),
            "summary": result["summary"],
            "analyst": dataclasses.asdict(analyst) if analyst else None,
            "price": price,
            "earnings": earnings,
            "articles_total": len(items),
        }

    state.summaries.start((ticker, rk), generate, {"ticker": ticker, "start": _iso(start), "end": _iso(end)})
    return _status(state, ticker, rk, start, end)


@router.post("/summaries")
def save_summary(request: Request, body: SummaryKey, _: Viewer = Depends(require_admin)):
    """Keep the cached summary for these headlines. Saving again replaces the saved copy."""
    ticker, rk = _key(body.ticker, body.start, body.end)
    cached = request.app.state.summaries.peek((ticker, rk))
    if cached is None:
        raise HTTPException(409, "This summary has expired; summarize again to save it")
    return request.app.state.db.save_summary(ticker, rk, _iso(body.start), _iso(body.end), cached)


def _split_range_key(rk: str) -> tuple[str | None, str | None]:
    if rk.startswith("latest:"):
        return None, None
    start, end = rk.split(":")
    return start, end


@router.get("/summaries")
def list_summaries(
    request: Request,
    ticker: str | None = Query(None, min_length=1, max_length=20),
    _: Viewer = Depends(require_viewer),
):
    """Saved summaries, plus cached ones not saved yet and runs in progress or failed.

    Across all tickers unless `ticker` is given.
    """
    state = request.app.state
    ticker = ticker.strip().upper() if ticker else None
    saved = state.db.list_summaries(ticker)
    saved_at = {(r["ticker"], r["range_key"]): r["generated_at"] for r in saved}
    unsaved = []
    for (t, rk), entry in state.summaries.entries():
        if ticker and t != ticker:
            continue
        # Already saved, and this is that same version (or an older one).
        if (t, rk) in saved_at and entry["generated_at"] <= saved_at[(t, rk)]:
            continue
        start, end = _split_range_key(rk)
        s = entry["summary"]
        unsaved.append({
            "ticker": t,
            "range_key": rk,
            "start": start,
            "end": end,
            "generated_at": entry["generated_at"],
            "expires_in": entry["expires_in"],
            "model": entry.get("model"),
            "sentiment": s["sentiment"]["label"],
            "stance": s["stance"]["action"],
            "replaces_saved": (t, rk) in saved_at,
        })
    jobs = []
    for (t, rk), job in state.summaries.jobs():
        if ticker and t != ticker:
            continue
        start, end = _split_range_key(rk)
        jobs.append({
            "ticker": t,
            "range_key": rk,
            "start": start,
            "end": end,
            "status": "failed" if "error" in job else "running",
            "started_at": job.get("started_at"),
            "error": job.get("error"),
        })
    return {"items": saved, "unsaved": unsaved, "jobs": jobs}


@router.get("/summaries/{summary_id}")
def get_saved(request: Request, summary_id: int, _: Viewer = Depends(require_viewer)):
    row = request.app.state.db.get_summary_by_id(summary_id)
    if row is None:
        raise HTTPException(404, "Summary not found")
    return row


@router.delete("/summaries/{summary_id}", status_code=204)
def delete_saved(request: Request, summary_id: int, _: Viewer = Depends(require_admin)):
    if not request.app.state.db.delete_summary(summary_id):
        raise HTTPException(404, "Summary not found")
