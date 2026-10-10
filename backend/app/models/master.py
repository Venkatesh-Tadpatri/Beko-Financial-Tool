"""Master data: divisions, segments, products, OEMs, SAP code mappings, sales engineers."""

from __future__ import annotations

from datetime import date

from sqlalchemy import CheckConstraint, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin


class MasterMixin(TimestampMixin):
    is_active: Mapped[bool] = mapped_column(default=True)
    is_demo: Mapped[bool] = mapped_column(default=False, index=True)


class Division(MasterMixin, Base):
    __tablename__ = "divisions"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32, collation="NOCASE"), unique=True)
    name: Mapped[str] = mapped_column(String(128))


class Segment(MasterMixin, Base):
    __tablename__ = "segments"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32, collation="NOCASE"), unique=True)
    name: Mapped[str] = mapped_column(String(128))


class Product(MasterMixin, Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32, collation="NOCASE"), unique=True)
    name: Mapped[str] = mapped_column(String(128))
    division_id: Mapped[int] = mapped_column(ForeignKey("divisions.id"), index=True)
    segment_id: Mapped[int] = mapped_column(ForeignKey("segments.id"), index=True)


class Oem(MasterMixin, Base):
    __tablename__ = "oems"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32, collation="NOCASE"), unique=True)
    name: Mapped[str] = mapped_column(String(128))


class SapCustomerMap(MasterMixin, Base):
    __tablename__ = "sap_customer_map"

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_code: Mapped[str] = mapped_column(String(32, collation="NOCASE"), unique=True)
    customer_name: Mapped[str] = mapped_column(String(128), default="")
    oem_id: Mapped[int] = mapped_column(ForeignKey("oems.id"), index=True)


class SapMaterialMap(MasterMixin, Base):
    __tablename__ = "sap_material_map"

    id: Mapped[int] = mapped_column(primary_key=True)
    material_code: Mapped[str] = mapped_column(String(40, collation="NOCASE"), unique=True)
    description: Mapped[str] = mapped_column(String(255), default="")
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)


class SalesEngineer(MasterMixin, Base):
    __tablename__ = "sales_engineers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    email: Mapped[str] = mapped_column(String(255), default="")
    phone: Mapped[str] = mapped_column(String(32), default="")
    is_available: Mapped[bool] = mapped_column(default=True)
    unavailable_from: Mapped[date | None]
    unavailable_to: Mapped[date | None]
    notes: Mapped[str] = mapped_column(String(500), default="")


class EngineerAssignment(MasterMixin, Base):
    __tablename__ = "engineer_assignments"
    __table_args__ = (
        CheckConstraint("oem_id IS NOT NULL OR division_id IS NOT NULL", name="has_target"),
        CheckConstraint("end_date IS NULL OR end_date >= start_date", name="date_order"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    engineer_id: Mapped[int] = mapped_column(ForeignKey("sales_engineers.id"), index=True)
    oem_id: Mapped[int | None] = mapped_column(ForeignKey("oems.id"))
    division_id: Mapped[int | None] = mapped_column(ForeignKey("divisions.id"))
    start_date: Mapped[date]
    end_date: Mapped[date | None]
