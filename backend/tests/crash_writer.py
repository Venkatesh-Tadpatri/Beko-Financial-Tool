"""Child process for the crash-safety test: simulates a large upload transaction.

Usage: python -m tests.crash_writer <db_file> <batch_rows>
Prints WRITING once the transaction is in progress, then COMMITTED <batch_id>.
The parent kills this process at a random moment.
"""

from __future__ import annotations

import sys
from pathlib import Path

from app.core.db import make_engine, make_session_factory, transaction
from app.models import SalesFact, UploadBatch


def main() -> None:
    db, rows = Path(sys.argv[1]), int(sys.argv[2])
    factory = make_session_factory(make_engine(db))
    with transaction(factory) as s:
        batch = UploadBatch(dataset_type="sales", period_grain="M", original_filename="crash.xlsx",
                            archived_path="crash.xlsx", sha256="c" * 64, uploaded_by=1, status="approved")
        s.add(batch)
        s.flush()
        for chunk in range(rows // 1000):
            s.add_all(SalesFact(batch_id=batch.id, fy=2025, period_grain="M", period_no=1, customer_code="X",
                                material_code="Y", amount_paise=1) for _ in range(1000))
            s.flush()
            if chunk == 0:
                print("WRITING", flush=True)
        batch_id = batch.id
    print(f"COMMITTED {batch_id}", flush=True)


if __name__ == "__main__":
    main()
