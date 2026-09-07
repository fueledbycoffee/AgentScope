#!/usr/bin/env python3
"""Aggregate-only audit of a SWE-chat excerpt, for the verification report (issue #16).

Prints distributions and counts, never row values: role × turn_type × is_continuation,
distinctness of ids, per-session assistant rows versus the declared api_call_count,
tool_use/tool_result pairing, nulls per column, timestamp units. Run inside the backend
environment:
``uv --directory backend run python ../scripts/audit_swe_chat.py --dir ../data/samples/swe-chat-1``
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dir", type=Path, default=Path("data/samples/swe-chat-1"))
    args = parser.parse_args(argv)
    try:
        import pyarrow.parquet as pq
    except ImportError as exc:  # pragma: no cover
        raise SystemExit("run inside the backend environment") from exc

    sessions = pq.read_table(args.dir / "sessions.parquet")
    conversations = pq.read_table(args.dir / "conversations.parquet")
    out: dict[str, object] = {
        "sessions_rows": sessions.num_rows,
        "conversations_rows": conversations.num_rows,
    }

    def col(table, name):  # noqa: ANN001 - pyarrow types
        return table.column(name).to_pylist() if name in table.column_names else []

    roles = col(conversations, "role")
    turn_types = col(conversations, "turn_type")
    continuation = col(conversations, "is_continuation")
    out["role_x_turn_type_x_continuation"] = {
        f"{r}|{t}|{c}": n
        for (r, t, c), n in sorted(
            Counter(zip(roles, turn_types, continuation, strict=True)).items()
        )
    }
    for table, name, key in (
        (conversations, "conversations", "turn_id"),
        (sessions, "sessions", "session_id"),
        (conversations, "conversations", "tool_call_id"),
    ):
        values = [v for v in col(table, key) if v is not None]
        out[f"{name}.{key}"] = {"non_null": len(values), "distinct": len(set(values))}
    sess_ids = col(conversations, "session_id")
    assistant_per_session = Counter(
        s for s, r in zip(sess_ids, roles, strict=True) if r == "assistant"
    )
    declared = dict(zip(col(sessions, "session_id"), col(sessions, "api_call_count"), strict=True))
    out["assistant_rows_vs_declared_api_calls"] = {
        "sessions_compared": len(declared),
        "equal": sum(1 for s, n in declared.items() if assistant_per_session.get(s, 0) == n),
        "assistant_rows_higher": sum(
            1 for s, n in declared.items() if assistant_per_session.get(s, 0) > (n or 0)
        ),
        "assistant_rows_lower": sum(
            1 for s, n in declared.items() if assistant_per_session.get(s, 0) < (n or 0)
        ),
    }
    tool_names = col(conversations, "tool_name")
    out["tool_rows"] = {
        "tool_use_total": roles.count("tool_use"),
        "tool_use_with_tool_name": sum(
            1 for r, t in zip(roles, tool_names, strict=True) if r == "tool_use" and t is not None
        ),
        "tool_result_total": roles.count("tool_result"),
        "tool_result_with_tool_name": sum(
            1
            for r, t in zip(roles, tool_names, strict=True)
            if r == "tool_result" and t is not None
        ),
        "tool_call_id_on_tool_use": sum(
            1
            for r, t in zip(roles, col(conversations, "tool_call_id"), strict=True)
            if r == "tool_use" and t is not None
        ),
    }
    out["nulls_per_column"] = {
        table_name: {
            name: table.column(name).null_count
            for name in table.column_names
            if table.column(name).null_count
        }
        for table_name, table in (("sessions", sessions), ("conversations", conversations))
    }
    out["timestamp_columns"] = {
        table_name: {f.name: str(f.type) for f in table.schema if "timestamp" in str(f.type)}
        for table_name, table in (("sessions", sessions), ("conversations", conversations))
    }
    print(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
