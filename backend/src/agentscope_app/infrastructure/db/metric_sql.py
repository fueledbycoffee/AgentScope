"""SQLite exact arithmetic and version-one view DDL.

Batch migrations of any fact table must drop all views first and recreate them last.
Keep these v1 projections stable; future schema changes need versioned helpers.
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import Connection

VIEW_SQL = {
    "metric_sessions_v1": "SELECT id, source, external_id, agent, observed_start_at, "
    "observed_end_at FROM sessions",
    "metric_model_calls_v1": """SELECT c.id, c.session_id, c.import_id, s.source, s.agent,
        c.provider, c.model, c.started_at, c.ended_at, c.input_tokens, c.output_tokens,
        c.cache_read_tokens, c.cache_creation_tokens, c.reasoning_tokens,
        COALESCE(NULLIF(c.token_semantics, ''), 'unknown') AS token_semantics, c.is_error
        FROM model_calls AS c JOIN sessions AS s ON s.id = c.session_id""",
    "metric_tool_calls_v1": """SELECT t.id, t.session_id, t.model_call_id, t.import_id,
        s.source, s.agent, t.tool_name, t.started_at, t.ended_at, t.wall_latency_ms,
        t.internal_latency_ms, t.is_error, t.exit_code, t.status
        FROM tool_calls AS t JOIN sessions AS s ON s.id = t.session_id""",
}


class ExactIntSum:
    def __init__(self) -> None:
        self.value: int | None = None

    def step(self, value: int | None) -> None:
        if value is not None:
            if not isinstance(value, int):
                raise ValueError("exact_int_sum accepts integer measures only")
            self.value = (self.value or 0) + value

    def finalize(self) -> str | None:
        return None if self.value is None else str(self.value)


class ExactIntSamples:
    def __init__(self) -> None:
        self.values: list[int] = []

    def step(self, value: int | None) -> None:
        if value is not None:
            if not isinstance(value, int):
                raise ValueError("exact_int_samples accepts integer measures only")
            self.values.append(value)

    def finalize(self) -> str:
        return json.dumps(self.values)


def register_metric_functions(connection: Any) -> None:
    connection.create_aggregate("exact_int_samples", 1, ExactIntSamples)
    connection.create_aggregate("exact_int_sum", 1, ExactIntSum)


def create_metric_views(connection: Connection) -> None:
    for name, query in VIEW_SQL.items():
        connection.exec_driver_sql(f"CREATE VIEW {name} AS {query}")


def drop_metric_views(connection: Connection) -> None:
    for name in reversed(VIEW_SQL):
        connection.exec_driver_sql(f"DROP VIEW IF EXISTS {name}")
