from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api import audit_log as audit_api
from app.api import auth as auth_api
from app.api import backups as backups_api
from app.api import imports as imports_api
from app.api import master as master_api
from app.api import reports as reports_api
from app.api import users as users_api
from app.core.appkey import AppKeyMiddleware
from app.core.config import Settings
from app.services.backup import BackupService
from app.services.startup import run_startup
from app.state import AppState, Mode

log = logging.getLogger(__name__)
DAILY_CHECK_SECONDS = 3600


def _daily_backup_loop(state: AppState, stop: threading.Event) -> None:
    while not stop.wait(DAILY_CHECK_SECONDS):
        if state.mode != Mode.READY:
            continue
        try:
            BackupService(state.settings.paths).ensure_daily()
        except Exception:
            log.exception("daily backup failed; will retry")


def create_app(settings: Settings | None = None) -> FastAPI:
    state = AppState(settings or Settings.from_env())

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        run_startup(state)
        stop = threading.Event()
        if state.settings.background_jobs:
            threading.Thread(target=_daily_backup_loop, args=(state, stop), daemon=True,
                             name="daily-backup").start()
        yield
        stop.set()
        state.close_database()

    app = FastAPI(title="Financial Visualization Tool", version=__version__, lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)
    app.state.fvt = state

    # Order matters: CORS is outermost so preflight answers never need the app key.
    app.add_middleware(AppKeyMiddleware, key=state.settings.app_key)
    if state.settings.allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(state.settings.allowed_origins),
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
            allow_headers=["Authorization", "Content-Type", "X-App-Key"],
            expose_headers=["Content-Disposition"],
        )

    app.include_router(auth_api.router)
    app.include_router(users_api.router)
    app.include_router(audit_api.router)
    app.include_router(backups_api.router)
    app.include_router(backups_api.recovery_router)
    app.include_router(master_api.router)
    app.include_router(imports_api.router)
    app.include_router(reports_api.router)

    @app.get("/api/health")
    def health(request: Request) -> dict:
        s: AppState = request.app.state.fvt
        body = {"status": "ok", "mode": s.mode.value, "version": __version__}
        if s.mode == Mode.RECOVERY:
            body["recovery"] = {"code": s.recovery_code, "message": s.problems[0] if s.problems else ""}
        return body

    @app.post("/api/system/shutdown", status_code=202)
    def shutdown_sidecar(request: Request) -> dict:
        """Graceful stop requested by Electron on quit. The desktop proxy never forwards this path."""
        stop = getattr(request.app.state, "request_shutdown", None)
        if stop is not None:
            stop()
        return {"status": "stopping"}

    return app
