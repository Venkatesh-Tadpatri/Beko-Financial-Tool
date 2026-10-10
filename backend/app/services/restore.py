"""Restore orchestration shared by the backup screen and recovery mode.

After a successful restore the backend stays in RESTARTING mode (all data
routes refuse) and Electron relaunches the whole application, so no code path
keeps using objects loaded from the replaced database.
"""

from __future__ import annotations

import logging
from pathlib import Path

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
        raise
    log.warning("database restored from %s; restart required", backup_file.name)
    result["restart_required"] = True
    return result
