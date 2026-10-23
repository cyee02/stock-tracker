import mimetypes
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import Settings, get_settings
from app.db import Database
from app.market import (
    HistoryCache,
    TTLCache,
    download_analyst,
    download_dated_news,
    download_financials,
    download_history,
    download_news,
)
from app.alerts import live_price, send_push, start_checker
from app.routes import admin, alerts, series, summaries, watchlist
from app.summary import SummaryCache, run_claude

# Not in every platform's MIME table; browsers want this type for the PWA manifest.
mimetypes.add_type("application/manifest+json", ".webmanifest")


def create_app(
    settings: Settings | None = None,
    loader=download_history,
    news_loader=download_news,
    dated_news_loader=download_dated_news,
    analyst_loader=download_analyst,
    financials_loader=download_financials,
    price_loader=live_price,
    pusher=send_push,
    summarizer=None,
) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Watches the watchlist for price alerts while the server runs.
        app.state.alert_checker = start_checker(app)
        yield
        app.state.alert_checker.stop()

    app = FastAPI(title="Stock Tracker", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.settings = settings
    app.state.db = Database(settings.db_path)
    app.state.history = HistoryCache(settings.cache_ttl_seconds, loader)
    app.state.news = TTLCache(settings.cache_ttl_seconds, news_loader)
    # Keyed by (search query, start, end).
    app.state.dated_news = TTLCache(settings.cache_ttl_seconds, lambda key: dated_news_loader(*key))
    app.state.analyst = TTLCache(settings.cache_ttl_seconds, analyst_loader)
    app.state.financials = TTLCache(settings.cache_ttl_seconds, financials_loader)
    # Price alerts: live price per ticker, and how a notification reaches a device.
    app.state.price_loader = price_loader
    app.state.pusher = pusher
    app.state.alert_checker = None
    # Keyed by (ticker, range key); see app.summary.range_key.
    app.state.summaries = SummaryCache(settings.summary_ttl_seconds)
    # prompt -> {"summary": ..., "model": ...}
    app.state.summarizer = summarizer or (
        lambda prompt: run_claude(
            prompt,
            cli=settings.claude_cli,
            model=settings.claude_model,
            timeout=settings.claude_timeout_seconds,
        )
    )

    @app.get("/healthz")
    def healthz():
        return {"ok": True}

    app.include_router(series.router)
    app.include_router(summaries.router)
    app.include_router(watchlist.router)
    app.include_router(alerts.router)
    app.include_router(admin.router)

    static_dir = os.path.abspath(settings.static_dir)
    index = os.path.join(static_dir, "index.html")
    if os.path.isfile(index):
        app.mount("/assets", StaticFiles(directory=os.path.join(static_dir, "assets")), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            if path.startswith("api/"):
                raise HTTPException(404)
            candidate = os.path.abspath(os.path.join(static_dir, path))
            if path and candidate.startswith(static_dir + os.sep) and os.path.isfile(candidate):
                return FileResponse(candidate)
            return FileResponse(index)

    return app

