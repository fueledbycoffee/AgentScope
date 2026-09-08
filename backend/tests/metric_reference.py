"""Independent loop/set oracle. No metric compiler or production evaluation helpers."""

from collections import defaultdict
from datetime import UTC, datetime, timedelta
from fractions import Fraction


def synthetic_rows():
    sessions = [
        {"id": "s1", "source": "alpha", "external_id": "same", "agent": "a"},
        {"id": "s2", "source": "beta", "external_id": "same", "agent": None},
        {"id": "empty", "source": "alpha", "external_id": "empty", "agent": "unknown"},
    ]
    calls = []
    for index, (sid, model, value, tag, stamp, imp) in enumerate(
        [
            ("s1", "m", 10, "a", "2026-01-01T00:00:00Z", "i1"),
            ("s1", "other", 0, "a", "2026-01-01T23:59:59.999999Z", "i2"),
            ("s1", "other", None, "b", "2026-01-02T00:00:00Z", "i2"),
            ("s2", None, 5, None, None, "i1"),
            ("s2", "unknown", 7, "", "2026-01-02T00:00:00Z", "i2"),
            ("s2", "m", 3, "unknown", None, "i1"),
        ]
    ):
        calls.append(
            {
                "id": f"c{index}",
                "session_id": sid,
                "import_id": imp,
                "model": model,
                "input_tokens": value,
                "output_tokens": 7 if index == 0 else None,
                "cache_read_tokens": 3 if index == 0 else None,
                "cache_creation_tokens": 2 if index == 0 else None,
                "reasoning_tokens": 1 if index == 0 else None,
                "token_semantics": tag,
                "started_at": datetime.fromisoformat(stamp) if stamp else None,
            }
        )
    tools = [
        {
            "id": "t0",
            "session_id": "s1",
            "import_id": "i1",
            "tool_name": "shell",
            "model_call_id": "c0",
            "wall_latency_ms": 1500,
            "internal_latency_ms": 400,
            "exit_code": 0,
            "started_at": datetime(2026, 1, 1, tzinfo=UTC),
        },
        {
            "id": "t1",
            "session_id": "s1",
            "import_id": "i2",
            "tool_name": "read",
            "model_call_id": None,
            "wall_latency_ms": None,
            "internal_latency_ms": 200,
            "exit_code": None,
            "started_at": datetime(2026, 1, 2, tzinfo=UTC),
        },
        {
            "id": "t2",
            "session_id": "s2",
            "import_id": "i1",
            "tool_name": "shell",
            "model_call_id": None,
            "wall_latency_ms": 0,
            "internal_latency_ms": None,
            "exit_code": None,
            "started_at": None,
        },
    ]
    return {"session": sessions, "model_call": calls, "tool_call": tools}


def population(data, grain, scope):
    def child_ok(row, kind):
        if scope.import_id is not None and row["import_id"] != scope.import_id:
            return False
        stamp = row.get("started_at")
        if scope.started_from is not None and (stamp is None or stamp < scope.started_from):
            return False
        if scope.started_before is not None and (stamp is None or stamp >= scope.started_before):
            return False
        if scope.timestamp_missing and stamp is not None:
            return False
        if kind == "model_call":
            if scope.model is not None and row.get("model") != scope.model:
                return False
            if scope.model_is_unknown and row.get("model") is not None:
                return False
            if scope.usage_missing and row.get("input_tokens") is not None:
                return False
            if (
                scope.token_semantics is not None
                and (row.get("token_semantics") or "unknown") != scope.token_semantics
            ):
                return False
        else:
            if scope.tool is not None and row["tool_name"] != scope.tool:
                return False
            if scope.tool_is_unlinked and row.get("model_call_id") is not None:
                return False
            if scope.tool_is_linked and row.get("model_call_id") is None:
                return False
        return True

    selected = []
    model_filter = any(
        (
            scope.model is not None,
            scope.model_is_unknown,
            scope.token_semantics is not None,
            scope.usage_missing,
        )
    )
    tool_filter = any((scope.tool is not None, scope.tool_is_unlinked, scope.tool_is_linked))
    for session in data["session"]:
        sid = session["id"]
        if scope.source is not None and session["source"] != scope.source:
            continue
        if scope.agent is not None and session.get("agent") != scope.agent:
            continue
        if scope.agent_is_unknown and session.get("agent") is not None:
            continue
        if scope.session_ids is not None and sid not in scope.session_ids:
            continue
        matches = {}
        for kind in ("model_call", "tool_call"):
            matches[kind] = [r for r in data[kind] if r["session_id"] == sid and child_ok(r, kind)]
        if model_filter and not matches["model_call"]:
            continue
        if tool_filter and not matches["tool_call"]:
            continue
        if grain == "session":
            if scope.activity_grain and not matches[scope.activity_grain]:
                continue
            if (
                (scope.started_from or scope.started_before)
                and not matches["model_call"]
                and not matches["tool_call"]
            ):
                continue
            if scope.import_id and not matches["model_call"] and not matches["tool_call"]:
                contributed = any(
                    c["session_id"] == sid and c["import_id"] == scope.import_id
                    for c in data.get("session_contributions", [])
                )
                if not contributed:
                    continue
            selected.append(session)
        else:
            for row in matches[grain]:
                selected.append({**row, "source": session["source"], "agent": session.get("agent")})
    return selected


def oracle(data, definition, scope, group_by=()):
    if definition.grain == "import":
        ids = set()
        for grain in ("model_call", "tool_call"):
            if scope.activity_grain is None or scope.activity_grain == grain:
                ids.update(r["import_id"] for r in population(data, grain, scope))
        child_filtered = any(
            (
                scope.model is not None,
                scope.tool is not None,
                scope.started_from,
                scope.started_before,
                scope.activity_grain,
                scope.token_semantics is not None,
                scope.model_is_unknown,
                scope.timestamp_missing,
                scope.tool_is_unlinked,
                scope.usage_missing,
                scope.tool_is_linked,
            )
        )
        if not child_filtered:
            sessions = {r["id"] for r in population(data, "session", scope)}
            for contribution in data.get("session_contributions", []):
                if contribution["session_id"] in sessions and (
                    scope.import_id is None or contribution["import_id"] == scope.import_id
                ):
                    ids.add(contribution["import_id"])
        return {(): {None: (len(ids), len(ids), len(ids))}}
    rows = population(data, definition.grain, scope)
    grouped = defaultdict(lambda: defaultdict(list))
    for row in rows:
        keys = []
        for dimension in group_by:
            if dimension == "started_day":
                value = row.get("started_at")
                keys.append(value.astimezone(UTC).date().isoformat() if value else None)
            elif dimension == "linked":
                keys.append(row.get("model_call_id") is not None)
            elif dimension == "session_id" and definition.grain == "session":
                keys.append(row["id"])
            else:
                keys.append(row.get(dimension))
        tag = (row.get("token_semantics") or "unknown") if definition.semantics_field else None
        value = 1 if definition.operation == "count" else row.get(definition.field)
        if definition.operation == "observed_span":
            start, end = row.get("observed_start_at"), row.get("observed_end_at")
            value = (
                Fraction((end - start) // timedelta(microseconds=1), 1000)
                if start is not None and end is not None
                else None
            )
        grouped[tuple(keys)][tag].append(value)
    if not rows and not group_by and not definition.semantics_field:
        grouped[()][None] = []
    result = {}
    for keys, partitions in grouped.items():
        result[keys] = {}
        for tag, values in partitions.items():
            known = [v for v in values if v is not None]
            value = sum(known) if known or definition.operation == "count" else None
            result[keys][tag] = (value, len(known), len(values))
    return result


def oracle_evaluation(partitions, tokens):
    known = total = 0
    values, tags = [], set()
    for tag, (value, numerator, denominator) in partitions.items():
        known += numerator
        total += denominator
        if value is not None:
            values.append(value)
        if numerator:
            tags.add(tag)
    recorded = sum(values) if values else None
    status = "not_applicable"
    if tokens:
        status = (
            "unknown"
            if not tags or "unknown" in tags
            else "mixed"
            if len(tags) > 1
            else "comparable"
        )
    canonical = recorded if status in ("comparable", "not_applicable") else None
    return canonical, recorded, known, total, status


def oracle_bucket_sessions(data, definition, scope, dimensions):
    """Eligible original populations, before any production drill scope is constructed."""
    result = defaultdict(set)
    for row in population(data, definition.grain, scope):
        keys = []
        for dimension in dimensions:
            if dimension == "started_day":
                stamp = row.get("started_at")
                keys.append(stamp.astimezone(UTC).date().isoformat() if stamp else None)
            elif dimension == "linked":
                keys.append(row.get("model_call_id") is not None)
            else:
                keys.append(row.get(dimension))
        tag = (row.get("token_semantics") or "unknown") if definition.semantics_field else None
        result[(tuple(keys), tag)].add(row["session_id"])
    return result
