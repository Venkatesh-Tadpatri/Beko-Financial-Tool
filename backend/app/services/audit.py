"""Append-only, hash-chained audit log.

Each entry's hash covers its content and the previous entry's hash, so any
edit made to the database file outside the app (the triggers block it inside)
breaks the chain and is reported by verify_chain().

Callers write the audit entry in the SAME transaction as the change it
describes, so there is never a change without its audit row or vice versa.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import clock
from app.models import AuditLog, User

GENESIS = "0" * 64
_FORBIDDEN_KEYS = {"password", "new_password", "current_password", "confirm_password", "token", "password_hash"}


def _ts(dt: datetime) -> str:
    return dt.isoformat(timespec="microseconds")


def _digest(prev_hash: str, ts: str, user_id, username, action, entity_type, entity_id, details: str) -> str:
    payload = json.dumps([prev_hash, ts, user_id, username, action, entity_type, entity_id, details],
                         separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode()).hexdigest()


def record(session: Session, action: str, *, user: User | None = None, username: str | None = None,
           entity_type: str | None = None, entity_id: object = None, details: dict | None = None) -> AuditLog:
    details = details or {}
    leaked = _FORBIDDEN_KEYS & {k.lower() for k in details}
    if leaked:
        raise ValueError(f"refusing to audit secret fields: {sorted(leaked)}")
    prev = session.scalar(select(AuditLog.hash).order_by(AuditLog.id.desc()).limit(1)) or GENESIS
    ts = clock.now()
    user_id = user.id if user else None
    uname = user.username if user else username
    eid = None if entity_id is None else str(entity_id)
    body = json.dumps(details, sort_keys=True, default=str, ensure_ascii=False)
    entry = AuditLog(
        ts=ts, user_id=user_id, username=uname, action=action, entity_type=entity_type, entity_id=eid,
        details=body, prev_hash=prev,
        hash=_digest(prev, _ts(ts), user_id, uname, action, entity_type, eid, body),
    )
    session.add(entry)
    session.flush()
    return entry


def verify_chain(session: Session) -> dict:
    prev = GENESIS
    count = 0
    for e in session.scalars(select(AuditLog).order_by(AuditLog.id)):
        expected = _digest(prev, _ts(e.ts), e.user_id, e.username, e.action, e.entity_type, e.entity_id, e.details)
        if e.prev_hash != prev or e.hash != expected:
            return {"ok": False, "entries_checked": count, "first_bad_id": e.id}
        prev = e.hash
        count += 1
    return {"ok": True, "entries_checked": count, "first_bad_id": None}
