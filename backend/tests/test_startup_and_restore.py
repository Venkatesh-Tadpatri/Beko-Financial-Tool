from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path

import pytest

from app.core.config import Settings
from app.core.db import make_engine, make_session_factory
from app.services import migrations as migrations_mod
from app.services.backup import BackupError, BackupService, check_database_file
from app.services.migrations import upgrade_to_head
from app.services.restore import restore
from app.services.startup import run_startup
from app.state import AppState, Mode
from tests.helpers import make_user_and_batch, sales_total, table_counts

REAL_MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "backups"


def _start(settings: Settings) -> AppState:
    state = AppState(settings)
    run_startup(state)
    return state


def _seed_db(settings: Settings, rows: int = 20, amount: int = 100) -> None:
    settings.paths.ensure()
    eng = make_engine(settings.paths.db_file)
    upgrade_to_head(eng)
    make_user_and_batch(make_session_factory(eng), rows=rows, amount_paise=amount)
    eng.dispose()


def _corrupt(db: Path) -> None:
    data = bytearray(db.read_bytes())
    for page_start in range(4096, len(data), 4096 * 3):
        data[page_start:page_start + 4096] = b"\x5a" * 4096
    db.write_bytes(bytes(data))


REAL_HEAD = migrations_mod.head_revision()
TEST_REV = "test9001"


def _migrations_with(tmp_path: Path, body: str) -> Path:
    """Copy of the real migrations plus a test revision on top of the real head."""
    d = tmp_path / "migrations"
    shutil.copytree(REAL_MIGRATIONS, d, ignore=shutil.ignore_patterns("__pycache__"))
    (d / "versions" / f"{TEST_REV}_test.py").write_text(
        "import sqlalchemy as sa\nfrom alembic import op\n"
        f"revision = '{TEST_REV}'\ndown_revision = '{REAL_HEAD}'\nbranch_labels = None\ndepends_on = None\n"
        f"def upgrade():\n{body}\ndef downgrade():\n    pass\n"
    )
    return d


# ------------------------------------------------------------------ startup


def test_fresh_install_starts_ready_with_daily_backup(settings):
    state = _start(settings)
    assert state.mode == Mode.READY
    assert [e.reason for e in BackupService(settings.paths).list()] == ["daily"]
    state.close_database()


def test_restart_without_pending_migration_takes_no_premigration_backup(settings):
    _start(settings).close_database()
    _start(settings).close_database()
    reasons = [e.reason for e in BackupService(settings.paths).list()]
    assert "pre_migration" not in reasons and reasons.count("daily") == 1


def test_empty_db_file_from_crashed_first_run_is_treated_as_new(settings):
    settings.paths.ensure()
    settings.paths.db_file.write_bytes(b"")
    state = _start(settings)
    assert state.mode == Mode.READY
    state.close_database()


def test_corrupt_database_stops_in_recovery_and_is_not_touched(settings):
    _seed_db(settings, rows=3000)
    db = settings.paths.db_file
    _corrupt(db)
    before = db.read_bytes()
    state = _start(settings)
    assert state.mode == Mode.RECOVERY and state.recovery_code == "integrity_failed"
    assert "integrity check" in state.problems[0]
    assert state.engine is None
    assert db.read_bytes() == before


def test_database_from_newer_version_is_refused(settings):
    _seed_db(settings)
    conn = sqlite3.connect(str(settings.paths.db_file))
    conn.execute("UPDATE alembic_version SET version_num = '9999'")
    conn.commit()
    conn.close()
    state = _start(settings)
    assert state.mode == Mode.RECOVERY and state.recovery_code == "newer_database"
    assert table_counts(settings.paths.db_file)["sales_facts"] == 20


def test_pending_migration_backs_up_then_migrates_copy_and_keeps_data(settings, tmp_path, monkeypatch):
    _seed_db(settings, rows=25, amount=777)
    before = table_counts(settings.paths.db_file)
    mdir = _migrations_with(tmp_path, "    op.add_column('oems', sa.Column('country', sa.String(64)))")
    monkeypatch.setattr(migrations_mod, "migrations_dir", lambda: mdir)
    state = _start(settings)
    assert state.mode == Mode.READY
    state.close_database()

    after = table_counts(settings.paths.db_file)
    assert {k: v for k, v in after.items() if k in before} == before
    assert sales_total(settings.paths.db_file) == 25 * 777
    conn = sqlite3.connect(str(settings.paths.db_file))
    assert "country" in [r[1] for r in conn.execute("PRAGMA table_info(oems)")]
    assert conn.execute("SELECT version_num FROM alembic_version").fetchone()[0] == TEST_REV
    conn.close()

    pre = [e for e in BackupService(settings.paths).list() if e.reason == "pre_migration"]
    assert len(pre) == 1 and pre[0].schema_version == REAL_HEAD
    assert not list(settings.paths.data_dir.glob("*.migrating*"))


def test_failed_migration_rolls_back_and_leaves_previous_database(settings, tmp_path, monkeypatch):
    _seed_db(settings, rows=25, amount=777)
    before = table_counts(settings.paths.db_file)
    mdir = _migrations_with(tmp_path, "    op.create_table('half_done', sa.Column('id', sa.Integer, primary_key=True))\n"
                                      "    op.execute('THIS IS NOT SQL')")
    monkeypatch.setattr(migrations_mod, "migrations_dir", lambda: mdir)
    state = _start(settings)
    assert state.mode == Mode.RECOVERY and state.recovery_code == "migration_failed"
    assert "has not been changed" in state.problems[0]
    db = settings.paths.db_file
    assert table_counts(db) == before  # no 'half_done' table, nothing lost
    assert check_database_file(db).schema_version == REAL_HEAD
    assert not list(settings.paths.data_dir.glob("*.migrating*"))


@pytest.mark.parametrize("fixture", sorted(FIXTURES.glob("*.db")), ids=lambda p: p.name)
def test_migrations_against_saved_backups(fixture, settings):
    """Release gate: every migration must apply cleanly to copies of real backups.

    Drop customer backup copies into tests/fixtures/backups/ before a release
    (they are git-ignored only if you choose; see docs/backup-restore-guide.md).
    """
    settings.paths.ensure()
    shutil.copyfile(fixture, settings.paths.db_file)
    before = table_counts(settings.paths.db_file)
    state = _start(settings)
    assert state.mode == Mode.READY, state.problems
    state.close_database()
    after = table_counts(settings.paths.db_file)
    assert {k: v for k, v in after.items() if k in before and k != "alembic_version"} == \
           {k: v for k, v in before.items() if k != "alembic_version"}


# ------------------------------------------------------------------ restore


def test_restore_brings_back_exact_figures_and_saves_current_first(settings):
    _seed_db(settings, rows=10, amount=5000)
    state = _start(settings)
    svc = BackupService(settings.paths)
    good = svc.create("manual")
    make_user_and_batch(state.session_factory, rows=10, amount_paise=1)  # later change
    assert sales_total(settings.paths.db_file) == 10 * 5000 + 10

    result = restore(state, svc.primary_dir() / good.filename)
    assert state.mode == Mode.RESTARTING and state.engine is None and result["restart_required"]
    assert sales_total(settings.paths.db_file) == 10 * 5000
    pre = svc.get(result["pre_restore_backup"])
    assert sales_total(svc.primary_dir() / pre.filename) == 10 * 5000 + 10  # nothing lost

    again = _start(settings)  # what Electron's relaunch does
    assert again.mode == Mode.READY
    again.close_database()


def test_restore_refuses_bad_backup_and_keeps_current(settings, tmp_path):
    _seed_db(settings, rows=10, amount=5000)
    state = _start(settings)
    bad = tmp_path / "bad.db"
    bad.write_bytes(b"not a database" * 100)
    with pytest.raises(BackupError):
        restore(state, bad)
    assert state.mode == Mode.READY
    assert sales_total(settings.paths.db_file) == 10 * 5000
    state.close_database()


def test_recovery_restore_preserves_damaged_file_and_recovers(settings):
    _seed_db(settings, rows=3000, amount=3)
    svc = BackupService(settings.paths)
    good = svc.create("daily")
    _corrupt(settings.paths.db_file)
    state = _start(settings)
    assert state.mode == Mode.RECOVERY

    result = restore(state, svc.primary_dir() / good.filename)
    damaged = Path(result["damaged_copy"])
    assert (damaged / "app.db").is_file()
    assert sales_total(settings.paths.db_file) == 3000 * 3
    again = _start(settings)
    assert again.mode == Mode.READY
    again.close_database()


def test_restore_on_a_clean_machine_reproduces_figures(settings, tmp_path):
    """Backup copied to a new PC's data folder reproduces the same totals."""
    _seed_db(settings, rows=500, amount=123_456)
    svc = BackupService(settings.paths)
    entry = svc.create("manual")
    portable = tmp_path / "usb" / entry.filename
    portable.parent.mkdir()
    shutil.copyfile(svc.primary_dir() / entry.filename, portable)

    from app.core.config import DataPaths
    new_pc = Settings(paths=DataPaths(tmp_path / "newpc"), app_key="k" * 40)
    state = _start(new_pc)  # fresh install on the new PC
    restore(state, portable)
    assert sales_total(new_pc.paths.db_file) == sales_total(settings.paths.db_file) == 500 * 123_456
