from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, utcnow

BACKUP_REASONS = ("pre_migration", "pre_restore", "upload", "approval", "daily", "manual")


class Backup(Base):
    """Index of backups. The backup folder's manifest.json mirrors this so backups
    can still be listed when the main database is unreadable."""

    __tablename__ = "backups"
    __table_args__ = (
        CheckConstraint(
            "reason IN ('pre_migration','pre_restore','upload','approval','daily','manual')",
            name="reason_valid",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    filename: Mapped[str] = mapped_column(String(255), unique=True)
    directory: Mapped[str] = mapped_column(String(500))
    reason: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    size_bytes: Mapped[int]
    sha256: Mapped[str] = mapped_column(String(64))
    schema_version: Mapped[str | None] = mapped_column(String(32))
    verified_at: Mapped[datetime | None]
    verify_ok: Mapped[bool | None]
    secondary_copied: Mapped[bool] = mapped_column(default=False)
    secondary_error: Mapped[str | None] = mapped_column(String(500))
