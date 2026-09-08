"""Versioned cross-file claims; best-effort provenance backfill.

Revision ID: 0005
Revises: 0004
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from agentscope_app.infrastructure.db.claim_backfill_v1 import backfill

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("imports", sa.Column("duplicate_detection_version", sa.Integer(), nullable=True))
    op.add_column(
        "import_files", sa.Column("warnings", sa.JSON(), nullable=False, server_default="{}")
    )
    op.create_table(
        "claim_scopes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("scope_text", sa.Text(), nullable=False),
        sa.UniqueConstraint("version", "scope_text", name="uq_claim_scope"),
    )
    op.create_table(
        "claim_projections",
        sa.Column("scope_id", sa.Integer(), sa.ForeignKey("claim_scopes.id"), primary_key=True),
        sa.Column("projection_sha256", sa.String(64), primary_key=True),
        sa.Column("projection_text", sa.Text(), nullable=False),
    )
    op.create_table(
        "entity_claims",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("scope_id", sa.Integer(), sa.ForeignKey("claim_scopes.id"), nullable=False),
        sa.Column("projection_sha256", sa.String(64), nullable=False),
        sa.Column("import_id", sa.String(40), sa.ForeignKey("imports.id"), nullable=False),
        sa.Column("mapping_id", sa.String(40), sa.ForeignKey("mappings.id"), nullable=False),
        sa.Column("file_sha256", sa.String(64), sa.ForeignKey("raw_files.sha256"), nullable=False),
        sa.Column("locator", sa.String(64), nullable=False),
        sa.Column("locator_position", sa.Integer(), nullable=False),
        sa.Column("emission_path", sa.String(200), nullable=False),
        sa.Column("rule_id", sa.String(100), nullable=False),
        sa.Column("entity", sa.String(20), nullable=False),
        sa.UniqueConstraint(
            "import_id",
            "file_sha256",
            "locator",
            "emission_path",
            "entity",
            name="uq_entity_claim_occurrence",
        ),
    )
    op.create_index("ix_entity_claim_import", "entity_claims", ["import_id", "id"])
    op.create_index(
        "ix_entity_claim_order",
        "entity_claims",
        ["import_id", "file_sha256", "locator_position", "locator", "emission_path", "entity"],
    )
    op.create_table(
        "claim_file_projections",
        sa.Column("scope_id", sa.Integer(), sa.ForeignKey("claim_scopes.id"), primary_key=True),
        sa.Column("projection_sha256", sa.String(64), primary_key=True),
        sa.Column(
            "file_sha256", sa.String(64), sa.ForeignKey("raw_files.sha256"), primary_key=True
        ),
        sa.Column("claim_id", sa.Integer(), sa.ForeignKey("entity_claims.id"), nullable=False),
        sa.Column("witness_sort", sa.Text(), nullable=False),
    )
    op.create_index(
        "ix_claim_file_scope",
        "claim_file_projections",
        ["scope_id", "file_sha256", "projection_sha256"],
    )
    op.create_table(
        "import_diagnostics",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("import_id", sa.String(40), sa.ForeignKey("imports.id"), nullable=False),
        sa.Column("claim_id", sa.Integer(), sa.ForeignKey("entity_claims.id"), nullable=False),
        sa.Column("peer_claim_id", sa.Integer(), sa.ForeignKey("entity_claims.id"), nullable=False),
        sa.Column("code", sa.String(60), nullable=False),
        sa.UniqueConstraint("import_id", "claim_id", "code", name="uq_import_diagnostic"),
    )
    op.create_index("ix_import_diagnostic_code", "import_diagnostics", ["import_id", "code"])
    op.create_table(
        "import_claim_conditions",
        sa.Column("import_id", sa.String(40), sa.ForeignKey("imports.id"), primary_key=True),
        sa.Column(
            "file_sha256", sa.String(64), sa.ForeignKey("raw_files.sha256"), primary_key=True
        ),
        sa.Column("rule_id", sa.String(100), primary_key=True),
        sa.Column("code", sa.String(60), primary_key=True),
        sa.Column("affected_emissions", sa.Integer(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
    )
    # The old contribution table has no index suitable for file-local replay.
    op.create_index(
        "ix_contributions_import_file",
        "entity_contributions",
        ["import_id", "file_sha256", "locator"],
    )
    backfill(op.get_bind())


def downgrade() -> None:
    for name in (
        "import_claim_conditions",
        "import_diagnostics",
        "claim_file_projections",
        "entity_claims",
        "claim_projections",
        "claim_scopes",
    ):
        op.drop_table(name)
    op.drop_index("ix_contributions_import_file", table_name="entity_contributions")
    # Native DROP COLUMN avoids rebuilding referenced parent tables with FK enforcement on.
    op.execute("ALTER TABLE import_files DROP COLUMN warnings")
    op.execute("ALTER TABLE imports DROP COLUMN duplicate_detection_version")
