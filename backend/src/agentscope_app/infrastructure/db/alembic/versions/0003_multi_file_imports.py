"""multi-file imports: per-file mapping and status, record identity per file

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-07 16:20:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("import_files", schema=None) as batch_op:
        batch_op.add_column(sa.Column("mapping_id", sa.String(length=40), nullable=True))
        batch_op.add_column(
            sa.Column("status", sa.String(length=20), nullable=False, server_default="committed")
        )
        batch_op.add_column(sa.Column("records", sa.JSON(), nullable=True))
        batch_op.create_foreign_key(
            "fk_import_files_mapping_id", "mappings", ["mapping_id"], ["id"]
        )
    # Rows written before 0002 carried no source and were never marked committed; rows
    # written before 0003 carry no binding. All of it is recoverable from the attempt.
    op.execute(
        "UPDATE import_files SET source = (SELECT source FROM imports "
        "WHERE imports.id = import_files.import_id) WHERE source = ''"
    )
    op.execute(
        "UPDATE import_files SET mapping_id = (SELECT mapping_id FROM imports "
        "WHERE imports.id = import_files.import_id) WHERE mapping_id IS NULL"
    )
    op.execute(
        "UPDATE import_files SET status = (SELECT CASE status "
        "WHEN 'committed' THEN 'committed' WHEN 'duplicate' THEN 'duplicate' "
        "WHEN 'failed' THEN 'failed' ELSE 'pending' END FROM imports "
        "WHERE imports.id = import_files.import_id)"
    )
    # No row claims the bytes while statuses are being repaired: the partial unique
    # index stays satisfied whatever order SQLite updates rows in.
    op.execute("UPDATE import_files SET committed = 0")
    # Historical attempts had one file: its counts are the attempt's counts.
    op.execute(
        "UPDATE import_files SET records = (SELECT records FROM imports "
        "WHERE imports.id = import_files.import_id) WHERE records IS NULL"
    )
    # Before 0002 nothing stopped two attempts from committing the same bytes for one
    # source. Only the earliest keeps the claim; later ones are recorded as duplicates
    # so the partial unique index holds and the ledger stays honest.
    op.execute(
        "UPDATE import_files SET status = 'duplicate' WHERE status = 'committed' AND EXISTS ("
        "SELECT 1 FROM import_files o JOIN imports io ON io.id = o.import_id "
        "JOIN imports i ON i.id = import_files.import_id "
        "WHERE o.sha256 = import_files.sha256 AND o.source = import_files.source "
        "AND o.status = 'committed' AND o.id <> import_files.id "
        "AND (io.started_at < i.started_at "
        "OR (io.started_at = i.started_at AND o.id < import_files.id)))"
    )
    op.execute(
        "UPDATE import_files SET committed = CASE WHEN status = 'committed' THEN 1 ELSE 0 END"
    )

    with op.batch_alter_table("rejects", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("file_sha256", sa.String(length=64), nullable=False, server_default="")
        )
    op.execute(
        "UPDATE rejects SET file_sha256 = COALESCE((SELECT sha256 FROM import_files "
        "WHERE import_files.import_id = rejects.import_id ORDER BY id LIMIT 1), '') "
        "WHERE file_sha256 = ''"
    )

    # Record identity is (attempt, file, locator): two files of one attempt may both
    # have a line:1. SQLite cannot change a primary key in place, so rebuild the table.
    op.create_table(
        "record_results_new",
        sa.Column("import_id", sa.String(length=40), nullable=False),
        sa.Column("file_sha256", sa.String(length=64), nullable=False),
        sa.Column("locator", sa.String(length=64), nullable=False),
        sa.Column("outcome", sa.String(length=20), nullable=False),
        sa.Column("entity_counts", sa.JSON(), nullable=False),
        sa.Column("warning_counts", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["file_sha256"], ["raw_files.sha256"]),
        sa.ForeignKeyConstraint(["import_id"], ["imports.id"]),
        sa.PrimaryKeyConstraint("import_id", "file_sha256", "locator"),
    )
    op.execute(
        "INSERT INTO record_results_new "
        "(import_id, file_sha256, locator, outcome, entity_counts, warning_counts) "
        "SELECT import_id, file_sha256, locator, outcome, entity_counts, warning_counts "
        "FROM record_results"
    )
    op.drop_table("record_results")
    op.rename_table("record_results_new", "record_results")


def downgrade() -> None:
    # The narrower key cannot hold two files' records with the same locator in one
    # attempt: refuse rather than drop audit rows silently.
    collisions = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT COUNT(*) FROM (SELECT import_id, locator FROM record_results "
                "GROUP BY import_id, locator HAVING COUNT(*) > 1)"
            )
        )
        .scalar_one()
    )
    if collisions:
        raise RuntimeError(
            f"cannot downgrade: {collisions} (import, locator) pairs span several files"
        )
    op.create_table(
        "record_results_old",
        sa.Column("import_id", sa.String(length=40), nullable=False),
        sa.Column("locator", sa.String(length=64), nullable=False),
        sa.Column("file_sha256", sa.String(length=64), nullable=False),
        sa.Column("outcome", sa.String(length=20), nullable=False),
        sa.Column("entity_counts", sa.JSON(), nullable=False),
        sa.Column("warning_counts", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["file_sha256"], ["raw_files.sha256"]),
        sa.ForeignKeyConstraint(["import_id"], ["imports.id"]),
        sa.PrimaryKeyConstraint("import_id", "locator"),
    )
    op.execute(
        "INSERT INTO record_results_old "
        "(import_id, locator, file_sha256, outcome, entity_counts, warning_counts) "
        "SELECT import_id, locator, file_sha256, outcome, entity_counts, warning_counts "
        "FROM record_results"
    )
    op.drop_table("record_results")
    op.rename_table("record_results_old", "record_results")
    with op.batch_alter_table("rejects", schema=None) as batch_op:
        batch_op.drop_column("file_sha256")
    with op.batch_alter_table("import_files", schema=None) as batch_op:
        batch_op.drop_constraint("fk_import_files_mapping_id", type_="foreignkey")
        batch_op.drop_column("records")
        batch_op.drop_column("status")
        batch_op.drop_column("mapping_id")
