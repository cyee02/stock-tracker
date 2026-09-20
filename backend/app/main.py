import os

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import Settings, get_settings
from app.db import Database
from app.market import HistoryCache, download_history
from app.routes import admin, series


def create_app(settings: Settings | None = None, loader=download_history) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="Stock Tracker", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = settings
    app.state.db = Database(settings.db_path)
    app.state.history = HistoryCache(settings.cache_ttl_seconds, loader)

    @app.get("/healthz")
    def healthz():
        return {"ok": True}

    app.include_router(series.router)
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

