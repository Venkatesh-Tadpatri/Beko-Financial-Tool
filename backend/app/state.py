"""Process-wide application state, created once at startup and stored on app.state."""

from __future__ import annotations

import enum
from dataclasses import dataclass, field

from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings


class Mode(str, enum.Enum):
    STARTING = "starting"
    READY = "ready"
    RECOVERY = "recovery"  # integrity check or migration failed; only recovery routes work
    RESTARTING = "restarting"  # a restore is in progress; Electron will relaunch us


@dataclass
class AppState:
    settings: Settings
    mode: Mode = Mode.STARTING
    engine: Engine | None = None
    session_factory: sessionmaker[Session] | None = None
    problems: list[str] = field(default_factory=list)
    recovery_code: str | None = None  # integrity_failed | migration_failed | newer_database

    def close_database(self) -> None:
        if self.engine is not None:
            self.engine.dispose()
        self.engine = None
        self.session_factory = None
