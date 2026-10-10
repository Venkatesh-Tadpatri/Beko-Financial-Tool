"""Read-only audit log (Super Admin). There is no route that changes it."""

from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_db, require
from app.core.permissions import Perm
from app.models import AuditLog
from app.services import audit

router = APIRouter(prefix="/api/audit", tags=["audit"])
can_view = require(Perm.VIEW_AUDIT_LOG)


class AuditRow(BaseModel):
    id: int
    ts: datetime
    username: str | None
    action: str
    entity_type: str | None
    entity_id: str | None
    details: dict


class AuditPage(BaseModel):
    items: list[AuditRow]
    total: int


def _local_day_start_utc(d: date, tz_offset_minutes: int) -> datetime:
    # The UI sends its UTC offset so "from 10 Oct" means 10 Oct on the user's clock.
    from datetime import UTC

    return datetime.combine(d, time.min, tzinfo=UTC) - timedelta(minutes=tz_offset_minutes)


@router.get("", response_model=AuditPage)
def list_audit(
    _: Principal = Depends(can_view),
    db: Session = Depends(get_db),
    action: str | None = None,
    username: str | None = Query(default=None, max_length=64),
    date_from: date | None = None,
    date_to: date | None = None,
    tz_offset_minutes: int = Query(default=0, ge=-840, le=840),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> AuditPage:
    q = select(AuditLog)
    if action:
        q = q.where(AuditLog.action == action)
    if username:
        q = q.where(AuditLog.username.ilike(f"%{username.strip()}%"))
    if date_from:
        q = q.where(AuditLog.ts >= _local_day_start_utc(date_from, tz_offset_minutes))
    if date_to:
        q = q.where(AuditLog.ts < _local_day_start_utc(date_to + timedelta(days=1), tz_offset_minutes))
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    rows = db.scalars(q.order_by(AuditLog.id.desc()).limit(limit).offset(offset))
    return AuditPage(total=total, items=[
        AuditRow(id=r.id, ts=r.ts, username=r.username, action=r.action, entity_type=r.entity_type,
                 entity_id=r.entity_id, details=json.loads(r.details or "{}"))
        for r in rows
    ])


@router.get("/actions", response_model=list[str])
def list_actions(_: Principal = Depends(can_view), db: Session = Depends(get_db)) -> list[str]:
    return list(db.scalars(select(AuditLog.action).distinct().order_by(AuditLog.action)))


@router.get("/verify-chain")
def verify(_: Principal = Depends(can_view), db: Session = Depends(get_db)) -> dict:
    return audit.verify_chain(db)
