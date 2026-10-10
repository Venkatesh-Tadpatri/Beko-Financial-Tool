"""Import pipeline, approval workflow, versioned facts and overrides.

Versioning: `period_versions` holds one row per (dataset, fy, fiscal month)
per approved batch. The current version of a month is the row with
valid_to IS NULL. Approving a batch closes the open rows for the months it
covers and opens its own, so earlier versions stay queryable as history.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, utcnow

GRAIN_CHECK = "period_grain IN ('M','Q','Y')"


class DatasetSetting(Base):
    """Per-dataset storage grain. Changing it affects new uploads only."""

    __tablename__ = "dataset_settings"
    __table_args__ = (CheckConstraint(GRAIN_CHECK, name="grain_valid"),)

    dataset_type: Mapped[str] = mapped_column(String(32), primary_key=True)
    period_grain: Mapped[str] = mapped_column(String(1))
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class ImportTemplate(TimestampMixin, Base):
    __tablename__ = "import_templates"
    __table_args__ = (UniqueConstraint("dataset_type", "source_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    dataset_type: Mapped[str] = mapped_column(String(32))
    source_name: Mapped[str] = mapped_column(String(128))
    sheet_name: Mapped[str | None] = mapped_column(String(128))
    header_row: Mapped[int] = mapped_column(default=1)
    column_map: Mapped[str] = mapped_column(Text)  # JSON {field_key: "Excel column header"}
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))


class UploadBatch(TimestampMixin, Base):
    __tablename__ = "upload_batches"
    __table_args__ = (
        CheckConstraint(
            "status IN ('draft','submitted','approved','rejected','superseded')", name="status_valid"
        ),
        CheckConstraint(GRAIN_CHECK, name="grain_valid"),
        Index("ix_upload_batches_dataset_status", "dataset_type", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    dataset_type: Mapped[str] = mapped_column(String(32))
    source_name: Mapped[str] = mapped_column(String(128), default="")
    template_id: Mapped[int | None] = mapped_column(ForeignKey("import_templates.id"))
    period_grain: Mapped[str] = mapped_column(String(1))
    original_filename: Mapped[str] = mapped_column(String(255))
    archived_path: Mapped[str] = mapped_column(String(500))  # relative to the uploads folder
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    sheet_name: Mapped[str | None] = mapped_column(String(128))
    header_row: Mapped[int] = mapped_column(default=1)
    column_map: Mapped[str] = mapped_column(Text, default="{}")
    status: Mapped[str] = mapped_column(String(16), default="draft")
    current_level: Mapped[int] = mapped_column(default=0)
    uploaded_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    submitted_at: Mapped[datetime | None]
    decided_at: Mapped[datetime | None]
    fy_from: Mapped[int | None]
    fy_to: Mapped[int | None]
    row_count: Mapped[int] = mapped_column(default=0)
    reimport_of: Mapped[int | None] = mapped_column(ForeignKey("upload_batches.id"))
    is_demo: Mapped[bool] = mapped_column(default=False, index=True)


class StagingRow(Base):
    __tablename__ = "staging_rows"
    __table_args__ = (UniqueConstraint("batch_id", "row_no"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("upload_batches.id", ondelete="CASCADE"), index=True)
    row_no: Mapped[int]  # Excel row number, for messages the user can find
    raw: Mapped[str] = mapped_column(Text)  # JSON of the original cells (never modified)
    mapped: Mapped[str] = mapped_column(Text, default="{}")  # JSON after mapping + user fixes
    errors: Mapped[str] = mapped_column(Text, default="[]")  # JSON list of {field, code, message, severity}
    excluded: Mapped[bool] = mapped_column(default=False)
    edited: Mapped[bool] = mapped_column(default=False)


class ApprovalLevel(Base):
    __tablename__ = "approval_levels"
    __table_args__ = (
        UniqueConstraint("dataset_type", "level_no"),
        CheckConstraint("required_role IN ('approver','admin','super_admin')", name="role_valid"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    dataset_type: Mapped[str] = mapped_column(String(32))  # '*' = default for all datasets
    level_no: Mapped[int]
    required_role: Mapped[str] = mapped_column(String(16))


class ApprovalDecision(Base):
    __tablename__ = "approval_decisions"
    __table_args__ = (CheckConstraint("decision IN ('approved','rejected')", name="decision_valid"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("upload_batches.id"), index=True)
    level_no: Mapped[int]
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    decision: Mapped[str] = mapped_column(String(16))
    comment: Mapped[str] = mapped_column(Text, default="")
    ts: Mapped[datetime] = mapped_column(default=utcnow)


class PeriodVersion(Base):
    __tablename__ = "period_versions"
    __table_args__ = (
        Index("ix_period_versions_lookup", "dataset_type", "fy", "fiscal_month", "valid_to"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    dataset_type: Mapped[str] = mapped_column(String(32))
    fy: Mapped[int]
    fiscal_month: Mapped[int]
    batch_id: Mapped[int] = mapped_column(ForeignKey("upload_batches.id"), index=True)
    valid_from: Mapped[datetime] = mapped_column(default=utcnow)
    valid_to: Mapped[datetime | None]


# One partial unique index per open period is created in the migration:
#   UNIQUE(dataset_type, fy, fiscal_month) WHERE valid_to IS NULL
# guaranteeing exactly one current version per month.


class FactMixin:
    id: Mapped[int] = mapped_column(primary_key=True)
    fy: Mapped[int]
    period_grain: Mapped[str] = mapped_column(String(1))
    period_no: Mapped[int]
    is_demo: Mapped[bool] = mapped_column(default=False, index=True)


class SalesFact(FactMixin, Base):
    __tablename__ = "sales_facts"
    __table_args__ = (
        CheckConstraint(GRAIN_CHECK, name="grain_valid"),
        Index("ix_sales_facts_period", "fy", "period_no"),
    )

    batch_id: Mapped[int] = mapped_column(ForeignKey("upload_batches.id"), index=True)
    staging_row_no: Mapped[int | None]
    customer_code: Mapped[str] = mapped_column(String(32, collation="NOCASE"))
    material_code: Mapped[str] = mapped_column(String(40, collation="NOCASE"))
    oem_id: Mapped[int | None] = mapped_column(ForeignKey("oems.id"), index=True)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"), index=True)
    segment_id: Mapped[int | None] = mapped_column(ForeignKey("segments.id"), index=True)
    division_id: Mapped[int | None] = mapped_column(ForeignKey("divisions.id"), index=True)
    quantity: Mapped[int | None]
    amount_paise: Mapped[int]


class MetricFact(FactMixin, Base):
    """Long-format facts for expenses, P&L, cash flow, balance sheet, shares and forecast.

    `value` is paise for money metrics and a plain count for share metrics;
    the dataset registry says which.
    """

    __tablename__ = "metric_facts"
    __table_args__ = (
        CheckConstraint(GRAIN_CHECK, name="grain_valid"),
        Index("ix_metric_facts_lookup", "dataset_type", "metric", "fy", "period_no"),
    )

    batch_id: Mapped[int] = mapped_column(ForeignKey("upload_batches.id"), index=True)
    staging_row_no: Mapped[int | None]
    dataset_type: Mapped[str] = mapped_column(String(32))
    metric: Mapped[str] = mapped_column(String(48))
    category: Mapped[str | None] = mapped_column(String(128))
    division_id: Mapped[int | None] = mapped_column(ForeignKey("divisions.id"), index=True)
    value: Mapped[int]


class ReceivableFact(FactMixin, Base):
    __tablename__ = "receivable_facts"
    __table_args__ = (
        CheckConstraint(GRAIN_CHECK, name="grain_valid"),
        CheckConstraint("ageing_bucket IN ('0-30','31-60','61-90','90+')", name="bucket_valid"),
        Index("ix_receivable_facts_period", "fy", "period_no"),
    )

    batch_id: Mapped[int] = mapped_column(ForeignKey("upload_batches.id"), index=True)
    staging_row_no: Mapped[int | None]
    customer_code: Mapped[str] = mapped_column(String(32, collation="NOCASE"))
    oem_id: Mapped[int | None] = mapped_column(ForeignKey("oems.id"))
    ageing_bucket: Mapped[str] = mapped_column(String(8))
    amount_paise: Mapped[int]


class Override(Base):
    """Post-approval change to a single fact value, with the before/after kept forever."""

    __tablename__ = "overrides"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("upload_batches.id"), index=True)
    fact_table: Mapped[str] = mapped_column(String(32))
    fact_id: Mapped[int]
    field: Mapped[str] = mapped_column(String(48))
    old_value: Mapped[str] = mapped_column(Text)
    new_value: Mapped[str] = mapped_column(Text)
    reason: Mapped[str] = mapped_column(Text)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    ts: Mapped[datetime] = mapped_column(default=utcnow)
