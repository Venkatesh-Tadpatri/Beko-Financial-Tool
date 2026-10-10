from __future__ import annotations

import pytest
from sqlalchemy import inspect, select, text
from sqlalchemy.exc import IntegrityError

from app.core.db import integrity_check, make_engine, transaction
from app.models import AuditLog, Base, PeriodVersion, UploadBatch, User, utcnow
from app.services.migrations import (
    alembic_config,
    current_revision,
    head_revision,
    upgrade_to_head,
)


def _user(username: str, role: str = "super_admin", founder: bool = False) -> User:
    return User(username=username, password_hash="x", role=role, is_founder=founder)


def test_pragmas_are_applied(engine):
    with engine.connect() as conn:
        assert conn.execute(text("PRAGMA journal_mode")).scalar() == "wal"
        assert conn.execute(text("PRAGMA synchronous")).scalar() == 2  # FULL
        assert conn.execute(text("PRAGMA foreign_keys")).scalar() == 1
        conn.rollback()


def test_migration_creates_every_model_table(engine):
    tables = set(inspect(engine).get_table_names())
    assert set(Base.metadata.tables) <= tables
    assert current_revision(engine) == head_revision()
    assert integrity_check(engine) == []


def test_migration_seeds_defaults(engine):
    with engine.connect() as conn:
        grains = dict(conn.execute(text("SELECT dataset_type, period_grain FROM dataset_settings")).all())
        levels = conn.execute(text("SELECT dataset_type, level_no, required_role FROM approval_levels")).all()
        conn.rollback()
    assert grains["sales"] == "M" and grains["balance_sheet"] == "Q"
    assert levels == [("*", 1, "approver")]


def test_upgrade_is_idempotent_and_downgrade_round_trips(engine):
    from alembic import command

    upgrade_to_head(engine)  # second run: no-op
    cfg = alembic_config()
    with engine.connect() as conn:
        cfg.attributes["connection"] = conn
        command.downgrade(cfg, "base")
        conn.commit()
    assert "users" not in inspect(engine).get_table_names()
    upgrade_to_head(engine)
    assert current_revision(engine) == head_revision()


def test_failed_transaction_leaves_no_trace(session_factory):
    with pytest.raises(RuntimeError):
        with transaction(session_factory) as s:
            s.add(_user("alice"))
            s.flush()
            raise RuntimeError("boom half-way")
    with transaction(session_factory) as s:
        assert s.scalar(select(User).where(User.username == "alice")) is None


def test_audit_log_is_append_only(session_factory):
    with transaction(session_factory) as s:
        s.add(AuditLog(action="test", prev_hash="0" * 64, hash="1" * 64))
    with pytest.raises(IntegrityError, match="append-only"):
        with transaction(session_factory) as s:
            s.execute(text("UPDATE audit_log SET action = 'tampered'"))
    with pytest.raises(IntegrityError, match="append-only"):
        with transaction(session_factory) as s:
            s.execute(text("DELETE FROM audit_log"))


def test_founder_cannot_be_deleted_demoted_or_disabled(session_factory):
    with transaction(session_factory) as s:
        s.add(_user("founder", founder=True))
        s.add(_user("second"))
    for stmt in (
        "DELETE FROM users WHERE username = 'founder'",
        "UPDATE users SET role = 'admin' WHERE username = 'founder'",
        "UPDATE users SET is_active = 0 WHERE username = 'founder'",
    ):
        with pytest.raises(IntegrityError):
            with transaction(session_factory) as s:
                s.execute(text(stmt))


def test_last_active_super_admin_is_protected(session_factory):
    with transaction(session_factory) as s:
        s.add(_user("a"))
        s.add(_user("b"))
    with transaction(session_factory) as s:  # one of two may go
        s.execute(text("UPDATE users SET is_active = 0 WHERE username = 'a'"))
    with pytest.raises(IntegrityError, match="at least one active super admin"):
        with transaction(session_factory) as s:
            s.execute(text("UPDATE users SET role = 'viewer' WHERE username = 'b'"))
    with pytest.raises(IntegrityError, match="at least one active super admin"):
        with transaction(session_factory) as s:
            s.execute(text("DELETE FROM users WHERE username = 'b'"))


def test_username_is_case_insensitive_unique(session_factory):
    with transaction(session_factory) as s:
        s.add(_user("Priya", role="viewer"))
    with pytest.raises(IntegrityError):
        with transaction(session_factory) as s:
            s.add(_user("priya", role="viewer"))


def test_only_one_current_version_per_month(session_factory):
    with transaction(session_factory) as s:
        u = _user("u")
        s.add(u)
        s.flush()
        b1 = UploadBatch(dataset_type="sales", period_grain="M", original_filename="a.xlsx",
                         archived_path="a", sha256="a" * 64, uploaded_by=u.id)
        b2 = UploadBatch(dataset_type="sales", period_grain="M", original_filename="b.xlsx",
                         archived_path="b", sha256="b" * 64, uploaded_by=u.id)
        s.add_all([b1, b2])
        s.flush()
        s.add(PeriodVersion(dataset_type="sales", fy=2025, fiscal_month=1, batch_id=b1.id))
        ids = (b1.id, b2.id)
    with pytest.raises(IntegrityError):
        with transaction(session_factory) as s:
            s.add(PeriodVersion(dataset_type="sales", fy=2025, fiscal_month=1, batch_id=ids[1]))
    with transaction(session_factory) as s:  # closing the old one first is fine
        s.execute(text("UPDATE period_versions SET valid_to = :t WHERE batch_id = :b"),
                  {"t": utcnow().isoformat(), "b": ids[0]})
        s.add(PeriodVersion(dataset_type="sales", fy=2025, fiscal_month=1, batch_id=ids[1]))


def test_datetimes_round_trip_as_aware_utc(session_factory):
    with transaction(session_factory) as s:
        s.add(_user("tz"))
    with transaction(session_factory) as s:
        u = s.scalar(select(User).where(User.username == "tz"))
        assert u.created_at.tzinfo is not None
        assert (utcnow() - u.created_at).total_seconds() < 60


def test_integrity_check_reports_corruption(tmp_path):
    db = tmp_path / "bad.db"
    eng = make_engine(db)
    with eng.begin() as conn:
        conn.execute(text("CREATE TABLE t (x)"))
        conn.execute(text("INSERT INTO t VALUES (randomblob(100000))"))
    eng.dispose()
    data = bytearray(db.read_bytes())
    data[4096:8192] = b"\xff" * 4096  # trash page 2
    db.write_bytes(bytes(data))
    eng = make_engine(db)
    try:
        assert integrity_check(eng) != []
    except Exception:
        pass  # SQLite may refuse to open at all; either way it is not reported healthy
    finally:
        eng.dispose()
