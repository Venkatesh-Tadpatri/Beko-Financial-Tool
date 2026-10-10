"""Restore orchestration shared by the backup screen and recovery mode.

After a successful restore the backend stays in RESTARTING mode (all data
routes refuse) and Electron relaunches the whole application, so no code path
keeps using objects loaded from the replaced database.
"""

from __future__ import annotations

import logging
import sqlite3
from pathlib import Path

from app.core.db import make_engine, make_session_factory, transaction
from app.core.security import verify_password
from app.services import audit
from app.services.backup import BackupService, preserve_damaged_database, replace_database_file
from app.state import AppState, Mode

log = logging.getLogger(__name__)


def restore(state: AppState, backup_file: Path) -> dict:
    paths = state.settings.paths
    backups = BackupService(paths)
    result: dict = {"restored_from": backup_file.name}

    if state.mode == Mode.READY:
        result["pre_restore_backup"] = backups.create("pre_restore").filename
    else:
        # The current file is unreadable; keep a raw copy for investigation instead.
        result["damaged_copy"] = str(preserve_damaged_database(paths))

    previous_mode = state.mode
    state.mode = Mode.RESTARTING
    state.close_database()
    try:
        replace_database_file(paths.db_file, backup_file)
    except Exception:
        log.exception("restore failed; the previous database is still in place")
        state.mode = previous_mode
        if previous_mode == Mode.READY:
            state.engine = make_engine(paths.db_file)
            state.session_factory = make_session_factory(state.engine)
        raise
    log.warning("database restored from %s; restart required", backup_file.name)
    result["restart_required"] = True
    return result


def record_restore_in_restored_db(state: AppState, username: str, source: str, result: dict) -> None:
    """The restored database must carry its own record of the restore."""
    engine = make_engine(state.settings.paths.db_file)
    try:
        with transaction(make_session_factory(engine)) as s:
            audit.record(s, "restore", username=username, entity_type="backup", entity_id=source[:64],
                         details={k: v for k, v in result.items() if k != "restart_required"})
    finally:
        engine.dispose()


def super_admin_in_backup(backup_file: Path, username: str, password: str) -> bool:
    """Check credentials against the users table INSIDE the backup (used when the live DB is unreadable)."""
    try:
        conn = sqlite3.connect(f"{backup_file.resolve().as_uri()}?mode=ro", uri=True)
        try:
            row = conn.execute(
                "SELECT password_hash FROM users WHERE username = ? COLLATE NOCASE "
                "AND role = 'super_admin' AND is_active = 1",
                (username.strip(),),
            ).fetchone()
        finally:
            conn.close()
    except sqlite3.DatabaseError:
        return False
    return verify_password(row[0] if row else None, password)
