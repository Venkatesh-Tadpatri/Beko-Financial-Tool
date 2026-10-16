"""Upload wizard, review, submission, approval, history and overrides."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_db, get_state, require, short_transaction
from app.core import fiscal
from app.core.datasets import DATASETS
from app.core.permissions import Perm
from app.core.security import verify_password
from app.models import (
    ApprovalDecision,
    ApprovalLevel,
    DatasetSetting,
    ImportTemplate,
    MetricFact,
    PeriodVersion,
    ReceivableFact,
    Role,
    SalesFact,
    StagingRow,
    UploadBatch,
    User,
)
from app.services import audit, importer, workflow
from app.services.backup import BackupService
from app.services.workflow import WorkflowError
from app.state import AppState

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["import"])
can_upload = require(Perm.UPLOAD_DATA)
can_view = require(Perm.VIEW_REPORTS)
can_approve = require(Perm.APPROVE_DATA)
can_configure = require(Perm.CONFIGURE_APPROVALS)


def _err(code: int, key: str, message: str) -> HTTPException:
    return HTTPException(code, detail={"code": key, "message": message})


def _wf(exc: WorkflowError) -> HTTPException:
    return _err(exc.status, exc.code, str(exc))


# ------------------------------------------------------------------ schemas


class UploadRequest(BaseModel):
    dataset_type: str
    source_name: str = Field(default="SAP", min_length=1, max_length=128)
    path: str = Field(max_length=1000)


class MappingRequest(BaseModel):
    sheet: str = Field(max_length=128)
    header_row: int = Field(default=1, ge=1, le=1000)
    column_map: dict[str, str]
    save_template: bool = True


class RowEdit(BaseModel):
    values: dict[str, str | None] | None = None
    excluded: bool | None = None


class Decision(BaseModel):
    comment: str = Field(default="", max_length=2000)


class LevelsRequest(BaseModel):
    dataset_type: str = Field(max_length=32)
    roles: list[Literal["approver", "admin", "super_admin"]] = Field(min_length=1, max_length=5)


class GrainRequest(BaseModel):
    dataset_type: str
    period_grain: Literal["M", "Q", "Y"]


class OverrideRequest(BaseModel):
    fact_table: Literal["sales_facts", "metric_facts", "receivable_facts"] = "sales_facts"
    fact_id: int = 0
    field: str = Field(default="", max_length=48)
    new_value: str = Field(default="", max_length=64)
    reason: str = Field(default="", max_length=2000)
    password: str = Field(default="", max_length=256)


# ------------------------------------------------------------------ helpers


def _batch(db: Session, batch_id: int) -> UploadBatch:
    b = db.get(UploadBatch, batch_id)
    if b is None:
        raise _err(404, "not_found", "Upload not found.")
    return b


def _draft(db: Session, batch_id: int) -> UploadBatch:
    b = _batch(db, batch_id)
    if b.status != "draft":
        raise _err(409, "not_draft", "This upload has been submitted and can no longer be edited.")
    return b


def _archive(state: AppState, b: UploadBatch) -> Path:
    return state.settings.paths.uploads_dir / b.archived_path


def batch_out(db: Session, b: UploadBatch, user: User | None = None) -> dict:
    uploader = db.get(User, b.uploaded_by)
    levels = workflow.levels_for(db, b.dataset_type)
    decisions = [
        {"level_no": d.level_no, "decision": d.decision, "comment": d.comment, "ts": d.ts,
         "username": (db.get(User, d.user_id) or uploader).username}
        for d in db.scalars(select(ApprovalDecision).where(ApprovalDecision.batch_id == b.id).order_by(ApprovalDecision.id))
    ]
    summary = json.loads(b.summary or "{}")
    out = {
        "id": b.id, "dataset_type": b.dataset_type, "dataset_label": DATASETS[b.dataset_type].label,
        "source_name": b.source_name, "original_filename": b.original_filename, "period_grain": b.period_grain,
        "status": b.status, "current_level": b.current_level, "levels": levels, "uploaded_by": uploader.username,
        "uploaded_by_id": b.uploaded_by, "created_at": b.created_at, "submitted_at": b.submitted_at,
        "decided_at": b.decided_at, "row_count": b.row_count, "sheet_name": b.sheet_name, "header_row": b.header_row,
        "column_map": json.loads(b.column_map or "{}"), "summary": summary, "decisions": decisions,
        "is_demo": b.is_demo, "reimport_of": b.reimport_of,
    }
    if user is not None:
        out["can_act"] = b.uploaded_by != user.id and workflow.can_act_on(db, b, user)
    if b.status in ("submitted", "draft") and summary.get("periods"):
        periods = {(p["fy"], p["period_no"]) for p in summary["periods"]}
        out["replaces"] = workflow.replaced_versions(db, b.dataset_type, importer.months_covered(b.period_grain, periods))
    return out


def _backup_after(state: AppState, reason: str) -> str | None:
    """Automatic backup after a committed upload/approval. A failure is reported, never fatal."""
    try:
        BackupService(state.settings.paths).create(reason)
        return None
    except Exception as exc:
        log.exception("automatic %s backup failed", reason)
        return f"The automatic backup failed: {exc}"


# ------------------------------------------------------------------ datasets and templates


@router.get("/import/datasets")
def list_datasets(_: Principal = Depends(can_view), db: Session = Depends(get_db)) -> list[dict]:
    templates = db.scalars(select(ImportTemplate)).all()
    return [
        {
            "key": d.key, "label": d.label, "period_grain": workflow.grain_for(db, d.key),
            "fields": [{"key": f.key, "label": f.label, "kind": f.kind, "required": f.required,
                        "group": "period" if f.key in ("period_date", "fiscal_year", "period_no") else
                        ("value" if f in d.values else "dimension")} for f in d.fields],
            "templates": [{"id": t.id, "source_name": t.source_name} for t in templates if t.dataset_type == d.key],
            "approval_levels": workflow.levels_for(db, d.key),
        }
        for d in DATASETS.values()
    ]


@router.delete("/import/templates/{template_id}", status_code=204)
def delete_template(template_id: int, p: Principal = Depends(can_upload), db: Session = Depends(get_db)) -> None:
    t = db.get(ImportTemplate, template_id)
    if t is None:
        raise _err(404, "not_found", "Template not found.")
    db.execute(UploadBatch.__table__.update().where(UploadBatch.template_id == t.id).values(template_id=None))
    db.delete(t)
    audit.record(db, "template_deleted", user=p.user, entity_type="template", entity_id=template_id,
                 details={"dataset": t.dataset_type, "source": t.source_name})


# ------------------------------------------------------------------ wizard


@router.post("/import/upload", status_code=status.HTTP_201_CREATED)
def upload(body: UploadRequest, p: Principal = Depends(can_upload), db: Session = Depends(get_db),
           state: AppState = Depends(get_state)) -> dict:
    if body.dataset_type not in DATASETS:
        raise _err(400, "bad_dataset", "Choose what kind of data this file contains.")
    src = Path(body.path)
    if not src.is_absolute():
        raise _err(400, "bad_path", "Choose the file to upload.")
    try:
        rel, digest = importer.archive_file(src, state.settings.paths.uploads_dir)
        sheets = importer.sheet_names(state.settings.paths.uploads_dir / rel)
    except importer.ImportError_ as exc:
        raise _err(400, "bad_file", str(exc)) from exc
    template = db.scalar(select(ImportTemplate).where(ImportTemplate.dataset_type == body.dataset_type,
                                                      ImportTemplate.source_name == body.source_name.strip()))
    archive = state.settings.paths.uploads_dir / rel
    sheet = template.sheet_name if template and template.sheet_name in sheets else sheets[0]
    header_row = template.header_row if template else importer.detect_header_row(archive, sheet, DATASETS[body.dataset_type])
    batch = UploadBatch(dataset_type=body.dataset_type, source_name=body.source_name.strip(),
                        period_grain=workflow.grain_for(db, body.dataset_type), original_filename=src.name[:255],
                        archived_path=rel, sha256=digest, uploaded_by=p.user.id, template_id=template.id if template else None,
                         sheet_name=sheet, header_row=header_row)
    db.add(batch)
    db.flush()
    earlier = db.scalars(select(UploadBatch).where(UploadBatch.sha256 == digest, UploadBatch.id != batch.id,
                                                   UploadBatch.dataset_type == body.dataset_type,
                                                   UploadBatch.status.in_(("submitted", "approved", "superseded")))).first()
    audit.record(db, "upload", user=p.user, entity_type="batch", entity_id=batch.id,
                 details={"dataset": body.dataset_type, "file": src.name, "sha256": digest})
    # A valid workbook should become report data in this one action. Reuse a
    # saved mapping when possible, otherwise use the detected column mapping.
    # Files that need human correction remain drafts and open in the review UI.
    auto_error = None
    try:
        headers = importer.preview(archive, sheet, header_row)["headers"]
        saved_map = json.loads(template.column_map) if template else None
        column_map = importer.suggest_mapping(headers, DATASETS[body.dataset_type], saved_map)
        workflow.check_mapping(DATASETS[body.dataset_type], batch.period_grain, headers, column_map)
        summary = workflow.stage(db, batch, archive, sheet, header_row, column_map)
        workflow.save_template(db, batch, p.user)
        if summary["can_submit"]:
            workflow.submit(db, batch)
            audit.record(db, "upload_published", user=p.user, entity_type="batch", entity_id=batch.id,
                         details={"rows": batch.row_count, "dataset": batch.dataset_type, "automatic": True})
    except (WorkflowError, importer.ImportError_) as exc:
        auto_error = str(exc)
    return {"batch": batch_out(db, batch), "sheets": sheets,
            "duplicate_of": {"id": earlier.id, "status": earlier.status, "created_at": earlier.created_at} if earlier else None,
            "auto_import_error": auto_error}


@router.get("/import/batches/{batch_id}/sheets")
def batch_sheets(batch_id: int, p: Principal = Depends(can_upload), db: Session = Depends(get_db),
                 state: AppState = Depends(get_state)) -> dict:
    b = _batch(db, batch_id)
    try:
        sheets = importer.sheet_names(_archive(state, b))
    except importer.ImportError_ as exc:
        raise _err(400, "bad_file", str(exc)) from exc
    return {"batch": batch_out(db, b, p.user), "sheets": sheets}


@router.get("/import/batches/{batch_id}/sheet")
def sheet_preview(batch_id: int, sheet: str = Query(max_length=128), header_row: int = Query(default=1, ge=1, le=1000),
                  _: Principal = Depends(can_upload), db: Session = Depends(get_db),
                  state: AppState = Depends(get_state)) -> dict:
    b = _batch(db, batch_id)
    try:
        prev = importer.preview(_archive(state, b), sheet, header_row)
    except importer.ImportError_ as exc:
        raise _err(400, "bad_sheet", str(exc)) from exc
    template = db.get(ImportTemplate, b.template_id) if b.template_id else None
    current = json.loads(b.column_map or "{}") or (json.loads(template.column_map) if template else None)
    prev["suggested_map"] = importer.suggest_mapping(prev["headers"], importer.dataset(b.dataset_type), current)
    prev["from_template"] = bool(current) and prev["suggested_map"] == current
    return prev


@router.post("/import/batches/{batch_id}/mapping")
def apply_mapping(batch_id: int, body: MappingRequest, p: Principal = Depends(can_upload), db: Session = Depends(get_db),
                  state: AppState = Depends(get_state)) -> dict:
    b = _draft(db, batch_id)
    try:
        summary = workflow.stage(db, b, _archive(state, b), body.sheet, body.header_row, body.column_map)
    except WorkflowError as exc:
        raise _wf(exc) from exc
    except importer.ImportError_ as exc:
        raise _err(400, "bad_sheet", str(exc)) from exc
    if body.save_template:
        workflow.save_template(db, b, p.user)
    return {"batch": batch_out(db, b), "summary": summary}


@router.get("/import/batches")
def list_batches(status_: str | None = Query(default=None, alias="status"), dataset: str | None = None,
                 limit: int = Query(default=100, ge=1, le=500), offset: int = Query(default=0, ge=0),
                 p: Principal = Depends(can_view), db: Session = Depends(get_db)) -> dict:
    q = select(UploadBatch)
    if status_:
        q = q.where(UploadBatch.status.in_(status_.split(",")))
    if dataset:
        q = q.where(UploadBatch.dataset_type == dataset)
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    items = [batch_out(db, b, p.user) for b in db.scalars(q.order_by(UploadBatch.id.desc()).limit(limit).offset(offset))]
    return {"items": items, "total": total}


@router.get("/import/batches/{batch_id}")
def get_batch(batch_id: int, p: Principal = Depends(can_view), db: Session = Depends(get_db)) -> dict:
    b = _batch(db, batch_id)
    out = batch_out(db, b, p.user)
    out["current_months"] = db.scalar(select(func.count()).select_from(PeriodVersion).where(
        PeriodVersion.batch_id == b.id, PeriodVersion.valid_to.is_(None))) or 0
    return out


@router.get("/import/batches/{batch_id}/rows")
def get_rows(batch_id: int, filter_: Literal["all", "errors", "warnings", "excluded", "ready"] = Query(default="all", alias="filter"),
             limit: int = Query(default=100, ge=1, le=1000), offset: int = Query(default=0, ge=0),
             _: Principal = Depends(can_view), db: Session = Depends(get_db)) -> dict:
    b = _batch(db, batch_id)
    q = select(StagingRow).where(StagingRow.batch_id == b.id)
    has_error = StagingRow.errors.like('%"severity":"error"%')
    has_warning = StagingRow.errors.like('%"severity":"warning"%')
    if filter_ == "errors":
        q = q.where(StagingRow.excluded.is_(False), has_error)
    elif filter_ == "warnings":
        q = q.where(StagingRow.excluded.is_(False), has_warning, ~has_error)
    elif filter_ == "excluded":
        q = q.where(StagingRow.excluded.is_(True))
    elif filter_ == "ready":
        q = q.where(StagingRow.excluded.is_(False), ~has_error)
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    column_map = json.loads(b.column_map or "{}")
    rows = []
    for r in db.scalars(q.order_by(StagingRow.row_no).limit(limit).offset(offset)):
        raw, edits = json.loads(r.raw), json.loads(r.mapped)
        values = {f: (edits[f] if f in edits else raw.get(col)) for f, col in column_map.items()}
        rows.append({"row_no": r.row_no, "values": values, "edited_fields": sorted(edits), "issues": json.loads(r.errors),
                     "excluded": r.excluded})
    return {"rows": rows, "total": total}


@router.patch("/import/batches/{batch_id}/rows/{row_no}")
def edit_row(batch_id: int, row_no: int, body: RowEdit, p: Principal = Depends(can_upload),
             db: Session = Depends(get_db)) -> dict:
    b = _draft(db, batch_id)
    try:
        summary = workflow.edit_row(db, b, row_no, body.values, body.excluded)
    except WorkflowError as exc:
        raise _wf(exc) from exc
    return {"summary": summary}


@router.post("/import/batches/{batch_id}/validate")
def validate(batch_id: int, _: Principal = Depends(can_upload), db: Session = Depends(get_db)) -> dict:
    b = _draft(db, batch_id)
    return {"summary": workflow.revalidate(db, b)}


@router.post("/import/batches/{batch_id}/submit")
def submit(batch_id: int, request: Request, state: AppState = Depends(get_state)) -> dict:
    with short_transaction(request, state, Perm.UPLOAD_DATA) as (db, p):
        b = _batch(db, batch_id)
        try:
            workflow.submit(db, b)
        except WorkflowError as exc:
            raise _wf(exc) from exc
        audit.record(db, "upload_published", user=p.user, entity_type="batch", entity_id=b.id,
                     details={"rows": b.row_count, "dataset": b.dataset_type})
        out = batch_out(db, b, p.user)
    out["backup_warning"] = _backup_after(state, "upload")
    return out


@router.post("/import/batches/{batch_id}/reopen")
def reopen(batch_id: int, p: Principal = Depends(can_upload), db: Session = Depends(get_db)) -> dict:
    b = _batch(db, batch_id)
    if b.status != "rejected":
        raise _err(409, "not_rejected", "Only rejected uploads can be reopened for correction.")
    b.status, b.current_level = "draft", 0
    audit.record(db, "upload_reopened", user=p.user, entity_type="batch", entity_id=b.id)
    return batch_out(db, b, p.user)


@router.post("/import/batches/{batch_id}/discard", status_code=204)
def discard(batch_id: int, p: Principal = Depends(can_upload), db: Session = Depends(get_db)) -> None:
    b = _batch(db, batch_id)
    if b.status not in ("draft", "rejected"):
        raise _err(409, "not_draft", "Only drafts and rejected uploads can be discarded.")
    if db.scalar(select(ApprovalDecision.id).where(ApprovalDecision.batch_id == b.id).limit(1)):
        b.status = "rejected"  # keep its decision history; just stop working on it
        db.execute(delete(StagingRow).where(StagingRow.batch_id == b.id))
    else:
        db.execute(delete(StagingRow).where(StagingRow.batch_id == b.id))
        db.delete(b)
    audit.record(db, "upload_discarded", user=p.user, entity_type="batch", entity_id=batch_id,
                 details={"file": b.original_filename})


@router.post("/import/batches/{batch_id}/reimport", status_code=status.HTTP_201_CREATED)
def reimport(batch_id: int, p: Principal = Depends(can_upload), db: Session = Depends(get_db),
             state: AppState = Depends(get_state)) -> dict:
    old = _batch(db, batch_id)
    archive = _archive(state, old)
    if not archive.is_file():
        raise _err(410, "archive_missing", "The archived file for this upload is missing from the uploads folder.")
    new = UploadBatch(dataset_type=old.dataset_type, source_name=old.source_name, template_id=old.template_id,
                      period_grain=workflow.grain_for(db, old.dataset_type), original_filename=old.original_filename,
                      archived_path=old.archived_path, sha256=old.sha256, uploaded_by=p.user.id, reimport_of=old.id)
    db.add(new)
    db.flush()
    summary = None
    if old.sheet_name and old.column_map and old.column_map != "{}":
        try:
            summary = workflow.stage(db, new, archive, old.sheet_name, old.header_row, json.loads(old.column_map))
        except (WorkflowError, importer.ImportError_):
            summary = None  # mapping no longer fits (e.g. grain changed); the user maps again
    audit.record(db, "upload", user=p.user, entity_type="batch", entity_id=new.id,
                 details={"reimport_of": old.id, "file": old.original_filename})
    return {"batch": batch_out(db, new, p.user), "summary": summary,
            "sheets": importer.sheet_names(archive)}


# ------------------------------------------------------------------ approvals


@router.get("/approvals/pending")
def pending(p: Principal = Depends(can_approve), db: Session = Depends(get_db)) -> list[dict]:
    out = []
    for b in db.scalars(select(UploadBatch).where(UploadBatch.status == "submitted").order_by(UploadBatch.submitted_at)):
        item = batch_out(db, b, p.user)
        out.append(item)
    return out


@router.post("/approvals/{batch_id}/approve")
def approve(batch_id: int, body: Decision, request: Request, state: AppState = Depends(get_state)) -> dict:
    with short_transaction(request, state, Perm.APPROVE_DATA) as (db, p):
        b = _batch(db, batch_id)
        try:
            final = workflow.approve(db, b, p.user, body.comment)
        except WorkflowError as exc:
            raise _wf(exc) from exc
        audit.record(db, "approved" if final else "approval_step", user=p.user, entity_type="batch", entity_id=b.id,
                     details={"level": b.current_level if not final else len(workflow.levels_for(db, b.dataset_type)),
                              "final": final, "rows": b.row_count, "comment": body.comment[:200]})
        out = batch_out(db, b, p.user)
    out["backup_warning"] = _backup_after(state, "approval") if final else None
    return out


@router.post("/approvals/{batch_id}/reject")
def reject(batch_id: int, body: Decision, p: Principal = Depends(can_approve), db: Session = Depends(get_db)) -> dict:
    b = _batch(db, batch_id)
    try:
        workflow.reject(db, b, p.user, body.comment)
    except WorkflowError as exc:
        raise _wf(exc) from exc
    audit.record(db, "rejected", user=p.user, entity_type="batch", entity_id=b.id, details={"comment": body.comment[:200]})
    return batch_out(db, b, p.user)


@router.get("/approvals/levels")
def get_levels(_: Principal = Depends(can_view), db: Session = Depends(get_db)) -> dict:
    out: dict[str, list[str]] = {}
    for lv in db.scalars(select(ApprovalLevel).order_by(ApprovalLevel.dataset_type, ApprovalLevel.level_no)):
        out.setdefault(lv.dataset_type, []).append(lv.required_role)
    return out


@router.put("/approvals/levels")
def put_levels(body: LevelsRequest, p: Principal = Depends(can_configure), db: Session = Depends(get_db)) -> dict:
    if body.dataset_type != "*" and body.dataset_type not in DATASETS:
        raise _err(400, "bad_dataset", "Unknown dataset type.")
    if any(Role(b).rank < Role(a).rank for a, b in zip(body.roles, body.roles[1:], strict=False)):
        raise _err(400, "bad_order", "Each approval level must need the same or a higher role than the one before.")
    if db.scalar(select(UploadBatch.id).where(UploadBatch.status == "submitted").limit(1)):
        pass  # in-flight uploads keep their current level number and follow the new chain from there
    before = workflow.levels_for(db, body.dataset_type) if body.dataset_type != "*" else get_levels(p, db).get("*", [])
    db.execute(delete(ApprovalLevel).where(ApprovalLevel.dataset_type == body.dataset_type))
    for i, role in enumerate(body.roles, start=1):
        db.add(ApprovalLevel(dataset_type=body.dataset_type, level_no=i, required_role=role))
    audit.record(db, "approval_levels_changed", user=p.user, entity_type="settings", entity_id=body.dataset_type,
                 details={"before": before, "after": body.roles})
    db.flush()
    return get_levels(p, db)


@router.delete("/approvals/levels/{dataset_type}", status_code=204)
def reset_levels(dataset_type: str, p: Principal = Depends(can_configure), db: Session = Depends(get_db)) -> None:
    if dataset_type == "*":
        raise _err(400, "bad_dataset", "The default approval chain cannot be removed.")
    db.execute(delete(ApprovalLevel).where(ApprovalLevel.dataset_type == dataset_type))
    audit.record(db, "approval_levels_changed", user=p.user, entity_type="settings", entity_id=dataset_type,
                 details={"after": "default"})


@router.put("/settings/datasets")
def set_grain(body: GrainRequest, p: Principal = Depends(can_configure), db: Session = Depends(get_db)) -> dict:
    if body.dataset_type not in DATASETS:
        raise _err(400, "bad_dataset", "Unknown dataset type.")
    s = db.get(DatasetSetting, body.dataset_type)
    before = s.period_grain if s else None
    if s is None:
        s = DatasetSetting(dataset_type=body.dataset_type, period_grain=body.period_grain)
        db.add(s)
    s.period_grain, s.updated_by = body.period_grain, p.user.id
    audit.record(db, "dataset_period_changed", user=p.user, entity_type="settings", entity_id=body.dataset_type,
                 details={"before": before, "after": body.period_grain})
    return {"dataset_type": body.dataset_type, "period_grain": body.period_grain}


# ------------------------------------------------------------------ approved values and overrides


@router.get("/import/batches/{batch_id}/facts")
def batch_facts(batch_id: int, limit: int = Query(default=100, ge=1, le=1000), offset: int = Query(default=0, ge=0),
                _: Principal = Depends(can_view), db: Session = Depends(get_db)) -> dict:
    b = _batch(db, batch_id)
    ds = importer.dataset(b.dataset_type)
    model = workflow.FACT_MODELS[{"sales": "sales_facts", "metric": "metric_facts", "receivable": "receivable_facts"}[ds.fact_table]]
    q = select(model).where(model.batch_id == b.id)
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    items = []
    for f in db.scalars(q.order_by(model.id).limit(limit).offset(offset)):
        row = {c.key: getattr(f, c.key) for c in f.__table__.columns}
        row["period_label"] = fiscal.period_label(f.fy, f.period_grain, f.period_no)
        items.append(row)
    return {"fact_table": model.__tablename__, "items": items, "total": total}


@router.post("/overrides")
def override(body: OverrideRequest, request: Request, state: AppState = Depends(get_state)) -> dict:
    with short_transaction(request, state, Perm.OVERRIDE_DATA) as (db, p):
        if not verify_password(p.user.password_hash, body.password):
            raise _err(400, "wrong_password", "Your password is not correct.")
        try:
            ov = workflow.apply_override(db, p.user, body.fact_table, body.fact_id, body.field, body.new_value, body.reason)
        except WorkflowError as exc:
            raise _wf(exc) from exc
        audit.record(db, "override", user=p.user, entity_type=body.fact_table, entity_id=body.fact_id,
                     details={"batch": ov.batch_id, "field": ov.field, "old": ov.old_value, "new": ov.new_value,
                              "reason": ov.reason[:500]})
        return {"id": ov.id, "old_value": ov.old_value, "new_value": ov.new_value}


@router.get("/import/batches/{batch_id}/overrides")
def list_overrides(batch_id: int, _: Principal = Depends(can_view), db: Session = Depends(get_db)) -> list[dict]:
    from app.models import Override

    rows = db.scalars(select(Override).where(Override.batch_id == batch_id).order_by(Override.id.desc()))
    return [{"id": o.id, "fact_table": o.fact_table, "fact_id": o.fact_id, "field": o.field, "old_value": o.old_value,
             "new_value": o.new_value, "reason": o.reason, "username": db.get(User, o.user_id).username, "ts": o.ts}
            for o in rows]


_ = (MetricFact, ReceivableFact, SalesFact)  # imported for model registration in type checkers
