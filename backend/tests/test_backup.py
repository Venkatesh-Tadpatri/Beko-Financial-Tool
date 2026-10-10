from __future__ import annotations

import json
import sqlite3
import threading
from datetime import timedelta

import pytest

from app.core.db import transaction
from app.models import SalesFact
from app.services import backup as backup_mod
from app.services import local_config
from app.services.backup import BackupError, BackupService, check_database_file, read_manifest
from app.services.migrations import head_revision as migrations_head
from tests.helpers import make_user_and_batch, sales_total


@pytest.fixture
def svc(paths, engine, session_factory):
    make_user_and_batch(session_factory, rows=50)
    return BackupService(paths)


def test_backup_is_verified_self_contained_and_indexed(svc, paths):
    e = svc.create("manual")
    f = paths.default_backup_dir / e.filename
    assert f.is_file() and not (paths.default_backup_dir / (e.filename + "-wal")).exists()
    assert e.verify_ok and e.schema_version == migrations_head()
    assert backup_mod.sha256_file(f) == e.sha256
    conn = sqlite3.connect(str(f))
    assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "delete"
    conn.close()
    assert sales_total(f) == sales_total(paths.db_file)
    assert [x.filename for x in read_manifest(paths.default_backup_dir)] == [e.filename]


def test_backup_is_consistent_while_the_app_is_writing(svc, session_factory, paths):
    stop = threading.Event()

    def writer():
        while not stop.is_set():
            with transaction(session_factory) as s:
                s.add_all(SalesFact(batch_id=1, fy=2025, period_grain="M", period_no=1, customer_code="W",
                                    material_code="W", amount_paise=1) for _ in range(50))

    t = threading.Thread(target=writer)
    t.start()
    try:
        entries = [svc.create("manual") for _ in range(5)]
    finally:
        stop.set()
        t.join()
    for e in entries:
        assert check_database_file(paths.default_backup_dir / e.filename).ok


def test_failed_backup_leaves_nothing_behind(svc, paths, monkeypatch):
    monkeypatch.setattr(backup_mod, "check_database_file",
                        lambda p: backup_mod.VerifyResult(False, ["simulated"]))
    with pytest.raises(BackupError):
        svc.create("manual")
    assert list(paths.default_backup_dir.glob("app-*")) == []
    assert read_manifest(paths.default_backup_dir) == []


def test_secondary_location_receives_copy_and_manifest(svc, tmp_path):
    second = tmp_path / "onedrive" / "fvt-backups"
    svc.update_config(secondary_backup_dir=str(second))
    e = svc.create("upload")
    assert e.secondary_copied and e.secondary_error is None
    assert (second / e.filename).is_file()
    assert [x.sha256 for x in read_manifest(second)] == [e.sha256]


def test_secondary_failure_does_not_block_primary(svc, tmp_path, paths):
    second = tmp_path / "second"
    svc.update_config(secondary_backup_dir=str(second))
    second.rmdir() if second.is_dir() else None
    second.write_text("not a folder")  # copying into it will fail
    e = svc.create("upload")
    assert (paths.default_backup_dir / e.filename).is_file()
    assert not e.secondary_copied and e.secondary_error


def test_retention_per_reason(svc, monkeypatch):
    monkeypatch.setattr(backup_mod, "RETENTION", {"daily": 3, "event": 2, "pre_migration": 1, "pre_restore": 1})
    made = {r: [svc.create(r).filename for _ in range(4)] for r in ("daily", "upload", "pre_migration")}
    made["manual"] = [svc.create("manual").filename]  # manual shares the event bucket with upload
    names = {e.filename for e in svc.list()}
    assert set(made["daily"][-3:]) <= names and made["daily"][0] not in names
    assert made["manual"][0] in names and made["upload"][-1] in names
    assert sum(1 for n in names if n.endswith(("-upload.db", "-manual.db"))) == 2
    assert {n for n in names if n.endswith("pre_migration.db")} == {made["pre_migration"][-1]}


def test_size_cap_prunes_oldest_but_keeps_newest_verified(svc, monkeypatch, paths):
    monkeypatch.setattr(local_config, "MIN_MAX_TOTAL_BYTES", 0)
    first = svc.create("daily")
    svc.update_config(max_total_backup_bytes=int(first.size_bytes * 2.5))
    made = [svc.create("upload").filename for _ in range(4)]
    names = [e.filename for e in svc.list()]
    assert names == list(reversed(made[-2:]))
    svc.update_config(max_total_backup_bytes=1)  # smaller than any single backup
    assert [e.filename for e in svc.list()] == [made[-1]]  # newest verified is never deleted
    assert sorted(p.name for p in paths.default_backup_dir.glob("app-*.db")) == [made[-1]]


def test_lowering_the_cap_prunes_immediately(svc, monkeypatch):
    monkeypatch.setattr(local_config, "MIN_MAX_TOTAL_BYTES", 0)
    for _ in range(3):
        svc.create("upload")
    svc.update_config(max_total_backup_bytes=1)
    assert len(svc.list()) == 1


def test_cap_must_be_sane(svc):
    with pytest.raises(ValueError):
        svc.update_config(max_total_backup_bytes=10)


def test_verify_detects_tampering(svc, paths):
    e = svc.create("manual")
    f = paths.default_backup_dir / e.filename
    assert svc.verify(e.filename).ok
    conn = sqlite3.connect(str(f))
    conn.execute("UPDATE sales_facts SET amount_paise = 1")
    conn.commit()
    conn.close()
    result = svc.verify(e.filename)
    assert not result.ok and "changed" in result.problems[0]
    assert svc.get(e.filename).verify_ok is False


def test_damaged_manifest_is_rebuilt_from_files(svc, paths):
    e = svc.create("manual")
    (paths.default_backup_dir / "manifest.json").write_text("{ broken")
    entries = svc.list()
    assert [x.filename for x in entries] == [e.filename] and entries[0].sha256 == e.sha256


def test_get_rejects_path_tricks(svc):
    for bad in ("../app.db", "..\\..\\x.db", "manifest.json", "app-x.db"):
        with pytest.raises(BackupError):
            svc.get(bad)


def test_daily_backup_once_per_day(svc, monkeypatch):
    assert svc.ensure_daily() is not None
    assert svc.ensure_daily() is None
    # pretend the existing daily backup is from yesterday
    d = svc.primary_dir()
    data = json.loads((d / "manifest.json").read_text())
    for b in data["backups"]:
        from datetime import datetime
        b["created_at"] = (datetime.fromisoformat(b["created_at"]) - timedelta(days=1)).isoformat()
    (d / "manifest.json").write_text(json.dumps(data))
    assert svc.ensure_daily() is not None


def test_usage_reports_space(svc):
    svc.create("manual")
    u = svc.usage()
    assert u["count"] == 1 and u["used_bytes"] > 0
    assert u["disk_free_bytes"] > 0 and u["max_total_bytes"] == local_config.DEFAULT_MAX_TOTAL_BYTES


def test_backup_location_can_be_changed(svc, tmp_path):
    new_dir = tmp_path / "elsewhere"
    svc.update_config(backup_dir=str(new_dir))
    e = svc.create("manual")
    assert (new_dir / e.filename).is_file()
