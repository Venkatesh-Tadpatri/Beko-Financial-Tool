"""Backup screen (Super Admin) and recovery-mode restore."""

from __future__ import annotations

import time
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import Principal, authenticate_short, get_db, get_state, require
from app.core.db import transaction
from app.core.permissions import Perm
from app.core.security import verify_password
from app.services import audit
from app.services.backup import BackupEntry, BackupError, BackupService, check_database_file
from app.services.local_config import GIB
from app.services.restore import record_restore_in_restored_db, restore, super_admin_in_backup
from app.state import AppState, Mode

router = APIRouter(prefix="/api/backups", tags=["backups"])
recovery_router = APIRouter(prefix="/api/recovery", tags=["recovery"])
manage = require(Perm.MANAGE_BACKUPS)


class BackupOut(BaseModel):
    filename: str
    reason: str
    created_at: datetime
    size_bytes: int
    schema_version: str | None
    verified_at: datetime | None
    verify_ok: bool | None
    secondary_copied: bool
    secondary_error: str | None


class BackupList(BaseModel):
    backups: list[BackupOut]
    usage: dict


class BackupSettings(BaseModel):
    backup_dir: str = Field(max_length=500)
    secondary_backup_dir: str = Field(default="", max_length=500)
    max_total_backup_gb: float = Field(ge=0.1, le=10_000)


# Defaults keep body validation from answering before the permission check: an
# unauthorised caller always gets 403, never a hint about the expected body.
class RestoreRequest(BaseModel):
    password: str = Field(default="", max_length=256)


class RestoreFileRequest(RestoreRequest):
    path: str = Field(default="", max_length=1000)


class RecoveryRestoreRequest(BaseModel):
    filename: str | None = Field(default=None, max_length=255)
    path: str | None = Field(default=None, max_length=1000)
    username: str = Field(max_length=64)
    password: str = Field(max_length=256)


def _err(code: int, key: str, message: str) -> HTTPException:
    return HTTPException(code, detail={"code": key, "message": message})


def _out(e: BackupEntry) -> BackupOut:
    return BackupOut(filename=e.filename, reason=e.reason, created_at=e.created, size_bytes=e.size_bytes,
                     schema_version=e.schema_version,
                     verified_at=datetime.fromisoformat(e.verified_at) if e.verified_at else None,
                     verify_ok=e.verify_ok, secondary_copied=e.secondary_copied, secondary_error=e.secondary_error)


def _svc(state: AppState) -> BackupService:
    return BackupService(state.settings.paths)


def _backup_file(svc: BackupService, filename: str) -> Path:
    try:
        svc.get(filename)
    except BackupError as exc:
        raise _err(404, "not_found", "Backup not found.") from exc
    return svc.primary_dir() / filename


def _external_file(path: str) -> Path:
    p = Path(path)
    if not p.is_absolute() or p.suffix.lower() != ".db" or not p.is_file():
        raise _err(400, "invalid_file", "Choose a backup file (.db).")
    return p


# ------------------------------------------------------------------ backup screen


@router.get("", response_model=BackupList)
def list_backups(_: Principal = Depends(manage), state: AppState = Depends(get_state)) -> BackupList:
    svc = _svc(state)
    return BackupList(backups=[_out(e) for e in svc.list()], usage=svc.usage())


@router.post("", response_model=BackupOut, status_code=status.HTTP_201_CREATED)
def backup_now(p: Principal = Depends(manage), db: Session = Depends(get_db),
               state: AppState = Depends(get_state)) -> BackupOut:
    try:
        entry = _svc(state).create("manual")
    except (BackupError, OSError) as exc:
        raise _err(500, "backup_failed", f"The backup could not be created: {exc}") from exc
    audit.record(db, "backup_created", user=p.user, entity_type="backup", entity_id=entry.filename[:64],
                 details={"reason": "manual", "secondary_copied": entry.secondary_copied})
    return _out(entry)


@router.post("/{filename}/verify")
def verify_backup(filename: str, p: Principal = Depends(manage), db: Session = Depends(get_db),
                  state: AppState = Depends(get_state)) -> dict:
    svc = _svc(state)
    _backup_file(svc, filename)
    result = svc.verify(filename)
    audit.record(db, "backup_verified", user=p.user, entity_type="backup", entity_id=filename[:64],
                 details={"ok": result.ok})
    return {"ok": result.ok, "problems": result.problems, "schema_version": result.schema_version}


@router.get("/settings")
def get_settings(_: Principal = Depends(manage), state: AppState = Depends(get_state)) -> dict:
    svc = _svc(state)
    cfg = svc.config()
    return {"backup_dir": str(svc.primary_dir()), "default_backup_dir": str(state.settings.paths.default_backup_dir),
            "secondary_backup_dir": cfg.secondary_backup_dir or "",
            "max_total_backup_gb": round(cfg.max_total_backup_bytes / GIB, 2)}


@router.put("/settings")
def put_settings(body: BackupSettings, p: Principal = Depends(manage), db: Session = Depends(get_db),
                 state: AppState = Depends(get_state)) -> dict:
    svc = _svc(state)
    before = get_settings(p, state)
    for value in (body.backup_dir, body.secondary_backup_dir):
        if value and not Path(value).is_absolute():
            raise _err(400, "invalid_folder", "Use a full folder path, for example D:\\Backups.")
    primary = None if Path(body.backup_dir) == state.settings.paths.default_backup_dir else body.backup_dir
    if body.secondary_backup_dir and Path(body.secondary_backup_dir) == Path(body.backup_dir):
        raise _err(400, "same_folder", "The second backup location must be a different folder.")
    try:
        svc.update_config(backup_dir=primary, secondary_backup_dir=body.secondary_backup_dir or None,
                          max_total_backup_bytes=int(body.max_total_backup_gb * GIB))
    except (OSError, ValueError) as exc:
        raise _err(400, "invalid_folder", f"That folder cannot be used: {exc}") from exc
    after = get_settings(p, state)
    audit.record(db, "backup_settings_changed", user=p.user, entity_type="settings",
                 details={k: [before[k], after[k]] for k in after if before[k] != after[k]})
    return after


def _restore_with_password(request: Request, state: AppState, file: Path, password: str, source: str) -> dict:
    if state.mode != Mode.READY or state.session_factory is None:
        raise _err(503, "not_ready", "The application is not ready.")
    check = check_database_file(file)
    # Authenticate and record the request in a short transaction of its own, so no
    # connection is held while the database file is being replaced.
    with transaction(state.session_factory) as db:
        p = authenticate_short(request, state, Perm.MANAGE_BACKUPS, db)
        if not verify_password(p.user.password_hash, password):
            raise _err(400, "wrong_password", "Your password is not correct.")
        if not check.ok:
            raise _err(400, "invalid_backup", "This backup failed verification and cannot be restored: "
                       + "; ".join(check.problems[:3]))
        audit.record(db, "restore_requested", user=p.user, entity_type="backup", entity_id=source[:64])
        username = p.user.username
    try:
        result = restore(state, file)
    except BackupError as exc:
        raise _err(409, "restore_failed", f"The restore did not happen: {exc}") from exc
    record_restore_in_restored_db(state, username, source, result)
    return result


def _check_access(request: Request, state: AppState) -> None:
    """Refuse unauthorised callers before looking at anything they sent."""
    if state.mode != Mode.READY or state.session_factory is None:
        raise _err(503, "not_ready", "The application is not ready.")
    with transaction(state.session_factory) as db:
        authenticate_short(request, state, Perm.MANAGE_BACKUPS, db)


@router.post("/{filename}/restore")
def restore_backup(filename: str, body: RestoreRequest, request: Request,
                   state: AppState = Depends(get_state)) -> dict:
    _check_access(request, state)
    file = _backup_file(_svc(state), filename)
    return _restore_with_password(request, state, file, body.password, filename)


@router.post("/restore-file")
def restore_from_file(body: RestoreFileRequest, request: Request, state: AppState = Depends(get_state)) -> dict:
    _check_access(request, state)
    file = _external_file(body.path)
    return _restore_with_password(request, state, file, body.password, file.name)


# ------------------------------------------------------------------ recovery mode

_failures: list[float] = []
_MAX_FAILURES, _BLOCK_SECONDS = 5, 300


def _require_recovery(state: AppState) -> None:
    if state.mode != Mode.RECOVERY:
        raise _err(409, "not_in_recovery", "Recovery is only available when the database cannot be opened.")


@recovery_router.get("/backups", response_model=list[BackupOut])
def recovery_list(state: AppState = Depends(get_state)) -> list[BackupOut]:
    _require_recovery(state)
    return [_out(e) for e in _svc(state).list()]


@recovery_router.post("/restore")
def recovery_restore(body: RecoveryRestoreRequest, state: AppState = Depends(get_state)) -> dict:
    _require_recovery(state)
    now = time.monotonic()
    _failures[:] = [t for t in _failures if now - t < _BLOCK_SECONDS]
    if len(_failures) >= _MAX_FAILURES:
        raise _err(423, "too_many_attempts", "Too many failed attempts. Try again in 5 minutes.")

    svc = _svc(state)
    if body.filename:
        file, source = _backup_file(svc, body.filename), body.filename
    elif body.path:
        file = _external_file(body.path)
        source = file.name
    else:
        raise _err(400, "no_backup", "Choose a backup to restore.")

    check = check_database_file(file)
    if not check.ok:
        raise _err(400, "invalid_backup", "This backup failed verification and cannot be restored.")
    if not super_admin_in_backup(file, body.username, body.password):
        _failures.append(now)
        raise _err(401, "invalid_credentials", "Use the username and password of a Super Admin in that backup.")
    try:
        result = restore(state, file)
    except BackupError as exc:
        raise _err(409, "restore_failed", f"The restore did not happen: {exc}") from exc
    record_restore_in_restored_db(state, body.username.strip(), source, {**result, "mode": "recovery"})
    return result
