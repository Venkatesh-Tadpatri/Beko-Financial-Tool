"""Staging, validation, submission, approval and overrides for uploaded data.

Every function here runs inside the caller's single transaction, so a
multi-step change (e.g. final approval: close old versions, open new ones,
load facts, change status) either happens completely or not at all.
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

from sqlalchemy import delete, insert, select, update
from sqlalchemy.orm import Session

from app.core import clock, fiscal
from app.core.money import MoneyParseError, paise_to_rupees, to_count, to_paise
from app.models import (
    ApprovalDecision,
    ApprovalLevel,
    DatasetSetting,
    ImportTemplate,
    MetricFact,
    Override,
    PeriodVersion,
    ReceivableFact,
    Role,
    SalesFact,
    StagingRow,
    UploadBatch,
    User,
)
from app.services import importer
from app.services.importer import Issue, Lookups, Parsed, Validator, dumps

CHUNK = 5000


class WorkflowError(ValueError):
    def __init__(self, code: str, message: str, status: int = 409) -> None:
        super().__init__(message)
        self.code, self.status = code, status


# ------------------------------------------------------------------ settings


def grain_for(db: Session, dataset_type: str) -> str:
    s = db.get(DatasetSetting, dataset_type)
    return s.period_grain if s else importer.dataset(dataset_type).default_grain


def levels_for(db: Session, dataset_type: str) -> list[str]:
    rows = db.scalars(select(ApprovalLevel).where(ApprovalLevel.dataset_type == dataset_type).order_by(ApprovalLevel.level_no)).all()
    if not rows:
        rows = db.scalars(select(ApprovalLevel).where(ApprovalLevel.dataset_type == "*").order_by(ApprovalLevel.level_no)).all()
    return [r.required_role for r in rows] or ["approver"]


# ------------------------------------------------------------------ staging


def check_mapping(ds, grain: str, headers: list[str], column_map: dict[str, str]) -> None:
    unknown = {f for f in column_map if f not in {x.key for x in ds.fields}}
    if unknown:
        raise WorkflowError("bad_mapping", f"Unknown field(s): {', '.join(sorted(unknown))}.", 400)
    missing_cols = [c for c in column_map.values() if c not in headers]
    if missing_cols:
        raise WorkflowError("bad_mapping", f"Column(s) not in the sheet: {', '.join(missing_cols)}.", 400)
    if len(set(column_map.values())) != len(column_map):
        raise WorkflowError("bad_mapping", "Each Excel column can be used for one field only.", 400)
    required = [f for f in ds.dimensions + ds.values if f.required and f.key not in column_map]
    if required:
        raise WorkflowError("bad_mapping", "Map the required fields: " + ", ".join(f.label for f in required) + ".", 400)
    if "period_date" not in column_map:
        if "fiscal_year" not in column_map or (grain != "Y" and "period_no" not in column_map):
            raise WorkflowError("bad_mapping", "Map a date column, or the financial year and period columns.", 400)
    if not any(f.key in column_map for f in ds.values):
        raise WorkflowError("bad_mapping", "Map at least one value column.", 400)


def stage(db: Session, batch: UploadBatch, archive: Path, sheet: str, header_row: int, column_map: dict[str, str]) -> dict:
    ds = importer.dataset(batch.dataset_type)
    headers, rows = importer.iter_sheet(archive, sheet, header_row)
    check_mapping(ds, batch.period_grain, headers, column_map)
    db.execute(delete(StagingRow).where(StagingRow.batch_id == batch.id))
    buffer: list[dict] = []
    count = 0
    for row_no, cells in rows:
        count += 1
        if count > importer.MAX_ROWS:
            raise WorkflowError("too_many_rows", f"The sheet has more than {importer.MAX_ROWS:,} rows.", 400)
        buffer.append({"batch_id": batch.id, "row_no": row_no, "raw": dumps(cells), "mapped": "{}", "errors": "[]",
                       "excluded": False, "edited": False})
        if len(buffer) >= CHUNK:
            db.execute(insert(StagingRow), buffer)
            buffer = []
    if buffer:
        db.execute(insert(StagingRow), buffer)
    if count == 0:
        raise WorkflowError("empty_sheet", "No data rows were found under the header row.", 400)
    batch.sheet_name, batch.header_row, batch.column_map = sheet, header_row, dumps(column_map)
    return revalidate(db, batch, auto_exclude_duplicates=True)


def save_template(db: Session, batch: UploadBatch, user: User) -> None:
    t = db.scalar(select(ImportTemplate).where(ImportTemplate.dataset_type == batch.dataset_type,
                                               ImportTemplate.source_name == batch.source_name))
    if t is None:
        t = ImportTemplate(dataset_type=batch.dataset_type, source_name=batch.source_name, created_by=user.id)
        db.add(t)
    t.sheet_name, t.header_row, t.column_map = batch.sheet_name, batch.header_row, batch.column_map
    db.flush()
    batch.template_id = t.id


def _parse_all(db: Session, batch: UploadBatch) -> tuple[list[tuple[StagingRow, Parsed | None, list[Issue]]], Validator]:
    ds = importer.dataset(batch.dataset_type)
    validator = Validator(ds, batch.period_grain, json.loads(batch.column_map), Lookups.load(db))
    out = []
    for r in db.scalars(select(StagingRow).where(StagingRow.batch_id == batch.id).order_by(StagingRow.row_no)):
        parsed, issues = validator.validate(json.loads(r.raw), json.loads(r.mapped))
        out.append((r, parsed, issues))
    return out, validator


def revalidate(db: Session, batch: UploadBatch, auto_exclude_duplicates: bool = False) -> dict:
    ds = importer.dataset(batch.dataset_type)
    results, _ = _parse_all(db, batch)
    considered = {r.row_no: p for r, p, _ in results if p is not None and (auto_exclude_duplicates or not r.excluded)}
    dupes = importer.duplicate_issues(ds, considered)

    updates = []
    for r, _, issues in results:
        issues = issues + dupes.get(r.row_no, [])
        excluded = r.excluded
        if auto_exclude_duplicates and any(i.code == "duplicate" for i in issues):
            excluded = True
        updates.append({"id": r.id, "errors": dumps([i.as_dict() for i in issues]), "excluded": excluded})
        r.excluded = excluded
    for i in range(0, len(updates), CHUNK):
        db.execute(update(StagingRow), updates[i:i + CHUNK])

    included = [(r, p, issues + dupes.get(r.row_no, [])) for r, p, issues in results if not r.excluded]
    blocking = sum(1 for _, _, iss in included if any(i.severity == "error" for i in iss))
    warnings = sum(1 for _, _, iss in included if iss and not any(i.severity == "error" for i in iss))
    good = [p for _, p, iss in included if p is not None and not any(i.severity == "error" for i in iss)]
    periods = importer.period_summary(ds, batch.period_grain, good)
    issue_counts: dict[str, int] = defaultdict(int)
    for _, _, iss in included:
        for code in {i.code for i in iss}:
            issue_counts[code] += 1

    summary = {
        "total_rows": len(results),
        "included_rows": len(included),
        "excluded_rows": len(results) - len(included),
        "error_rows": blocking,
        "warning_rows": warnings,
        "ready_rows": len(good),
        "issue_counts": dict(issue_counts),
        "periods": periods,
        "value_field": importer.primary_value(ds),
        "can_submit": blocking == 0 and len(good) > 0,
    }
    batch.summary = dumps(summary)
    batch.row_count = len(good)
    batch.fy_from = min((p["fy"] for p in periods), default=None)
    batch.fy_to = max((p["fy"] for p in periods), default=None)
    return summary


def edit_row(db: Session, batch: UploadBatch, row_no: int, values: dict | None, excluded: bool | None) -> dict:
    row = db.scalar(select(StagingRow).where(StagingRow.batch_id == batch.id, StagingRow.row_no == row_no))
    if row is None:
        raise WorkflowError("not_found", "Row not found.", 404)
    if values:
        ds = importer.dataset(batch.dataset_type)
        allowed = {f.key for f in ds.fields}
        bad = set(values) - allowed
        if bad:
            raise WorkflowError("bad_field", f"Unknown field(s): {', '.join(sorted(bad))}.", 400)
        mapped = json.loads(row.mapped)
        mapped.update({k: (None if v is None else str(v)) for k, v in values.items()})
        row.mapped = dumps(mapped)
        row.edited = True
    if excluded is not None:
        row.excluded = excluded
    db.flush()
    return revalidate(db, batch)


# ------------------------------------------------------------------ submit / approve


def submit(db: Session, batch: UploadBatch) -> dict:
    if batch.status != "draft":
        raise WorkflowError("not_draft", "Only drafts can be submitted.")
    summary = revalidate(db, batch)
    if not summary["can_submit"]:
        raise WorkflowError("has_errors", f"{summary['error_rows']} row(s) still have errors. Fix or exclude them first.")
    batch.status = "submitted"
    batch.current_level = 1
    batch.submitted_at = clock.now()
    return summary


def can_act_on(db: Session, batch: UploadBatch, user: User) -> bool:
    levels = levels_for(db, batch.dataset_type)
    if batch.status != "submitted" or not 1 <= batch.current_level <= len(levels):
        return False
    return Role(user.role).at_least(Role(levels[batch.current_level - 1]))


def _check_actor(db: Session, batch: UploadBatch, user: User) -> None:
    if batch.status != "submitted":
        raise WorkflowError("not_submitted", "This upload is not waiting for approval.")
    if batch.uploaded_by == user.id:
        raise WorkflowError("own_upload", "You cannot approve or reject your own upload. Another approver must do it.", 403)
    if not can_act_on(db, batch, user):
        raise WorkflowError("wrong_level", "This approval step needs a user with a higher role.", 403)


def reject(db: Session, batch: UploadBatch, user: User, comment: str) -> None:
    _check_actor(db, batch, user)
    if len(comment.strip()) < 3:
        raise WorkflowError("comment_required", "Give a reason so the uploader knows what to fix.", 400)
    db.add(ApprovalDecision(batch_id=batch.id, level_no=batch.current_level, user_id=user.id, decision="rejected",
                            comment=comment.strip()))
    batch.status = "rejected"
    batch.decided_at = clock.now()


def approve(db: Session, batch: UploadBatch, user: User, comment: str) -> bool:
    """Record this level's approval. Returns True when it was the final level and the data is now live."""
    _check_actor(db, batch, user)
    levels = levels_for(db, batch.dataset_type)
    db.add(ApprovalDecision(batch_id=batch.id, level_no=batch.current_level, user_id=user.id, decision="approved",
                            comment=comment.strip()))
    if batch.current_level < len(levels):
        batch.current_level += 1
        return False
    finalize(db, batch)
    return True


def replaced_versions(db: Session, dataset_type: str, months: set[tuple[int, int]]) -> list[dict]:
    """Which approved uploads currently provide the given months (shown to the approver)."""
    if not months:
        return []
    fys = {fy for fy, _ in months}
    rows = db.execute(select(PeriodVersion.fy, PeriodVersion.fiscal_month, PeriodVersion.batch_id).where(
        PeriodVersion.dataset_type == dataset_type, PeriodVersion.valid_to.is_(None), PeriodVersion.fy.in_(fys))).all()
    by_batch: dict[int, list[tuple[int, int]]] = defaultdict(list)
    for fy, m, b in rows:
        if (fy, m) in months:
            by_batch[b].append((fy, m))
    out = []
    for b, ms in sorted(by_batch.items()):
        old = db.get(UploadBatch, b)
        out.append({"batch_id": b, "original_filename": old.original_filename, "uploaded_by": old.uploaded_by,
                    "approved_at": old.decided_at, "months": len(ms)})
    return out


def finalize(db: Session, batch: UploadBatch) -> None:
    ds = importer.dataset(batch.dataset_type)
    results, _ = _parse_all(db, batch)
    included = [(r, p, iss) for r, p, iss in results if not r.excluded]
    if any(p is None or any(i.severity == "error" for i in iss) for _, p, iss in included):
        raise WorkflowError("no_longer_valid", "Some rows no longer pass the checks (for example a code mapping was "
                            "removed). Reject the upload so it can be corrected.")
    parsed = [(r.row_no, p) for r, p, _ in included]
    periods = {(p.fy, p.period_no) for _, p in parsed}
    months = importer.months_covered(batch.period_grain, periods)
    now = clock.now()

    # A coarser period stored earlier (e.g. a whole quarter) must be replaced completely, never partly.
    current = db.execute(select(PeriodVersion.fy, PeriodVersion.fiscal_month, PeriodVersion.batch_id).where(
        PeriodVersion.dataset_type == batch.dataset_type, PeriodVersion.valid_to.is_(None))).all()
    current_by_batch: dict[int, set[tuple[int, int]]] = defaultdict(set)
    for fy, m, b in current:
        current_by_batch[b].add((fy, m))
    for old_id, old_months in current_by_batch.items():
        old = db.get(UploadBatch, old_id)
        for fy, m in old_months & months:
            whole = {(fy, x) for x in fiscal.months_of(old.period_grain, fiscal.period_of_month(old.period_grain, m))}
            if not whole <= months:
                label = fiscal.period_label(fy, old.period_grain, fiscal.period_of_month(old.period_grain, m))
                raise WorkflowError("partial_period", f"{label} is stored as one period (upload #{old_id}). This upload "
                                    "covers only part of it. Upload the whole period to replace it.")

    affected: set[int] = set()
    for fy, m in months:
        for pv in db.scalars(select(PeriodVersion).where(PeriodVersion.dataset_type == batch.dataset_type,
                                                         PeriodVersion.fy == fy, PeriodVersion.fiscal_month == m,
                                                         PeriodVersion.valid_to.is_(None))):
            pv.valid_to = now
            affected.add(pv.batch_id)
    db.flush()
    db.execute(insert(PeriodVersion), [{"dataset_type": batch.dataset_type, "fy": fy, "fiscal_month": m,
                                        "batch_id": batch.id, "valid_from": now} for fy, m in sorted(months)])
    for old_id in affected:
        still_current = db.scalar(select(PeriodVersion.id).where(PeriodVersion.batch_id == old_id,
                                                                 PeriodVersion.valid_to.is_(None)).limit(1))
        if still_current is None:
            db.get(UploadBatch, old_id).status = "superseded"

    _load_facts(db, batch, ds, parsed)
    batch.status = "approved"
    batch.decided_at = now


def _load_facts(db: Session, batch: UploadBatch, ds, parsed: list[tuple[int, Parsed]]) -> None:
    common = {"batch_id": batch.id, "period_grain": batch.period_grain, "is_demo": batch.is_demo}
    rows: list[dict] = []
    if ds.fact_table == "sales":
        model = SalesFact
        for row_no, p in parsed:
            rows.append({**common, "staging_row_no": row_no, "fy": p.fy, "period_no": p.period_no,
                         "customer_code": p.dims["customer_code"], "material_code": p.dims["material_code"],
                         "oem_id": p.refs.get("oem_id"), "product_id": p.refs.get("product_id"),
                         "segment_id": p.refs.get("segment_id"), "division_id": p.refs.get("division_id"),
                         "quantity": p.values.get("quantity"), "amount_paise": p.values["amount"]})
    elif ds.fact_table == "receivable":
        model = ReceivableFact
        for row_no, p in parsed:
            rows.append({**common, "staging_row_no": row_no, "fy": p.fy, "period_no": p.period_no,
                         "customer_code": p.dims["customer_code"], "oem_id": p.refs.get("oem_id"),
                         "ageing_bucket": p.dims["ageing_bucket"], "amount_paise": p.values["amount"]})
    else:
        model = MetricFact
        for row_no, p in parsed:
            for metric, value in p.values.items():
                rows.append({**common, "staging_row_no": row_no, "fy": p.fy, "period_no": p.period_no,
                             "dataset_type": ds.key, "metric": metric, "category": p.dims.get("category"),
                             "division_id": p.refs.get("division_id"), "value": value})
    for i in range(0, len(rows), CHUNK):
        db.execute(insert(model), rows[i:i + CHUNK])


# ------------------------------------------------------------------ overrides

FACT_MODELS = {"sales_facts": SalesFact, "metric_facts": MetricFact, "receivable_facts": ReceivableFact}
OVERRIDABLE = {"sales_facts": {"amount_paise": "money", "quantity": "count"},
               "metric_facts": {"value": "metric"}, "receivable_facts": {"amount_paise": "money"}}


def apply_override(db: Session, user: User, fact_table: str, fact_id: int, field: str, new_value: str, reason: str) -> Override:
    if fact_table not in FACT_MODELS or field not in OVERRIDABLE[fact_table]:
        raise WorkflowError("not_overridable", "That value cannot be overridden.", 400)
    if len(reason.strip()) < 5:
        raise WorkflowError("reason_required", "Give a reason of at least a few words.", 400)
    fact = db.get(FACT_MODELS[fact_table], fact_id)
    if fact is None:
        raise WorkflowError("not_found", "Value not found.", 404)
    batch = db.get(UploadBatch, fact.batch_id)
    if batch.status != "approved":
        raise WorkflowError("not_current", "Only values from current approved data can be overridden.")
    kind = OVERRIDABLE[fact_table][field]
    if kind == "metric":
        kind = next(f.kind for f in importer.dataset(fact.dataset_type).values if f.key == fact.metric)
    try:
        parsed = to_paise(new_value) if kind == "money" else to_count(new_value)
    except MoneyParseError as exc:
        raise WorkflowError("bad_number", f'"{new_value}" is not a valid number.', 400) from exc
    old = getattr(fact, field)
    show = (lambda v: str(paise_to_rupees(v)) if v is not None else "") if kind == "money" else (lambda v: str(v))
    setattr(fact, field, parsed)
    ov = Override(batch_id=batch.id, fact_table=fact_table, fact_id=fact_id, field=field, old_value=show(old),
                  new_value=show(parsed), reason=reason.strip(), user_id=user.id)
    db.add(ov)
    db.flush()
    return ov
