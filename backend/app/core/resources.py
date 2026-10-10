"""Locate bundled read-only resources (Alembic scripts) in dev and in the PyInstaller build."""

from __future__ import annotations

import sys
from pathlib import Path


def backend_root() -> Path:
    frozen_root = getattr(sys, "_MEIPASS", None)
    if frozen_root:
        return Path(frozen_root)
    return Path(__file__).resolve().parents[2]


def migrations_dir() -> Path:
    return backend_root() / "migrations"
