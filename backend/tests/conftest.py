from __future__ import annotations

import secrets
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import DataPaths, Settings
from app.core.db import make_engine, make_session_factory
from app.main import create_app
from app.services.migrations import upgrade_to_head


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(paths=DataPaths(tmp_path / "FinancialVisualizationTool"), app_key=secrets.token_urlsafe(32))


@pytest.fixture
def paths(settings: Settings) -> DataPaths:
    settings.paths.ensure()
    return settings.paths


@pytest.fixture
def engine(settings: Settings):
    settings.paths.ensure()
    eng = make_engine(settings.paths.db_file)
    upgrade_to_head(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def session_factory(engine):
    return make_session_factory(engine)


@pytest.fixture
def client(settings: Settings):
    app = create_app(settings)
    with TestClient(app, headers={"X-App-Key": settings.app_key}) as c:
        yield c
