from __future__ import annotations

import sqlite3
from pathlib import Path

from app.core.db import transaction
from app.models import SalesFact, UploadBatch, User


def make_user_and_batch(session_factory, rows: int = 10, amount_paise: int = 12345) -> int:
    """Create a user plus one approved-looking sales batch with `rows` facts. Returns the batch id."""
    with transaction(session_factory) as s:
        user = s.query(User).filter_by(username="seed").one_or_none()
        if user is None:
            user = User(username="seed", password_hash="x", role="super_admin", is_founder=True)
            s.add(user)
            s.flush()
        batch = UploadBatch(dataset_type="sales", period_grain="M", original_filename="seed.xlsx",
                            archived_path="seed.xlsx", sha256="0" * 64, uploaded_by=user.id, status="approved")
        s.add(batch)
        s.flush()
        s.add_all(SalesFact(batch_id=batch.id, fy=2025, period_grain="M", period_no=1 + i % 12,
                            customer_code=f"C{i}", material_code=f"M{i}", amount_paise=amount_paise)
                  for i in range(rows))
        return batch.id


def table_counts(db_file: Path) -> dict[str, int]:
    conn = sqlite3.connect(str(db_file))
    try:
        names = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        return {n: conn.execute(f'SELECT COUNT(*) FROM "{n}"').fetchone()[0] for n in names}
    finally:
        conn.close()


def sales_total(db_file: Path) -> int:
    conn = sqlite3.connect(str(db_file))
    try:
        return conn.execute("SELECT COALESCE(SUM(amount_paise), 0) FROM sales_facts").fetchone()[0]
    finally:
        conn.close()
