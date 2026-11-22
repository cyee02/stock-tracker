"""AI financial analyses: generate (owner only), cache for an hour, and save for later.

They live alongside the news summaries: same cache, same saved-summaries table and
the same list at GET /api/news/summaries, keyed by the latest reported period.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.auth import Viewer, require_admin, require_viewer
from app.fin_summary import build_fin_prompt
from app.market import Financials, latest_period
from app.routes.summaries import summary_status
from app.summary import ClaudeUnavailable, SummaryError, SummaryTimeout, fin_key, now_iso

router = APIRouter(prefix="/api/financials")

PERIOD = r"^\d{4}-\d{2}-\d{2}$"


class FinKey(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=20)
    # The reporting period the analysis covers; the latest one when omitted.
    period: str | None = Field(None, pattern=PERIOD)


class FinGenerateRequest(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=20)
    refresh: bool = False


def _financials(request: Request, ticker: str) -> Financials:
    try:
        fin = request.app.state.financials.get(ticker)
    except Exception as exc:
        raise HTTPException(502, f"Could not fetch financials from Yahoo Finance: {exc}")
    if fin is None:
        raise HTTPException(404, f"No financial statements for {ticker}")
    return fin


def _resolve(request: Request, ticker: str, period: str | None) -> tuple[str, str, str]:
    """(ticker, cache key, period), looking up the latest period when none is given."""
    ticker = ticker.strip().upper()
    if period is None:
        period = latest_period(_financials(request, ticker))
        if period is None:
            raise HTTPException(404, f"No financial statements for {ticker}")
    return ticker, fin_key(period), period


def _base(ticker: str, period: str) -> dict:
    return {"ticker": ticker, "kind": "financials", "period": period}


@router.get("/summary")
def get_fin_summary(
    request: Request,
    ticker: str = Query(..., min_length=1, max_length=20),
    period: str | None = Query(None, pattern=PERIOD),
    _: Viewer = Depends(require_viewer),
):
    """The analysis for this period if one is saved or cached, and whether a run is going. Never calls Claude."""
    ticker, rk, period = _resolve(request, ticker, period)
    return summary_status(request.app.state, ticker, rk, _base(ticker, period))


@router.post("/summary", status_code=202)
def generate_fin_summary(request: Request, body: FinGenerateRequest, _: Viewer = Depends(require_admin)):
    """Start analysing the latest financials with Claude in the background.

    Skipped when a saved or cached analysis of this period exists, unless `refresh`.
    Poll GET /summary for the result.
    """
    ticker, rk, period = _resolve(request, body.ticker, None)
    state = request.app.state
    base = _base(ticker, period)
    if not body.refresh and (state.db.get_summary(ticker, rk) or state.summaries.peek((ticker, rk))):
        return summary_status(state, ticker, rk, base)

    # Runs on a background thread after this request has returned.
    def generate() -> dict:
        fin = _financials(request, ticker)
        try:
            peers = state.peers.get(ticker)
        except Exception:
            peers = None
        try:
            result = state.fin_summarizer(build_fin_prompt(ticker, fin, peers))
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
            "period": period,
            "currency": fin.currency,
            "profile": fin.profile,
            "ratios": fin.ratios,
            "peers": (peers or {}).get("peers", []),
            "peer_median": (peers or {}).get("median"),
        }

    state.summaries.start((ticker, rk), generate, base)
    return summary_status(state, ticker, rk, base)


@router.post("/summaries")
def save_fin_summary(request: Request, body: FinKey, _: Viewer = Depends(require_admin)):
    """Keep the cached analysis. Saving again replaces the saved copy.

    Listed, fetched and deleted with the news summaries under /api/news/summaries.
    """
    ticker, rk, period = _resolve(request, body.ticker, body.period)
    cached = request.app.state.summaries.peek((ticker, rk))
    if cached is None:
        raise HTTPException(409, "This analysis has expired; analyse again to save it")
    return request.app.state.db.save_summary(ticker, rk, None, period, cached)
