"""Live report aggregates calculated from the current approved sales facts."""
from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_db, require
from app.core import fiscal, regions
from app.core.permissions import Perm
from app.models import MetricFact, PeriodVersion, Product, ReceivableFact, SalesFact

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
    year_totals: dict[int, int] = defaultdict(int)
    # Quarter totals per year (Q1 = Apr-Jun). Yearly-grain facts cannot be split into quarters.
    quarter_totals: dict[int, list[int]] = defaultdict(lambda: [0, 0, 0, 0])
    for fact, _ in all_rows:
        year_totals[fact.fy] += fact.amount_paise
        if fact.period_grain != "Y":
            first_month = fiscal.months_of(fact.period_grain, fact.period_no)[0]
            quarter_totals[fact.fy][fiscal.period_of_month("Q", first_month) - 1] += fact.amount_paise
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
        "available_fys": available_fys,
        "years": [{"fy": y, "label": fiscal.fy_label(y), "amount_paise": year_totals[y],
                   "quarters": quarter_totals[y]} for y in available_fys],
        "total_paise": total_paise, "total_units": total_units,
        "row_count": len(rows), "billing_documents": len(document_ids),
        "periods": [periods[key] for key in sorted(periods)], "products": product_rows,
        "channels": ranked(channels), "employees": ranked(employees), "customers": ranked(customers)[:20],
    }


@router.get("/region-summary")
def region_summary(
    fy: int | None = Query(default=None),
    _: Principal = Depends(can_view),
    db: Session = Depends(get_db),
) -> dict:
    """Sales by sales zone (from the GST state code in the Region column), per quarter, with the previous year."""
    all_rows = _current_sales(db, None)
    available_fys = sorted({fact.fy for fact, _ in all_rows})
    selected_fy = fy if fy is not None else (available_fys[-1] if available_fys else None)

    def blank() -> dict:
        return {"quarters": [0, 0, 0, 0], "total_paise": 0}

    years: dict[int, dict[str, dict]] = {}
    states: dict[str, dict] = {}
    for fact, _ in all_rows:
        if selected_fy is None or fact.fy not in (selected_fy, selected_fy - 1):
            continue
        code, state, zone = regions.lookup(fact.region)
        bucket = years.setdefault(fact.fy, {}).setdefault(zone, blank())
        bucket["total_paise"] += fact.amount_paise
        if fact.period_grain != "Y":
            first_month = fiscal.months_of(fact.period_grain, fact.period_no)[0]
            bucket["quarters"][fiscal.period_of_month("Q", first_month) - 1] += fact.amount_paise
        key = code or "--"
        item = states.setdefault(key, {"code": code, "state": state, "zone": zone, "amount_paise": 0, "prev_amount_paise": 0})
        item["amount_paise" if fact.fy == selected_fy else "prev_amount_paise"] += fact.amount_paise

    def zones_of(year: int | None) -> list[dict] | None:
        if year is None or year not in years:
            return None
        found = years[year]
        order = [*regions.ZONES, *([regions.UNASSIGNED] if regions.UNASSIGNED in found else [])]
        return [{"zone": z, **found.get(z, blank())} for z in order]

    return {
        "fy": selected_fy,
        "available_fys": available_fys,
        "zones": zones_of(selected_fy) or [],
        "previous": zones_of(selected_fy - 1 if selected_fy is not None else None),
        "states": sorted(states.values(), key=lambda s: s["amount_paise"], reverse=True),
    }


# ------------------------------------------------------------------ executive dashboard


def _current_facts(db: Session, model, dataset: str) -> list:
    """Facts of `model` from the current (latest published) version of each month of `dataset`."""
    current = {(p.fy, p.fiscal_month, p.batch_id) for p in db.scalars(
        select(PeriodVersion).where(PeriodVersion.dataset_type == dataset, PeriodVersion.valid_to.is_(None))
    )}
    if not current:
        return []
    query = select(model).where(model.batch_id.in_({b for _, _, b in current}))
    if model is MetricFact:
        query = query.where(MetricFact.dataset_type == dataset)
    return [f for f in db.scalars(query)
            if any((f.fy, m, f.batch_id) in current for m in fiscal.months_of(f.period_grain, f.period_no))]


def _last_month(fact) -> int:
    return fiscal.months_of(fact.period_grain, fact.period_no)[-1]


def _same_months(sales, selected: int) -> dict[str, int]:
    """Previous year's product sales over the months the selected year has data for (like for like)."""
    covered = {m for f, _ in sales if f.fy == selected for m in fiscal.months_of(f.period_grain, f.period_no)}
    out: dict[str, int] = defaultdict(int)
    for fact, mapped in sales:
        if fact.fy == selected - 1 and fiscal.months_of(fact.period_grain, fact.period_no)[0] in covered:
            out[fact.product_name or mapped or fact.material_code or "Unclassified"] += fact.amount_paise
    return dict(out)


@router.get("/dashboard")
def dashboard(
    fy: int | None = Query(default=None),
    _: Principal = Depends(can_view),
    db: Session = Depends(get_db),
) -> dict:
    """Everything the executive dashboard shows. Figures whose source data is not uploaded are null."""
    sales = _current_sales(db, None)
    available_fys = sorted({f.fy for f, _ in sales})
    selected = fy if fy is not None else (available_fys[-1] if available_fys else None)

    yearly: dict[int, int] = defaultdict(int)
    months: dict[int, list[int]] = defaultdict(lambda: [0] * 12)
    products: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for fact, mapped in sales:
        yearly[fact.fy] += fact.amount_paise
        months[fact.fy][fiscal.months_of(fact.period_grain, fact.period_no)[0] - 1] += fact.amount_paise
        products[fact.fy][fact.product_name or mapped or fact.material_code or "Unclassified"] += fact.amount_paise

    # Flows are summed over the year; stocks (equity, receivables) use the year's last reported period.
    flows: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for dataset in ("pnl", "cash_flow"):
        for f in _current_facts(db, MetricFact, dataset):
            flows[f.fy][f.metric] += f.value
    def closing(facts, value) -> dict[int, int]:
        last: dict[int, int] = {}
        out: dict[int, int] = defaultdict(int)
        for f in facts:
            last[f.fy] = max(last.get(f.fy, 0), _last_month(f))
        for f in facts:
            if _last_month(f) == last[f.fy]:
                out[f.fy] += value(f)
        return out
    equity = closing([f for f in _current_facts(db, MetricFact, "balance_sheet") if f.metric == "total_equity"], lambda f: f.value)
    receivables = closing(_current_facts(db, ReceivableFact, "receivables"), lambda f: f.amount_paise)
    receivable_month = {f.fy: _last_month(f) for f in _current_facts(db, ReceivableFact, "receivables")}
    forecast: dict[int, list[int]] = defaultdict(lambda: [0] * 12)
    has_forecast: set[int] = set()
    for f in _current_facts(db, MetricFact, "forecast"):
        if f.metric == "revenue_forecast":
            forecast[f.fy][fiscal.months_of(f.period_grain, f.period_no)[0] - 1] += f.value
            has_forecast.add(f.fy)

    def year_metrics(y: int) -> dict:
        fl = flows.get(y, {})
        has_pnl = "revenue" in fl
        op = fl["revenue"] - fl.get("cogs", 0) - fl.get("opex", 0) - fl.get("depreciation_amortisation", 0) if has_pnl else None
        fcf = fl["operating_cash_flow"] - fl.get("capex", 0) if "operating_cash_flow" in fl else None
        roe = (fl["net_income"] * 100 / equity[y]) if "net_income" in fl and equity.get(y) else None
        dso = None
        if y in receivables and yearly.get(y):
            # Receivables at the period end against sales up to that month, scaled to days.
            upto = receivable_month[y]
            sold = sum(months[y][:upto])
            if sold:
                dso = receivables[y] * (upto * 365 / 12) / sold
        return {"fy": y, "sales_paise": yearly.get(y, 0), "operating_profit_paise": op, "free_cash_flow_paise": fcf,
                "roe_pct": roe, "dso_days": dso}

    every_fy = sorted(set(available_fys) | set(flows) | set(equity) | set(receivables))
    return {
        "fy": selected,
        "available_fys": available_fys,
        "years": [year_metrics(y) for y in every_fy],
        "months": {"current": months[selected] if selected is not None else [0] * 12,
                   "previous": months[selected - 1] if selected is not None and (selected - 1) in yearly else None,
                   "forecast": forecast[selected] if selected in has_forecast else None},
        "products": {"current": dict(products.get(selected, {})) if selected is not None else {},
                     "previous": dict(products.get(selected - 1, {})) if selected is not None else {},
                     "previous_same_months": _same_months(sales, selected) if selected is not None else {}},
    }


# ------------------------------------------------------------------ historical reports


@router.get("/history")
def history(_: Principal = Depends(can_view), db: Session = Depends(get_db)) -> dict:
    """Month-by-month sales measures for every financial year, plus per-year product and regional splits."""
    sales = _current_sales(db, None)
    revenue: dict[int, list[int]] = defaultdict(lambda: [0] * 12)
    units: dict[int, list[int]] = defaultdict(lambda: [0] * 12)
    invoices: dict[int, list[set]] = defaultdict(lambda: [set() for _ in range(12)])
    products: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    zones: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for fact, mapped in sales:
        m = fiscal.months_of(fact.period_grain, fact.period_no)[0] - 1
        revenue[fact.fy][m] += fact.amount_paise
        units[fact.fy][m] += fact.quantity or 0
        if fact.billing_document:
            invoices[fact.fy][m].add(fact.billing_document)
        products[fact.fy][fact.product_name or mapped or fact.material_code or "Unclassified"] += fact.amount_paise
        zones[fact.fy][regions.lookup(fact.region)[2]] += fact.amount_paise
    return {
        "years": [
            {
                "fy": y,
                "label": fiscal.fy_label(y),
                "revenue": revenue[y],
                "units": units[y],
                "invoices": [len(s) for s in invoices[y]],
                "products": dict(sorted(products[y].items(), key=lambda kv: kv[1], reverse=True)),
                "zones": dict(zones[y]),
            }
            for y in sorted(revenue)
        ],
    }


# ------------------------------------------------------------------ actual vs forecast


@router.get("/forecast-vs-actual")
def forecast_vs_actual(_: Principal = Depends(can_view), db: Session = Depends(get_db)) -> dict:
    """Monthly actual sales and revenue forecast per financial year (paise, fiscal months Apr first).

    A forecast stored per quarter or year is spread evenly over its months.
    """
    actual: dict[int, list[int]] = defaultdict(lambda: [0] * 12)
    for fact, _ in _current_sales(db, None):
        actual[fact.fy][fiscal.months_of(fact.period_grain, fact.period_no)[0] - 1] += fact.amount_paise
    forecast: dict[int, list[int]] = defaultdict(lambda: [0] * 12)
    for f in _current_facts(db, MetricFact, "forecast"):
        if f.metric != "revenue_forecast":
            continue
        months = list(fiscal.months_of(f.period_grain, f.period_no))
        for m in months:
            forecast[f.fy][m - 1] += round(f.value / len(months))
    years = sorted(set(actual) | set(forecast))
    return {
        "has_forecast": bool(forecast),
        "years": [{"fy": y, "actual": actual[y], "forecast": forecast[y] if y in forecast else None} for y in years],
    }


# ------------------------------------------------------------------ expenses


@router.get("/expenses-summary")
def expenses_summary(_: Principal = Depends(can_view), db: Session = Depends(get_db)) -> dict:
    """Monthly expenses per financial year (paise, fiscal months Apr first), plus totals by category.

    Expenses stored per quarter or year are spread evenly over their months.
    """
    months: dict[int, list[int]] = defaultdict(lambda: [0] * 12)
    categories: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for f in _current_facts(db, MetricFact, "expenses"):
        span = list(fiscal.months_of(f.period_grain, f.period_no))
        for m in span:
            months[f.fy][m - 1] += round(f.value / len(span))
        categories[f.fy][f.category or "Uncategorised"] += f.value
    return {"years": [{"fy": y, "months": months[y], "categories": dict(categories[y])} for y in sorted(months)]}


# ------------------------------------------------------------------ margins


@router.get("/margins")
def margins(_: Principal = Depends(can_view), db: Session = Depends(get_db)) -> dict:
    """Yearly revenue (sales register) and Profit & Loss lines, for the margins screen.

    `pnl` is null for years without an uploaded Profit and loss; the screen leaves those figures empty.
    """
    sales: dict[int, int] = defaultdict(int)
    months: dict[int, set[int]] = defaultdict(set)
    for fact, _ in _current_sales(db, None):
        sales[fact.fy] += fact.amount_paise
        months[fact.fy].update(fiscal.months_of(fact.period_grain, fact.period_no))
    pnl: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for f in _current_facts(db, MetricFact, "pnl"):
        pnl[f.fy][f.metric] += f.value
    years = sorted(set(sales) | set(pnl))
    return {"years": [{"fy": y, "sales_paise": sales.get(y, 0), "sales_months": len(months[y]),
                       "pnl": dict(pnl[y]) if y in pnl else None} for y in years]}


@router.get("/balance-sheet")
def balance_sheet(_: Principal = Depends(can_view), db: Session = Depends(get_db)) -> dict:
    """Latest reported balance-sheet values per metric and financial year."""
    facts = _current_facts(db, MetricFact, "balance_sheet")
    latest: dict[tuple[int, str], int] = {}
    for fact in facts:
        key = (fact.fy, fact.metric)
        latest[key] = max(latest.get(key, 0), _last_month(fact))

    values: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for fact in facts:
        if _last_month(fact) == latest[(fact.fy, fact.metric)]:
            values[fact.fy][fact.metric] += fact.value
    return {"years": [{"fy": fy, "values": dict(values[fy])} for fy in sorted(values)]}
