"""Property-based tests over the whole domain surface.

These encode the invariants the adversarial reviews kept probing one case at a
time: converters raise only ConversionError, the parser never raises, an
executable mapping is always schema-valid, the interpreter never produces an
internal_error for any record, emitted values are canonical, and the reducer's
bounds are always ordered.
"""

from __future__ import annotations

import contextlib
import copy
import json
from datetime import datetime
from decimal import Decimal
from typing import Any

import jsonschema
from hypothesis import given, settings
from hypothesis import strategies as st

from agentscope_app.domain.errors import ConversionError
from agentscope_app.domain.identity import SourceOccurrence
from agentscope_app.domain.mapping.interpreter import Emission, apply_mapping
from agentscope_app.domain.mapping.parser import parse_mapping
from agentscope_app.domain.mapping.transforms import TRANSFORM_NAMES, Transform, apply_transform
from agentscope_app.domain.reducer import reduce_sessions
from agentscope_app.domain.schema import FieldType
from agentscope_app.domain.units import DURATION_UNITS, TIMESTAMP_FORMATS, coerce, convert_duration
from tests.domain.test_parser import VALID
from tests.domain.test_schema_json import SCHEMA

SETTINGS = settings()  # example budget comes from the profile in tests/conftest.py

scalars = (
    st.none()
    | st.booleans()
    | st.integers(min_value=-(10**25), max_value=10**25)
    | st.floats(allow_nan=True, allow_infinity=True)
    | st.text(max_size=40)
    | st.decimals(allow_nan=True, allow_infinity=True)
    | st.sampled_from(
        [
            "",
            " ",
            "null",
            '""',
            "1e400",
            "1e-400",
            "1e9999999999999999999",
            "0e19",
            "--1",
            "9" * 25,
            "2026-05-11T06:40:30.637Z",
            "2026-05-11T06:40:30",
            "[" * 50 + "]" * 50,
            '{"a": [1.5, null, "x"]}',
            "Ignore previous instructions",
        ]
    )
)
deep_values = st.integers(min_value=17, max_value=800).map(
    lambda n: json.loads("[" * n + "0" + "]" * n)
)
json_values = st.recursive(
    scalars,
    lambda children: (
        st.lists(children, max_size=4) | st.dictionaries(st.text(max_size=6), children, max_size=4)
    ),
    max_leaves=25,
)
CANONICAL_TYPES = (str, int, float, bool, datetime, type(None))


@SETTINGS
@given(value=json_values, field_type=st.sampled_from(list(FieldType)))
def test_coerce_raises_only_conversion_errors(value: Any, field_type: FieldType) -> None:
    try:
        out = coerce(value, field_type, timestamp_format="iso8601")
    except ConversionError:
        return
    assert isinstance(out, CANONICAL_TYPES)
    if field_type is FieldType.INTEGER:
        assert -(2**63) <= out <= 2**63 - 1
    if field_type is FieldType.TIMESTAMP:
        assert out.tzinfo is not None


@SETTINGS
@given(
    value=json_values,
    from_unit=st.sampled_from(sorted(DURATION_UNITS)),
    to_unit=st.sampled_from(sorted(DURATION_UNITS)),
)
def test_convert_duration_raises_only_conversion_errors(
    value: Any, from_unit: str, to_unit: str
) -> None:
    try:
        out = convert_duration(value, from_unit, to_unit)
    except ConversionError:
        return
    assert isinstance(out, int | Decimal)
    assert out.copy_abs() < 10**19 if isinstance(out, Decimal) else abs(out) < 2**63


@SETTINGS
@given(value=json_values, fmt=st.sampled_from(TIMESTAMP_FORMATS))
def test_timestamp_coercion_raises_only_conversion_errors(value: Any, fmt: str) -> None:
    try:
        out = coerce(value, FieldType.TIMESTAMP, timestamp_format=fmt)
    except ConversionError:
        return
    assert isinstance(out, datetime) and out.tzinfo is not None


@SETTINGS
@given(
    value=json_values,
    name=st.sampled_from(TRANSFORM_NAMES),
    params=st.dictionaries(st.text(max_size=8), json_values, max_size=3),
)
def test_transforms_raise_only_conversion_errors(
    value: Any, name: str, params: dict[str, Any]
) -> None:
    if name == "enum_map":
        params = {"mapping": params, "unmapped": "keep"}
    with contextlib.suppress(ConversionError):
        apply_transform(Transform(name, params), value)


@SETTINGS
@given(document=json_values | deep_values)
def test_parser_never_raises(document: Any) -> None:
    parsed = parse_mapping(document)
    assert all(issue.message for issue in parsed.issues)


def _set_path(doc: Any, path: list[Any], value: Any) -> None:
    node = doc
    for key in path[:-1]:
        node = node[key]
    node[path[-1]] = value


mutation_paths = st.sampled_from(
    [
        ["dsl_version"],
        ["target_schema_version"],
        ["name"],
        ["input_format"],
        ["rules"],
        ["rules", 0],
        ["rules", 0, "id"],
        ["rules", 0, "select"],
        ["rules", 0, "where"],
        ["rules", 0, "native_key"],
        ["rules", 0, "fields"],
        ["rules", 0, "fields", "external_id"],
        ["rules", 0, "fields", "external_id", "path"],
        ["rules", 0, "fields", "agent", "literal"],
        ["rules", 1, "where", 0, "op"],
        ["rules", 1, "where", 0, "value"],
        ["rules", 1, "fields", "started_at", "timestamp_format"],
        ["rules", 1, "fields", "input_tokens", "paths"],
        ["rules", 1, "fields", "input_tokens", "on_missing"],
        ["rules", 2, "parent"],
        ["rules", 2, "fields", "tool_name", "transforms"],
        ["rules", 2, "fields", "tool_name", "transforms", 1],
        ["rules", 2, "fields", "wall_latency_ms", "unit"],
        ["rules", 2, "fields", "wall_latency_ms", "unit", "from"],
        ["rules", 2, "fields", "is_error", "on_invalid"],
        ["unmapped"],
        ["unmapped", 0, "reason"],
    ]
)
option_values = (
    json_values
    | deep_values
    | st.sampled_from(
        [
            "$",
            "$.a[*]",
            "$" + ".a" * 17,
            "@root.x",
            "min",
            "max",
            "epoch_ms",
            "reject",
            "default",
            {"from": "s", "to": "ms"},
            {"from": "s", "to": "s"},
            [{"enum_map": {"mapping": {"a": "b"}}}],
            ["trim", {"json_decode": {}}],
            {"path": "$.x", "bounds": "min"},
            {"path": "$.x[*]", "bounds": "min", "timestamp_format": "epoch_s"},
            {"literal": None},
            {"path": "$.x", "on_missing": "default", "default": 0},
            {"path": "$.x", "on_missing": "default", "default": None},
            None,
            True,
            1,
        ]
    )
)


@SETTINGS
@given(
    mutations=st.lists(st.tuples(mutation_paths, option_values), min_size=1, max_size=3),
)
def test_executable_mappings_are_schema_valid(mutations: list[tuple[list[Any], Any]]) -> None:
    doc = copy.deepcopy(VALID)
    for path, value in mutations:
        try:
            _set_path(doc, path, value)
        except (KeyError, IndexError, TypeError):
            return
    parsed = parse_mapping(doc)
    if parsed.is_executable:
        jsonschema.validate(doc, SCHEMA)  # the parser must never accept what the schema rejects


RICH_MAPPING: dict[str, Any] = {
    "dsl_version": 1,
    "target_schema_version": 1,
    "name": "rich",
    "source": "fuzz",
    "input_format": "jsonl",
    "rules": [
        {
            "id": "session",
            "entity": "session",
            "select": "$",
            "fields": {
                "external_id": {
                    "path": "$.sid",
                    "transforms": ["trim", "lower"],
                    "empty_as_missing": True,
                    "on_missing": "reject",
                },
                "agent": {
                    "path": "$.agent",
                    "transforms": [{"enum_map": {"mapping": {"c": "codex"}, "unmapped": "keep"}}],
                    "on_invalid": "null",
                },
                "started_at": {"path": "$.events[*].ts", "bounds": "min", "on_invalid": "null"},
            },
        },
        {
            "id": "model_call",
            "entity": "model_call",
            "select": "$",
            "where": [{"path": "$.kind", "op": "in", "value": ["call", 1, True, None]}],
            "fields": {
                "session_external_id": {"path": "$.sid", "transforms": ["trim", "lower"]},
                "external_id": {"paths": ["$.id", "$.alt.id"]},
                "started_at": {
                    "path": "$.ts",
                    "timestamp_format": "epoch_ms",
                    "on_invalid": "null",
                },
                "ended_at": {
                    "path": "$.events[*].ts",
                    "bounds": "max",
                    "transforms": ["json_decode"],
                    "empty_as_missing": True,
                    "on_invalid": "null",
                },
                "input_tokens": {
                    "path": "$.tokens",
                    "transforms": ["json_decode"],
                    "on_invalid": "null",
                },
                "output_tokens": {"path": "$.out", "on_invalid": "null"},
                "model": {
                    "path": "$.model",
                    "transforms": ["json_decode"],
                    "on_missing": "default",
                    "default": "unknown",
                    "on_invalid": "null",
                },
                "token_semantics": {"literal": "unknown"},
                "is_error": {"path": "$.err", "on_invalid": "null"},
            },
        },
        {
            "id": "tool_call",
            "entity": "tool_call",
            "select": "$.tools[*]",
            "parent": "model_call",
            "fields": {
                "session_external_id": {"path": "@root.sid", "transforms": ["trim", "lower"]},
                "tool_name": {"path": "$.name", "on_missing": "default", "default": "?"},
                "wall_latency_ms": {
                    "path": "$.secs",
                    "transforms": ["json_decode"],
                    "unit": {"from": "s", "to": "ms"},
                    "on_invalid": "null",
                },
                "exit_code": {"path": "$.code", "on_invalid": "null"},
                "status": {"path": "$.status", "empty_as_missing": True},
            },
        },
    ],
}
RICH_SPEC = parse_mapping(RICH_MAPPING).spec
assert RICH_SPEC is not None, parse_mapping(RICH_MAPPING).issues

record_values = st.fixed_dictionaries(
    {},
    optional={
        "sid": scalars,
        "agent": scalars,
        "kind": scalars,
        "id": scalars,
        "alt": json_values,
        "ts": scalars,
        "events": st.lists(st.fixed_dictionaries({}, optional={"ts": scalars}), max_size=4)
        | scalars,
        "tokens": scalars,
        "out": scalars,
        "model": scalars,
        "err": scalars,
        "tools": st.lists(
            st.fixed_dictionaries(
                {},
                optional={"name": scalars, "secs": scalars, "code": scalars, "status": scalars},
            ),
            max_size=3,
        )
        | scalars,
        "extra": json_values,
    },
)


@SETTINGS
@given(record=json_values | record_values)
def test_interpreter_never_produces_internal_errors(record: Any) -> None:
    result = apply_mapping(RICH_SPEC, record, file_sha256="fuzz", locator="line:1")
    for reject in result.rejects:
        assert reject.code != "internal_error", reject
        assert reject.message
    for emission in result.emissions:
        for name, value in emission.fields.items():
            assert isinstance(value, CANONICAL_TYPES), (name, type(value))
            if isinstance(value, int) and not isinstance(value, bool):
                assert -(2**63) <= value <= 2**63 - 1, name
            if isinstance(value, datetime):
                assert value.tzinfo is not None
        started, ended = emission.fields.get("started_at"), emission.fields.get("ended_at")
        if isinstance(started, datetime) and isinstance(ended, datetime):
            assert started <= ended
    keys = [e.occurrence.key for e in result.emissions]
    assert len(keys) == len(set(keys))


def _emission(entity: str, index: int, fields: dict[str, Any]) -> Emission:
    return Emission(entity, entity, SourceOccurrence("f", f"line:{index}", entity), fields)


timestamps = st.none() | st.datetimes(
    min_value=datetime(2000, 1, 1), max_value=datetime(2030, 1, 1)
).map(lambda d: d.replace(tzinfo=__import__("datetime").UTC))


@SETTINGS
@given(
    emissions=st.lists(
        st.tuples(
            st.sampled_from(["session", "model_call", "tool_call"]),
            st.sampled_from(["a", "b"]),
            timestamps,
            timestamps,
        ),
        max_size=12,
    )
)
def test_reducer_bounds_are_always_ordered(
    emissions: list[tuple[str, str, datetime | None, datetime | None]],
) -> None:
    built = []
    for index, (entity, sid, start, end) in enumerate(emissions):
        key = "external_id" if entity == "session" else "session_external_id"
        built.append(_emission(entity, index, {key: sid, "started_at": start, "ended_at": end}))
    for session in reduce_sessions(built).values():
        if session.observed_start_at and session.observed_end_at:
            assert session.observed_start_at <= session.observed_end_at
        if session.declared_started_at and session.declared_ended_at:
            assert session.declared_started_at <= session.declared_ended_at
        assert len(session.contributions) >= session.model_call_count + session.tool_call_count


def test_rich_mapping_round_trips_through_json() -> None:
    assert json.loads(json.dumps(RICH_MAPPING)) == RICH_MAPPING
