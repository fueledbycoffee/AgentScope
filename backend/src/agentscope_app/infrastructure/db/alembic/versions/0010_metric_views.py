"""Entity-grain metric views (issue #10 branch revision).

The coordinator must explicitly merge concurrent Alembic heads before integration.
"""

from alembic import op

from agentscope_app.infrastructure.db.metric_sql import create_metric_views, drop_metric_views

revision = "0010"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_metric_views(op.get_bind())


def downgrade() -> None:
    drop_metric_views(op.get_bind())
