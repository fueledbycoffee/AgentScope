"""upload profile cache: sanitised field profile stored on the upload row

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-07 20:30:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Both nullable: existing uploads simply have no cached profile until asked for one.
    with op.batch_alter_table("uploads", schema=None) as batch_op:
        batch_op.add_column(sa.Column("profile", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("profile_version", sa.Integer(), nullable=True))


def downgrade() -> None:
    # A cache: dropping it loses nothing that cannot be recomputed from the raw file.
    with op.batch_alter_table("uploads", schema=None) as batch_op:
        batch_op.drop_column("profile_version")
        batch_op.drop_column("profile")
