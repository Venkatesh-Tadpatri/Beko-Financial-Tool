"""Registry of importable dataset types.

Each dataset type declares its fields once; the mapping wizard, validator,
fact loader and Excel export all read this registry. The *period grain*
(M / Q / Y) is not here: it is a runtime setting per dataset type
(table dataset_settings) so cadence can change without code changes.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

FieldKind = Literal["text", "money", "count", "date", "int"]
FactTable = Literal["sales", "metric", "receivable"]


@dataclass(frozen=True)
class FieldDef:
    key: str
    label: str
    kind: FieldKind
    required: bool = True
    negative_ok: bool = False  # if False, a negative value is flagged for review


# Period columns shared by every dataset. Validation requires either a date
# inside the period, or fiscal_year (+ period_no unless the grain is Y).
PERIOD_FIELDS: tuple[FieldDef, ...] = (
    FieldDef("period_date", "Posting / period date", "date", required=False),
    FieldDef("fiscal_year", "Financial year (start year, e.g. 2025 or FY2025-26)", "text", required=False),
    FieldDef("period_no", "Period number (month 1=Apr, quarter 1..4)", "int", required=False),
)


@dataclass(frozen=True)
class DatasetDef:
    key: str
    label: str
    fact_table: FactTable
    dimensions: tuple[FieldDef, ...]
    values: tuple[FieldDef, ...]
    default_grain: str = "M"

    @property
    def fields(self) -> tuple[FieldDef, ...]:
        return PERIOD_FIELDS + self.dimensions + self.values

    def field(self, key: str) -> FieldDef:
        for f in self.fields:
            if f.key == key:
                return f
        raise KeyError(key)


_DIVISION = FieldDef("division_code", "Division code", "text", required=False)

DATASETS: dict[str, DatasetDef] = {
    d.key: d
    for d in (
        DatasetDef(
            "sales",
            "Sales (SAP)",
            "sales",
            dimensions=(
                FieldDef("customer_code", "SAP customer code", "text"),
                FieldDef("material_code", "SAP material code", "text"),
            ),
            values=(
                FieldDef("amount", "Net sales value (₹)", "money"),
                FieldDef("quantity", "Quantity", "count", required=False),
            ),
        ),
        DatasetDef(
            "expenses",
            "Expenses",
            "metric",
            dimensions=(FieldDef("category", "Expense category", "text"), _DIVISION),
            values=(FieldDef("expense", "Expense amount (₹)", "money"),),
        ),
        DatasetDef(
            "pnl",
            "Profit and loss",
            "metric",
            dimensions=(_DIVISION,),
            values=(
                FieldDef("revenue", "Revenue (₹)", "money"),
                FieldDef("cogs", "Cost of goods sold (₹)", "money"),
                FieldDef("opex", "Operating expenses excl. D&A (₹)", "money"),
                FieldDef("depreciation_amortisation", "Depreciation & amortisation (₹)", "money", required=False),
                FieldDef("interest", "Interest (₹)", "money", required=False),
                FieldDef("tax", "Tax (₹)", "money", required=False, negative_ok=True),
                FieldDef("net_income", "Net income (₹)", "money", required=False, negative_ok=True),
            ),
        ),
        DatasetDef(
            "cash_flow",
            "Cash flow",
            "metric",
            dimensions=(),
            values=(
                FieldDef("operating_cash_flow", "Operating cash flow (₹)", "money", negative_ok=True),
                FieldDef("capex", "Capital expenditure (₹)", "money"),
                FieldDef("net_cash_flow", "Net change in cash (₹)", "money", required=False, negative_ok=True),
                FieldDef("cash_balance", "Closing cash balance (₹)", "money"),
            ),
        ),
        DatasetDef(
            "balance_sheet",
            "Balance sheet",
            "metric",
            dimensions=(),
            values=(
                FieldDef("total_equity", "Total equity (₹)", "money", negative_ok=True),
                FieldDef("total_debt", "Total debt (₹)", "money", required=False),
                FieldDef("invested_capital", "Invested capital (₹)", "money", required=False),
            ),
            default_grain="Q",
        ),
        DatasetDef(
            "shares",
            "Shares",
            "metric",
            dimensions=(),
            values=(
                FieldDef("weighted_avg_shares", "Weighted average shares", "count"),
                FieldDef("shares_outstanding", "Shares outstanding", "count", required=False),
            ),
            default_grain="Q",
        ),
        DatasetDef(
            "receivables",
            "Receivables ageing",
            "receivable",
            dimensions=(
                FieldDef("customer_code", "SAP customer code", "text"),
                FieldDef("ageing_bucket", "Ageing bucket (0-30, 31-60, 61-90, 90+)", "text"),
            ),
            values=(FieldDef("amount", "Outstanding amount (₹)", "money"),),
        ),
        DatasetDef(
            "forecast",
            "Forecast",
            "metric",
            dimensions=(_DIVISION,),
            values=(
                FieldDef("revenue_forecast", "Revenue forecast (₹)", "money", required=False),
                FieldDef("ebitda_forecast", "EBITDA forecast (₹)", "money", required=False, negative_ok=True),
            ),
        ),
    )
}

AGEING_BUCKETS = ("0-30", "31-60", "61-90", "90+")
