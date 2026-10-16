"""Startup sequence: integrity check, safe migration, daily backup.

Nothing here ever overwrites app.db with anything other than a verified,
fully migrated copy of itself. Any failure leaves the original file untouched
and puts the backend in RECOVERY mode with a user-facing message.
"""

from __future__ import annotations

import logging
import os
import sqlite3
from pathlib import Path

from alembic.script import ScriptDirectory
from sqlalchemy import select

from app.core.db import integrity_check, make_engine, make_session_factory
from app.services import local_config, migrations
from app.services.backup import BackupService, _checkpoint_and_close, sqlite_copy
from app.services.bootstrap import ensure_default_admin
from app.models import UploadBatch, User
from app.services import audit, workflow
from app.services.permissions import restrict_to_current_user
from app.state import AppState, Mode

log = logging.getLogger(__name__)

MSG_CORRUPT = (
    "The database failed its integrity check and has not been opened. "
    "No data has been changed. Restore the latest good backup to continue."
)
MSG_MIGRATION = (
    "The update could not be applied to your database. Your data has not been changed. "
    "Reinstall the previous version, or restore a backup, and contact support."
)
MSG_NEWER = (
    "This database was created by a newer version of the application. "
    "Install the newer version to open it. No data has been changed."
)


def _publish_legacy_pending(state: AppState) -> None:
    """Publish valid uploads left waiting by the retired approval workflow."""
    if state.session_factory is None:
        return
    with state.session_factory() as db:
        pending_ids = list(db.scalars(select(UploadBatch.id).where(UploadBatch.status == "submitted")))
    for batch_id in pending_ids:
        try:
            with state.session_factory.begin() as db:
                batch = db.get(UploadBatch, batch_id)
                if batch is None or batch.status != "submitted":
                    continue
                workflow.submit(db, batch)
                uploader = db.get(User, batch.uploaded_by)
                audit.record(db, "upload_published", user=uploader, entity_type="batch", entity_id=batch.id,
                             details={"rows": batch.row_count, "dataset": batch.dataset_type,
                                      "automatic": True, "legacy_pending": True})
        except Exception:
            # Keep an invalid old upload available for correction; it must not
            # prevent the application from starting.
            log.exception("could not publish legacy pending upload %s", batch_id)


class StartupError(RuntimeError):
    def __init__(self, code: str, message: str, details: list[str] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.details = details or []


def raw_integrity_check(db_file: Path) -> list[str]:
    """Check without the app's engine (which would switch journal modes on open)."""
    try:
        conn = sqlite3.connect(str(db_file), timeout=30)
        try:
            rows = [r[0] for r in conn.execute("PRAGMA integrity_check").fetchall()]
        finally:
            conn.close()
    except sqlite3.DatabaseError as exc:
        return [f"not a readable database: {exc}"]
    return [] if rows == ["ok"] else rows


def _revision_of(db_file: Path) -> str | None:
    conn = sqlite3.connect(str(db_file), timeout=30)
    try:
        return conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]
    except sqlite3.OperationalError:
        return None
    finally:
        conn.close()


def _has_user_tables(db_file: Path) -> bool:
    conn = sqlite3.connect(str(db_file), timeout=30)
    try:
        return conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        ).fetchone()[0] > 0
    finally:
        conn.close()


def _known_revisions() -> set[str]:
    script = ScriptDirectory.from_config(migrations.alembic_config())
    return {rev.revision for rev in script.walk_revisions()}


def migrate_safely(db_file: Path, backups: BackupService) -> bool:
    """Bring db_file to head via copy-migrate-verify-swap. Returns True if a migration ran."""
    current = _revision_of(db_file)
    head = migrations.head_revision()
    if current == head:
        return False
    if current is not None and current not in _known_revisions():
        raise StartupError("newer_database", MSG_NEWER, [f"database revision {current}"])

    backups.create("pre_migration")

    work = db_file.with_name(db_file.name + ".migrating")
    for suffix in ("", "-wal", "-shm", "-journal"):
        Path(str(work) + suffix).unlink(missing_ok=True)
    try:
        sqlite_copy(db_file, work)
        engine = make_engine(work)
        try:
            migrations.upgrade_to_head(engine)
            problems = integrity_check(engine)
            with engine.connect() as conn:
                fk = conn.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
                conn.rollback()
            if fk:
                problems.append(f"{len(fk)} broken foreign-key reference(s) after migration")
            if problems:
                raise StartupError("migration_failed", MSG_MIGRATION, problems)
        finally:
            engine.dispose()
        _checkpoint_and_close(work)  # leave the copy self-contained before swapping it in

        # Swap: empty the original's WAL first so a stale WAL can never be replayed onto the new file.
        _checkpoint_and_close(db_file)
        os.replace(work, db_file)
        for suffix in ("-wal", "-shm"):
            Path(str(db_file) + suffix).unlink(missing_ok=True)
        log.info("database migrated %s -> %s", current, head)
        return True
    except StartupError:
        raise
    except Exception as exc:
        log.exception("migration failed")
        raise StartupError("migration_failed", MSG_MIGRATION, [str(exc)]) from exc
    finally:
        for suffix in ("", "-wal", "-shm", "-journal"):
            Path(str(work) + suffix).unlink(missing_ok=True)


def run_startup(state: AppState) -> None:
    paths = state.settings.paths
    paths.ensure()
    if state.settings.apply_permissions:
        cfg = local_config.load(paths.config_file)
        if not cfg.permissions_applied:
            try:
                restrict_to_current_user(paths.root)
                cfg.permissions_applied = True
                local_config.save(paths.config_file, cfg)
            except Exception:  # never block startup; retried next launch
                log.exception("could not restrict data folder permissions")
    backups = BackupService(paths)
    db_file = paths.db_file
    state.problems = []
    state.recovery_code = None

    try:
        if db_file.exists():
            problems = raw_integrity_check(db_file)
            if problems:
                raise StartupError("integrity_failed", MSG_CORRUPT, problems[:20])
        if db_file.exists() and _has_user_tables(db_file):
            migrate_safely(db_file, backups)
        else:
            engine = make_engine(db_file)  # brand-new install: nothing to protect yet
            try:
                migrations.upgrade_to_head(engine)
            finally:
                engine.dispose()
    except StartupError as exc:
        log.error("startup stopped: %s %s", exc.code, exc.details)
        state.mode = Mode.RECOVERY
        state.recovery_code = exc.code
        state.problems = [str(exc), *exc.details]
        return

    state.engine = make_engine(db_file)
    state.session_factory = make_session_factory(state.engine)
    if state.settings.bootstrap_admin:
        ensure_default_admin(state.session_factory)
    _publish_legacy_pending(state)
    state.mode = Mode.READY

    try:
        backups.ensure_daily()
    except Exception:  # a failed daily backup must not stop the app; it is retried hourly
        log.exception("daily backup failed")
