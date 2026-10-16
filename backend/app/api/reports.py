"""Live report aggregates calculated from the current approved sales facts."""
from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_db, require
from app.core import fiscal
from app.core.permissions import Perm
from app.models import PeriodVersion, Product, SalesFact

router = APIRouter(prefix="/api/reports", tags=["reports"])
can_view = require(Perm.VIEW_REPORTS)


def _current_sales(db: Session, fy: int | None) -> list[tuple[SalesFact, str | None]]:
    current = {(p.fy, p.fiscal_month, p.batch_id) for p in db.scalars(
        select(PeriodVersion).where(PeriodVersion.dataset_type == "sales", PeriodVersion.valid_to.is_(None))
    )}
    if not current:
        return []
    batch_ids = {batch for _, _, batch in current}
    query = select(SalesFact, Product.name).outerjoin(Product, Product.id == SalesFact.product_id).where(
        SalesFact.batch_id.in_(batch_ids)
    )
    if fy is not None:
        query = query.where(SalesFact.fy == fy)
    rows = []
    for fact, mapped_product in db.execute(query):
        months = fiscal.months_of(fact.period_grain, fact.period_no)
        if any((fact.fy, month, fact.batch_id) in current for month in months):
            rows.append((fact, mapped_product))
    return rows


@router.get("/sales-summary")
def sales_summary(
    fy: int | None = Query(default=None),
    _: Principal = Depends(can_view),
    db: Session = Depends(get_db),
) -> dict:
    all_rows = _current_sales(db, None)
    available_fys = sorted({fact.fy for fact, _ in all_rows})
    selected_fy = fy if fy is not None else (available_fys[-1] if available_fys else None)
    rows = [(fact, product) for fact, product in all_rows if selected_fy is None or fact.fy == selected_fy]

    products: dict[str, dict[str, int]] = defaultdict(lambda: {"amount_paise": 0, "units": 0})
    channels: dict[str, int] = defaultdict(int)
    employees: dict[str, int] = defaultdict(int)
    customers: dict[str, int] = defaultdict(int)
    periods: dict[tuple[int, int], dict[str, int | str]] = {}
    total_paise = total_units = 0
    document_ids: set[str] = set()

    for fact, mapped_product in rows:
        amount = fact.amount_paise
        units = fact.quantity or 0
        total_paise += amount
        total_units += units
        if fact.billing_document:
            document_ids.add(fact.billing_document)
        product = fact.product_name or mapped_product or fact.material_code or "Unclassified"
        products[product]["amount_paise"] += amount
        products[product]["units"] += units
        channels[fact.sales_channel or "Unclassified"] += amount
        employees[fact.sales_employee or "Unassigned"] += amount
        customers[fact.payer_name or fact.customer_code] += amount
        key = (fact.fy, fact.period_no)
        item = periods.setdefault(key, {"fy": fact.fy, "period_no": fact.period_no,
                                        "label": fiscal.period_label(fact.fy, fact.period_grain, fact.period_no),
                                        "amount_paise": 0, "units": 0})
        item["amount_paise"] = int(item["amount_paise"]) + amount
        item["units"] = int(item["units"]) + units

    def ranked(values: dict[str, int]) -> list[dict]:
        return [{"name": name, "amount_paise": amount, "share": round(amount * 100 / total_paise, 2) if total_paise else 0}
                for name, amount in sorted(values.items(), key=lambda item: item[1], reverse=True)]

    product_rows = [{"name": name, **value, "share": round(value["amount_paise"] * 100 / total_paise, 2) if total_paise else 0,
                     "average_unit_paise": round(value["amount_paise"] / value["units"]) if value["units"] else 0}
                    for name, value in sorted(products.items(), key=lambda item: item[1]["amount_paise"], reverse=True)]
    return {
        "fy": selected_fy, "fy_label": fiscal.fy_label(selected_fy) if selected_fy is not None else "No approved data",
        "available_fys": available_fys, "total_paise": total_paise, "total_units": total_units,
        "row_count": len(rows), "billing_documents": len(document_ids),
        "periods": [periods[key] for key in sorted(periods)], "products": product_rows,
        "channels": ranked(channels), "employees": ranked(employees), "customers": ranked(customers)[:20],
    }
