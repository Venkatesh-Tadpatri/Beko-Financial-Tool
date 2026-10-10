from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.core.appkey import AppKeyMiddleware
from app.core.config import Settings
from app.core.db import make_engine, make_session_factory
from app.services.migrations import upgrade_to_head
from app.state import AppState, Mode


def startup(state: AppState) -> None:
    paths = state.settings.paths
    paths.ensure()
    state.engine = make_engine(paths.db_file)
    state.session_factory = make_session_factory(state.engine)
    upgrade_to_head(state.engine)
    state.mode = Mode.READY


def shutdown(state: AppState) -> None:
    if state.engine is not None:
        state.engine.dispose()


def create_app(settings: Settings | None = None) -> FastAPI:
    state = AppState(settings or Settings.from_env())

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        startup(state)
        yield
        shutdown(state)

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

    @app.get("/api/health")
    def health(request: Request) -> dict:
        s: AppState = request.app.state.fvt
        return {"status": "ok", "mode": s.mode.value, "version": __version__}

    return app
