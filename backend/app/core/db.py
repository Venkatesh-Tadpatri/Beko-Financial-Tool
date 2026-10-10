"""SQLite engine with the durability settings the app depends on.

* WAL journal + synchronous=FULL: a committed transaction survives a power cut.
* Every transaction starts with BEGIN IMMEDIATE, so a multi-step change takes
  the write lock up front and can never fail half-way on lock upgrade.
* Python's sqlite3 implicit transaction handling is disabled; SQLAlchemy's
  begin/commit/rollback are the only transaction boundaries.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import Engine, create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker

BUSY_TIMEOUT_MS = 15_000


def _apply_pragmas(dbapi_conn, _record) -> None:
    dbapi_conn.isolation_level = None  # let SQLAlchemy own transactions
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=FULL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
    cur.close()


def _begin_immediate(conn) -> None:
    conn.exec_driver_sql("BEGIN IMMEDIATE")


def make_engine(db_file: Path) -> Engine:
    engine = create_engine(
        f"sqlite:///{db_file.as_posix()}",
        connect_args={"check_same_thread": False, "timeout": BUSY_TIMEOUT_MS / 1000},
    )
    event.listen(engine, "connect", _apply_pragmas)
    event.listen(engine, "begin", _begin_immediate)
    return engine


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)


@contextmanager
def transaction(factory: sessionmaker[Session]) -> Iterator[Session]:
    """One unit of work: commits on success, rolls back on any exception."""
    session = factory()
    try:
        yield session
        session.commit()
    except BaseException:
        session.rollback()
        raise
    finally:
        session.close()


def integrity_check(engine: Engine) -> list[str]:
    """Return [] when the database is healthy, otherwise SQLite's problem list."""
    with engine.connect() as conn:
        rows = [r[0] for r in conn.execute(text("PRAGMA integrity_check")).fetchall()]
        conn.rollback()
    return [] if rows == ["ok"] else rows
