"""Master data: divisions, segments, products, OEMs, SAP code mappings, sales engineers.

Reading is open to every signed-in role (reports and the upload preview need
names). Changing requires Admin. Rows are deactivated, never deleted, so
history keeps its meaning.

When an SAP code mapping changes, the already-approved facts that use that code
are re-pointed in the same transaction, so reports always follow the current
mapping, and the number of rows affected is written to the audit log.
"""

# No `from __future__ import annotations` here: route signatures below use request
# models chosen at runtime, which FastAPI must see as real objects, not strings.
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_db, require
from app.core.permissions import Perm
from app.models import (
    Division,
    EngineerAssignment,
    Oem,
    Product,
    ReceivableFact,
    SalesEngineer,
    SalesFact,
    SapCustomerMap,
    SapMaterialMap,
    Segment,
)
from app.services import audit

router = APIRouter(prefix="/api/master", tags=["master"])
can_view = require(Perm.VIEW_REPORTS)
can_edit_master = require(Perm.MANAGE_MASTER_DATA)
can_edit_mappings = require(Perm.MANAGE_MAPPINGS)


def _err(code: int, key: str, message: str) -> HTTPException:
    return HTTPException(code, detail={"code": key, "message": message})


class _Code(BaseModel):
    @field_validator("code", "customer_code", "material_code", check_fields=False)
    @classmethod
    def _clean_code(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not v or len(v) > 40:
            raise ValueError("code must be 1-40 characters")
        return v


class NamedIn(_Code):
    code: str
    name: str = Field(min_length=1, max_length=128)
    is_active: bool = True


class NamedPatch(_Code):
    code: str | None = None
    name: str | None = Field(default=None, min_length=1, max_length=128)
    is_active: bool | None = None


class ProductIn(NamedIn):
    division_id: int
    segment_id: int


class ProductPatch(NamedPatch):
    division_id: int | None = None
    segment_id: int | None = None


class CustomerMapIn(_Code):
    customer_code: str
    customer_name: str = Field(default="", max_length=128)
    oem_id: int
    is_active: bool = True


class CustomerMapPatch(_Code):
    customer_code: str | None = None
    customer_name: str | None = Field(default=None, max_length=128)
    oem_id: int | None = None
    is_active: bool | None = None


class MaterialMapIn(_Code):
    material_code: str
    description: str = Field(default="", max_length=255)
    product_id: int
    is_active: bool = True


class MaterialMapPatch(_Code):
    material_code: str | None = None
    description: str | None = Field(default=None, max_length=255)
    product_id: int | None = None
    is_active: bool | None = None


class EngineerIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    email: str = Field(default="", max_length=255)
    phone: str = Field(default="", max_length=32)
    is_available: bool = True
    unavailable_from: date | None = None
    unavailable_to: date | None = None
    notes: str = Field(default="", max_length=500)
    is_active: bool = True


class EngineerPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    email: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=32)
    is_available: bool | None = None
    unavailable_from: date | None = None
    unavailable_to: date | None = None
    notes: str | None = Field(default=None, max_length=500)
    is_active: bool | None = None


class AssignmentIn(BaseModel):
    engineer_id: int
    oem_id: int | None = None
    division_id: int | None = None
    start_date: date
    end_date: date | None = None
    is_active: bool = True


class AssignmentPatch(BaseModel):
    oem_id: int | None = None
    division_id: int | None = None
    start_date: date | None = None
    end_date: date | None = None
    is_active: bool | None = None


ENTITIES: dict[str, dict[str, Any]] = {
    "divisions": {"model": Division, "create": NamedIn, "patch": NamedPatch, "perm": can_edit_master, "order": Division.code},
    "segments": {"model": Segment, "create": NamedIn, "patch": NamedPatch, "perm": can_edit_master, "order": Segment.code},
    "products": {"model": Product, "create": ProductIn, "patch": ProductPatch, "perm": can_edit_master, "order": Product.code},
    "oems": {"model": Oem, "create": NamedIn, "patch": NamedPatch, "perm": can_edit_master, "order": Oem.code},
    "customer-map": {"model": SapCustomerMap, "create": CustomerMapIn, "patch": CustomerMapPatch, "perm": can_edit_mappings,
                     "order": SapCustomerMap.customer_code},
    "material-map": {"model": SapMaterialMap, "create": MaterialMapIn, "patch": MaterialMapPatch, "perm": can_edit_mappings,
                     "order": SapMaterialMap.material_code},
    "engineers": {"model": SalesEngineer, "create": EngineerIn, "patch": EngineerPatch, "perm": can_edit_master,
                  "order": SalesEngineer.name},
    "assignments": {"model": EngineerAssignment, "create": AssignmentIn, "patch": AssignmentPatch, "perm": can_edit_master,
                    "order": EngineerAssignment.start_date},
}

_HIDDEN = {"created_at", "updated_at"}


def to_dict(obj: Any) -> dict:
    return {c.key: getattr(obj, c.key) for c in obj.__table__.columns if c.key not in _HIDDEN}


def _check_refs(db: Session, data: dict) -> None:
    refs = {"division_id": Division, "segment_id": Segment, "oem_id": Oem, "product_id": Product, "engineer_id": SalesEngineer}
    for key, model in refs.items():
        if data.get(key) is not None and db.get(model, data[key]) is None:
            raise _err(400, "invalid_reference", f"{key.removesuffix('_id').replace('_', ' ').title()} {data[key]} does not exist.")
    if "start_date" in data and data.get("end_date") and data["start_date"] and data["end_date"] < data["start_date"]:
        raise _err(400, "invalid_dates", "The end date must be on or after the start date.")


def _flush(db: Session) -> None:
    try:
        db.flush()
    except IntegrityError as exc:
        msg = str(exc.orig).lower()
        if "unique" in msg:
            raise _err(409, "duplicate_code", "That code is already used by another entry.") from exc
        if "has_target" in msg:
            raise _err(400, "missing_target", "Choose an OEM or a division for the assignment.") from exc
        raise _err(400, "invalid", "The change breaks a data rule and was not saved.") from exc


def _repoint_facts(db: Session, entity: str, row: Any) -> int:
    """Keep approved facts in line with the current SAP code mapping. Returns rows changed."""
    if entity == "customer-map":
        n = db.execute(update(SalesFact).where(SalesFact.customer_code == row.customer_code)
                       .values(oem_id=row.oem_id)).rowcount
        n += db.execute(update(ReceivableFact).where(ReceivableFact.customer_code == row.customer_code)
                        .values(oem_id=row.oem_id)).rowcount
        return n
    if entity == "material-map":
        product = db.get(Product, row.product_id)
        return db.execute(update(SalesFact).where(SalesFact.material_code == row.material_code).values(
            product_id=product.id, segment_id=product.segment_id, division_id=product.division_id)).rowcount
    if entity == "products":
        return db.execute(update(SalesFact).where(SalesFact.product_id == row.id).values(
            segment_id=row.segment_id, division_id=row.division_id)).rowcount
    return 0


def _make_routes(entity: str, cfg: dict[str, Any]) -> None:
    model, create_model, patch_model, perm = cfg["model"], cfg["create"], cfg["patch"], cfg["perm"]

    def list_rows(_: Principal = Depends(can_view), db: Session = Depends(get_db)) -> list[dict]:
        return [to_dict(r) for r in db.scalars(select(model).order_by(cfg["order"]))]

    def create_row(body: create_model, p: Principal = Depends(perm), db: Session = Depends(get_db)) -> dict:  # type: ignore[valid-type]
        data = body.model_dump()
        _check_refs(db, data)
        row = model(**data)
        db.add(row)
        _flush(db)
        changed = _repoint_facts(db, entity, row)
        audit.record(db, "master_created", user=p.user, entity_type=entity, entity_id=row.id,
                     details={**{k: str(v) for k, v in data.items()}, **({"facts_updated": changed} if changed else {})})
        return to_dict(row)

    def update_row(row_id: int, body: patch_model, p: Principal = Depends(perm), db: Session = Depends(get_db)) -> dict:  # type: ignore[valid-type]
        row = db.get(model, row_id)
        if row is None:
            raise _err(404, "not_found", "Not found.")
        data = body.model_dump(exclude_unset=True)
        merged = {**to_dict(row), **data}
        _check_refs(db, merged)
        changes = {k: [str(getattr(row, k)), str(v)] for k, v in data.items() if getattr(row, k) != v}
        for k, v in data.items():
            setattr(row, k, v)
        _flush(db)
        if changes:
            changed = _repoint_facts(db, entity, row)
            audit.record(db, "master_updated", user=p.user, entity_type=entity, entity_id=row.id,
                         details={"changes": changes, **({"facts_updated": changed} if changed else {})})
        return to_dict(row)

    router.add_api_route(f"/{entity}", list_rows, methods=["GET"], name=f"list_{entity}")
    router.add_api_route(f"/{entity}", create_row, methods=["POST"], status_code=status.HTTP_201_CREATED,
                         name=f"create_{entity}")
    router.add_api_route(f"/{entity}/{{row_id}}", update_row, methods=["PATCH"], name=f"update_{entity}")


for _entity, _cfg in ENTITIES.items():
    _make_routes(_entity, _cfg)
