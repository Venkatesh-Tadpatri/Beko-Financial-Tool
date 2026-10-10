"""Alembic helpers. The safe copy-migrate-swap procedure is built on these in the startup service."""

from __future__ import annotations

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Engine

from app.core.resources import migrations_dir


def alembic_config() -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(migrations_dir()))
    return cfg


def head_revision() -> str:
    head = ScriptDirectory.from_config(alembic_config()).get_current_head()
    assert head is not None
    return head


def current_revision(engine: Engine) -> str | None:
    with engine.connect() as conn:
        rev = MigrationContext.configure(conn).get_current_revision()
        conn.rollback()
    return rev


def upgrade_to_head(engine: Engine) -> None:
    """Apply all pending migrations in ONE transaction: all succeed or none do."""
    cfg = alembic_config()
    with engine.connect() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "head")
        conn.commit()
