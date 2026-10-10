"""Single source of 'now' for security decisions, so tests can move time forward."""

from __future__ import annotations

from datetime import datetime

from app.models.base import utcnow


def now() -> datetime:
    return utcnow()
