"""Shared Parquet fixtures for the multi-file import tests: a small table whose
rows carry every wrapper kind the reader emits, and a mapping that consumes
them through DSL v1 paths."""

from __future__ import annotations

import hashlib
import io
import json
from datetime import UTC, datetime
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

from agentscope_app.application.dto import MappingRecord

PARQUET_MAPPING: dict[str, Any] = {
    "dsl_version": 1,
    "target_schema_version": 1,
    "name": "parquet-test-v1",
    "source": "tracelab",
    "input_format": "parquet",
    "rules": [
        {
            "id": "session",
            "entity": "session",
            "select": "$",
            "native_key": ["external_id"],
            "fields": {
                "external_id": {"path": "$.session", "on_missing": "reject"},
                "agent": {"literal": "codex"},
            },
        },
        {
            "id": "model_call",
            "entity": "model_call",
            "select": "$",
            "native_key": ["external_id"],
            "fields": {
                "session_external_id": {"path": "$.session", "on_missing": "reject"},
                "external_id": {"path": "$.call"},
                "model": {"path": "$.model"},
                # The reader's timestamp wrapper: the ISO member carries full precision.
                "started_at": {"path": "$.ts.iso", "timestamp_format": "iso8601"},
                "token_semantics": {"literal": "tracelab-codex"},
                "input_tokens": {"path": "$.tokens"},
            },
        },
        {
            "id": "tool_call",
            "entity": "tool_call",
            "select": "$.tools[*]",
            "parent": "model_call",
            "native_key": ["external_id"],
            "fields": {
                "external_id": {"path": "$.id"},
                "tool_name": {"path": "$.name", "on_missing": "reject"},
                # The duration wrapper is exact decimal seconds whatever unit the file used.
                "wall_latency_ms": {"path": "$.latency.seconds", "unit": {"from": "s", "to": "ms"}},
            },
        },
    ],
}


def parquet_mapping_record(mapping_id: str = "map_parquet") -> MappingRecord:
    document = PARQUET_MAPPING
    return MappingRecord(
        id=mapping_id,
        name="parquet-test-v1",
        source="tracelab",
        revision=1,
        created_by="test",
        input_format="parquet",
        document=document,
        content_hash=hashlib.sha256(json.dumps(document, sort_keys=True).encode()).hexdigest(),
        created_at=datetime(2026, 9, 7, tzinfo=UTC),
    )


def parquet_file(rows: list[dict[str, Any]]) -> bytes:
    """rows: session, call, model, ts (datetime or None), tokens, tools[{id, name, latency_ms}]."""
    tool_type = pa.struct(
        [("id", pa.string()), ("name", pa.string()), ("latency", pa.duration("ms"))]
    )
    table = pa.table(
        {
            "session": pa.array([r["session"] for r in rows], pa.string()),
            "call": pa.array([r["call"] for r in rows], pa.string()),
            "model": pa.array([r.get("model") for r in rows], pa.string()),
            "ts": pa.array(
                [
                    None if r.get("ts") is None else int(r["ts"].timestamp() * 1_000_000) * 1000
                    for r in rows
                ],
                pa.timestamp("ns", tz="UTC"),
            ),
            "tokens": pa.array([r.get("tokens") for r in rows], pa.int64()),
            "tools": pa.array(
                [
                    [
                        {"id": t["id"], "name": t["name"], "latency": t.get("latency_ms")}
                        for t in r.get("tools", [])
                    ]
                    for r in rows
                ],
                pa.list_(tool_type),
            ),
        }
    )
    buf = io.BytesIO()
    pq.write_table(table, buf)
    return buf.getvalue()


def parquet_rows(prefix: str, count: int, session: str | None = None) -> list[dict[str, Any]]:
    return [
        {
            "session": session or f"codex:{prefix}",
            "call": f"{prefix}-call-{i}",
            "model": "gpt-5.5-codex",
            "ts": datetime(2026, 6, 1, 12, i % 60, tzinfo=UTC),
            "tokens": 100 + i,
            "tools": [{"id": f"{prefix}-tool-{i}", "name": "Bash", "latency_ms": 1500 + i}],
        }
        for i in range(count)
    ]
