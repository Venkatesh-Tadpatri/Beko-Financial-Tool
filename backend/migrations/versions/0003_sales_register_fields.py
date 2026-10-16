"""SAP sales register transaction fields.

Revision ID: 0003
Revises: 0002
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

COLUMNS = (
    ("billing_document", sa.String(32)), ("consignee_code", sa.String(32)),
    ("consignee_name", sa.String(255)), ("hsn_sac_code", sa.String(32)),
    ("unit", sa.String(16)), ("region", sa.String(32)), ("basic_price_paise", sa.Integer()),
    ("sales_order", sa.String(32)), ("sales_order_item", sa.String(32)),
    ("sales_order_date", sa.String(16)), ("payer_name", sa.String(255)),
    ("sales_channel", sa.String(64)), ("division_code_raw", sa.String(32)),
    ("product_name", sa.String(128)), ("sales_employee", sa.String(128)),
)


def upgrade() -> None:
    with op.batch_alter_table("sales_facts") as batch:
        batch.alter_column("material_code", existing_type=sa.String(40), nullable=True)
        for name, kind in COLUMNS:
            batch.add_column(sa.Column(name, kind, nullable=True))
    op.create_index("ix_sales_facts_product_name", "sales_facts", ["product_name"])


def downgrade() -> None:
    op.drop_index("ix_sales_facts_product_name", table_name="sales_facts")
    with op.batch_alter_table("sales_facts") as batch:
        for name, _ in reversed(COLUMNS):
            batch.drop_column(name)
        batch.alter_column("material_code", existing_type=sa.String(40), nullable=False)
