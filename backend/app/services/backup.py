"""Backups: create, verify, list, prune, restore-in-place.

Design
------
* Copies are made with SQLite's online backup API, never a raw file copy, so a
  backup is consistent even while the app is writing (WAL mode).
* Each backup is integrity-checked and SHA-256 fingerprinted before it is
  renamed into place. A half-written backup is never visible.
* The index is ``manifest.json`` in each backup folder (primary and secondary),
  so backups can be listed and restored when the main database is unreadable,
  and a copied folder is self-describing on a new PC.
* Retention: last 30 daily, last 50 event (upload/approval/manual), last 10
  pre-migration and last 10 pre-restore; then a total-size cap. The newest
  verified backup is never deleted.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import sqlite3
import threading
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from app.core.config import DataPaths
from app.services import local_config
from app.services.local_config import LocalConfig, atomic_write_text

log = logging.getLogger(__name__)

REASONS = ("pre_migration", "pre_restore", "upload", "approval", "daily", "manual")
RETENTION = {"daily": 30, "event": 50, "pre_migration": 10, "pre_restore": 10}
_EVENT_REASONS = {"upload", "approval", "manual"}
MANIFEST = "manifest.json"
_NAME_RE = re.compile(r"^app-(\d{8}-\d{6}-\d{6})-([a-z_]+)\.db$")

_lock = threading.RLock()  # serialises manifest updates and pruning within the process


class BackupError(RuntimeError):
    pass


@dataclass
class BackupEntry:
    filename: str
    reason: str
    created_at: str  # ISO-8601 UTC
    size_bytes: int
    sha256: str
    schema_version: str | None = None
    verified_at: str | None = None
    verify_ok: bool | None = None
    secondary_copied: bool = False
    secondary_error: str | None = None

    @property
    def created(self) -> datetime:
        return datetime.fromisoformat(self.created_at)

    @property
    def retention_group(self) -> str:
        return "event" if self.reason in _EVENT_REASONS else self.reason


@dataclass
class VerifyResult:
    ok: bool
    problems: list[str] = field(default_factory=list)
    schema_version: str | None = None


# ---------------------------------------------------------------- low level


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _fsync_file(path: Path) -> None:
    with open(path, "rb+") as f:
        os.fsync(f.fileno())


def sqlite_copy(src: Path, dst: Path) -> None:
    """Consistent single-file copy of a live database via the online backup API."""
    src_conn = sqlite3.connect(str(src), timeout=30)
    try:
        dst_conn = sqlite3.connect(str(dst))
        try:
            src_conn.backup(dst_conn)
            dst_conn.execute("PRAGMA journal_mode=DELETE")  # self-contained file, no -wal
            dst_conn.commit()
        finally:
            dst_conn.close()
    finally:
        src_conn.close()
    _fsync_file(dst)


def check_database_file(path: Path) -> VerifyResult:
    """Integrity check + schema version of a standalone database file. Never modifies it."""
    if not path.is_file():
        return VerifyResult(False, ["file is missing"])
    try:
        conn = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
        try:
            rows = [r[0] for r in conn.execute("PRAGMA integrity_check").fetchall()]
            fk = conn.execute("PRAGMA foreign_key_check").fetchall()
            try:
                version = conn.execute("SELECT version_num FROM alembic_version").fetchone()
            except sqlite3.DatabaseError:
                version = None
        finally:
            conn.close()
    except sqlite3.DatabaseError as exc:
        return VerifyResult(False, [f"not a readable database: {exc}"])
    problems = [] if rows == ["ok"] else rows
    if fk:
        problems.append(f"{len(fk)} broken foreign-key reference(s)")
    if version is None:
        problems.append("no schema version recorded")
    return VerifyResult(not problems, problems, version[0] if version else None)


# ---------------------------------------------------------------- manifest


def _scan(directory: Path) -> list[BackupEntry]:
    """Rebuild an index from the files when the manifest is missing or damaged."""
    entries = []
    for p in sorted(directory.glob("app-*.db")):
        m = _NAME_RE.match(p.name)
        if not m:
            continue
        ts = datetime.strptime(m.group(1), "%Y%m%d-%H%M%S-%f").replace(tzinfo=UTC)
        entries.append(BackupEntry(p.name, m.group(2), ts.isoformat(timespec="microseconds"),
                                   p.stat().st_size, sha256_file(p)))
    return entries


def read_manifest(directory: Path) -> list[BackupEntry]:
    try:
        data = json.loads((directory / MANIFEST).read_text(encoding="utf-8"))
        entries = [BackupEntry(**e) for e in data["backups"]]
    except FileNotFoundError:
        return _scan(directory) if directory.is_dir() else []
    except (json.JSONDecodeError, KeyError, TypeError):
        log.warning("backup manifest in %s is damaged; rebuilding from files", directory)
        return _scan(directory)
    return sorted(entries, key=lambda e: e.created_at)


def _write_manifest(directory: Path, entries: list[BackupEntry]) -> None:
    body = {"version": 1, "backups": [asdict(e) for e in sorted(entries, key=lambda e: e.created_at)]}
    atomic_write_text(directory / MANIFEST, json.dumps(body, indent=2))


# ---------------------------------------------------------------- service


class BackupService:
    def __init__(self, paths: DataPaths) -> None:
        self.paths = paths

    # configuration -------------------------------------------------------
    def config(self) -> LocalConfig:
        return local_config.load(self.paths.config_file)

    def primary_dir(self) -> Path:
        cfg = self.config()
        return Path(cfg.backup_dir) if cfg.backup_dir else self.paths.default_backup_dir

    def secondary_dir(self) -> Path | None:
        cfg = self.config()
        return Path(cfg.secondary_backup_dir) if cfg.secondary_backup_dir else None

    def update_config(self, *, backup_dir: str | None = ..., secondary_backup_dir: str | None = ...,
                      max_total_backup_bytes: int | None = None) -> LocalConfig:
        cfg = self.config()
        for value in (backup_dir, secondary_backup_dir):
            if value not in (..., None):
                p = Path(value)
                p.mkdir(parents=True, exist_ok=True)
                probe = p / ".fvt-write-test"
                probe.write_text("ok")
                probe.unlink()
        if backup_dir is not ...:
            cfg.backup_dir = backup_dir or None
        if secondary_backup_dir is not ...:
            cfg.secondary_backup_dir = secondary_backup_dir or None
        if max_total_backup_bytes is not None:
            cfg.max_total_backup_bytes = max_total_backup_bytes
        local_config.save(self.paths.config_file, cfg)
        if max_total_backup_bytes is not None:
            self.prune()  # a lowered cap frees space now, not at the next backup
        return cfg

    # create --------------------------------------------------------------
    def create(self, reason: str, source: Path | None = None) -> BackupEntry:
        if reason not in REASONS:
            raise ValueError(f"unknown backup reason {reason!r}")
        source = source or self.paths.db_file
        directory = self.primary_dir()
        directory.mkdir(parents=True, exist_ok=True)
        with _lock:
            now = datetime.now(UTC)
            name = f"app-{now:%Y%m%d-%H%M%S-%f}-{reason}.db"
            final = directory / name
            partial = directory / (name + ".partial")
            try:
                sqlite_copy(source, partial)
                check = check_database_file(partial)
                if not check.ok:
                    raise BackupError("backup failed verification: " + "; ".join(check.problems))
                entry = BackupEntry(
                    filename=name, reason=reason, created_at=now.isoformat(timespec="microseconds"),
                    size_bytes=partial.stat().st_size, sha256=sha256_file(partial),
                    schema_version=check.schema_version,
                    verified_at=now.isoformat(timespec="microseconds"), verify_ok=True,
                )
                os.replace(partial, final)
            finally:
                partial.unlink(missing_ok=True)

            self._copy_to_secondary(final, entry)
            # A missing manifest is rebuilt by scanning, which already sees the new file: replace, don't append.
            entries = [e for e in read_manifest(directory) if e.filename != name] + [entry]
            _write_manifest(directory, entries)
            self.prune()
            log.info("backup created: %s (%s bytes)", name, entry.size_bytes)
            return entry

    def _copy_to_secondary(self, file: Path, entry: BackupEntry) -> None:
        secondary = self.secondary_dir()
        if secondary is None:
            return
        try:
            secondary.mkdir(parents=True, exist_ok=True)
            partial = secondary / (file.name + ".partial")
            shutil.copyfile(file, partial)
            _fsync_file(partial)
            if sha256_file(partial) != entry.sha256:
                partial.unlink(missing_ok=True)
                raise BackupError("checksum mismatch after copy")
            os.replace(partial, secondary / file.name)
            entry.secondary_copied = True
            entry.secondary_error = None
            _write_manifest(secondary, [e for e in read_manifest(secondary) if e.filename != entry.filename]
                            + [BackupEntry(**asdict(entry))])
        except Exception as exc:  # secondary failure must never block the primary backup
            entry.secondary_copied = False
            entry.secondary_error = str(exc)[:500]
            log.warning("secondary backup copy failed: %s", exc)

    def ensure_daily(self) -> BackupEntry | None:
        """Take today's daily backup if none exists yet (local calendar day)."""
        if not self.paths.db_file.exists():
            return None
        today = datetime.now().astimezone().date()
        with _lock:
            for e in self.list():
                if e.reason == "daily" and e.created.astimezone().date() == today:
                    return None
            return self.create("daily")

    # read ----------------------------------------------------------------
    def list(self) -> list[BackupEntry]:
        """Newest first."""
        return sorted(read_manifest(self.primary_dir()), key=lambda e: e.created_at, reverse=True)

    def get(self, filename: str) -> BackupEntry:
        if not _NAME_RE.match(filename):
            raise BackupError("invalid backup name")
        for e in self.list():
            if e.filename == filename:
                return e
        raise BackupError("backup not found")

    def verify(self, filename: str) -> VerifyResult:
        with _lock:
            entry = self.get(filename)
            path = self.primary_dir() / filename
            result = check_database_file(path)
            if result.ok and sha256_file(path) != entry.sha256:
                result = VerifyResult(False, ["file contents changed since the backup was taken"],
                                      result.schema_version)
            entries = read_manifest(self.primary_dir())
            for e in entries:
                if e.filename == filename:
                    e.verified_at = datetime.now(UTC).isoformat(timespec="microseconds")
                    e.verify_ok = result.ok
            _write_manifest(self.primary_dir(), entries)
            return result

    def usage(self) -> dict:
        directory = self.primary_dir()
        entries = self.list()
        used = sum(e.size_bytes for e in entries)
        disk = shutil.disk_usage(directory if directory.exists() else self.paths.root)
        cfg = self.config()
        return {
            "backup_dir": str(directory),
            "secondary_backup_dir": cfg.secondary_backup_dir,
            "count": len(entries),
            "used_bytes": used,
            "max_total_bytes": cfg.max_total_backup_bytes,
            "disk_free_bytes": disk.free,
            "disk_total_bytes": disk.total,
        }

    # prune ---------------------------------------------------------------
    def prune(self) -> list[str]:
        with _lock:
            directory = self.primary_dir()
            entries = sorted(read_manifest(directory), key=lambda e: e.created_at, reverse=True)
            protected = next((e.filename for e in entries if e.verify_ok), None)

            keep: list[BackupEntry] = []
            drop: list[BackupEntry] = []
            seen: dict[str, int] = {}
            for e in entries:  # newest first
                group = e.retention_group
                seen[group] = seen.get(group, 0) + 1
                (keep if seen[group] <= RETENTION[group] or e.filename == protected else drop).append(e)

            cap = self.config().max_total_backup_bytes
            total = sum(e.size_bytes for e in keep)
            for e in sorted(keep, key=lambda e: e.created_at):  # oldest first
                if total <= cap:
                    break
                if e.filename == protected:
                    continue
                keep.remove(e)
                drop.append(e)
                total -= e.size_bytes

            if not drop:
                return []
            dropped = {e.filename for e in drop}
            for f in dropped:
                (directory / f).unlink(missing_ok=True)
            _write_manifest(directory, keep)
            secondary = self.secondary_dir()
            if secondary and secondary.is_dir():
                try:
                    for f in dropped:
                        (secondary / f).unlink(missing_ok=True)
                    _write_manifest(secondary, [e for e in read_manifest(secondary) if e.filename not in dropped])
                except OSError as exc:
                    log.warning("could not prune secondary backups: %s", exc)
            log.info("pruned %d backup(s)", len(dropped))
            return sorted(dropped)


# ---------------------------------------------------------------- restore


def preserve_damaged_database(paths: DataPaths) -> Path:
    """Raw copy of app.db (+ -wal/-shm) into backups/damaged-<ts>/ before anything replaces it."""
    target = paths.default_backup_dir / f"damaged-{datetime.now(UTC):%Y%m%d-%H%M%S}"
    target.mkdir(parents=True, exist_ok=True)
    for suffix in ("", "-wal", "-shm"):
        src = Path(str(paths.db_file) + suffix)
        if src.exists():
            shutil.copy2(src, target / src.name)
    return target


def _checkpoint_and_close(db_file: Path) -> None:
    """Fold any WAL content into the main file and empty the WAL, so nothing is lost or replayed."""
    if not db_file.exists():
        return
    try:
        conn = sqlite3.connect(str(db_file), timeout=30)
        try:
            busy, _, _ = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
        finally:
            conn.close()
    except sqlite3.DatabaseError:
        return  # damaged file; it has been preserved by the caller
    if busy:
        raise BackupError("the database is still in use; close all connections before restoring")


def replace_database_file(db_file: Path, new_file: Path) -> None:
    """Atomically put `new_file`'s content in place of `db_file`.

    The caller must have disposed every SQLAlchemy engine on db_file first.
    `new_file` is never modified; a verified temporary copy is what gets swapped in.
    """
    check = check_database_file(new_file)
    if not check.ok:
        raise BackupError("refusing to restore a backup that fails verification: " + "; ".join(check.problems))
    staging = db_file.with_name(db_file.name + ".restoring")
    staging.unlink(missing_ok=True)
    sqlite_copy(new_file, staging)
    try:
        _checkpoint_and_close(db_file)
        for suffix in ("-wal", "-shm"):
            Path(str(db_file) + suffix).unlink(missing_ok=True)
        os.replace(staging, db_file)
    except OSError as exc:  # e.g. another program has the file open; nothing has been replaced
        raise BackupError("the database file is in use by another program; close it and try again") from exc
    finally:
        staging.unlink(missing_ok=True)
    after = check_database_file(db_file)
    if not after.ok:
        raise BackupError("restored database failed verification: " + "; ".join(after.problems))
