from __future__ import annotations

from pathlib import Path

from alembic import context

from app.core.db import make_engine
from app.models import Base
from app.models.base import UTCDateTime

config = context.config
target_metadata = Base.metadata


def _render_item(type_, obj, autogen_context):
    # Keep migration files free of app imports: UTCDateTime is plain text on disk.
    if type_ == "type" and isinstance(obj, UTCDateTime):
        return "sa.String(length=32)"
    return False


def _configure(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=True,  # SQLite ALTER TABLE support
        render_item=_render_item,
        compare_type=True,
        transaction_per_migration=False,  # all pending migrations commit together or not at all
    )


def run_migrations_online() -> None:
    connection = config.attributes.get("connection")
    if connection is not None:
        _configure(connection)
        with context.begin_transaction():
            context.run_migrations()
        return

    db = context.get_x_argument(as_dictionary=True).get("db")
    if not db:
        raise SystemExit("Pass the database file: alembic -x db=path\\to\\app.db upgrade head")
    engine = make_engine(Path(db))
    try:
        with engine.connect() as conn:
            _configure(conn)
            with context.begin_transaction():
                context.run_migrations()
    finally:
        engine.dispose()


if context.is_offline_mode():
    raise SystemExit("Offline migrations are not supported")
run_migrations_online()
