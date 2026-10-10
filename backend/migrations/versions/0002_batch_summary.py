"""upload batch validation summary

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-10
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("upload_batches") as batch_op:
        batch_op.add_column(sa.Column("summary", sa.Text(), nullable=False, server_default="{}"))
    op.create_index("ix_staging_rows_batch_excluded", "staging_rows", ["batch_id", "excluded"])


def downgrade() -> None:
    op.drop_index("ix_staging_rows_batch_excluded", table_name="staging_rows")
    with op.batch_alter_table("upload_batches") as batch_op:
        batch_op.drop_column("summary")
