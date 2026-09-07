"""Field profiler: units, paths, wrappers, limits, hints, the fixture, and properties."""

from __future__ import annotations

import gzip
import json
from decimal import Decimal
from pathlib import Path
from typing import Any

from hypothesis import given, settings
from hypothesis import strategies as st

from agentscope_app.domain.jsonx import dumps_exact
from agentscope_app.domain.mapping.paths import parse_path
from agentscope_app.domain.profile import PROFILER_VERSION, ProfileLimits, profile_records
from agentscope_app.domain.redaction import redact_text

FIXTURE = Path(__file__).resolve().parents[3] / "fixtures" / "tracelab" / "tracelab-sample.jsonl.gz"


def by_path(profile: Any) -> dict[str, Any]:
    return {stat.path: stat for stat in profile.fields}


def test_records_values_nulls_and_missing_have_distinct_denominators() -> None:
    records = [
        {"tools": [{"x": None}, {"x": None}]},  # one record, two null values
        {"tools": []},  # present but empty: no element paths
        {"tools": [{"x": 3}]},
        {},  # tools missing entirely
    ]
    profile = profile_records(records)
    stats = by_path(profile)
    assert profile.inspected == 4
    tools = stats["$.tools"]
    assert (tools.records, tools.values, tools.nulls) == (3, 3, 0)
    assert (tools.min_length, tools.max_length) == (0, 2)
    x = stats["$.tools[*].x"]
    assert (x.records, x.values, x.nulls) == (2, 3, 2)
    assert x.types == {"null": 2, "integer": 1}
    assert profile.to_dict()["fields"][0]["missing"] == 0
    as_dict = {f["path"]: f for f in profile.to_dict()["fields"]}
    assert as_dict["$.tools[*].x"]["missing"] == 2
    assert (x.selector, x.relative) == ("$.tools[*]", "$.x")
    assert stats["$.tools[*]"].selector == "$.tools[*]"
    assert stats["$.tools[*]"].relative == "$"


def test_types_distinguish_booleans_integers_integral_decimals_and_numbers() -> None:
    records = [{"a": True}, {"a": 1}, {"a": Decimal("1")}, {"a": Decimal("1.5")}, {"a": 2.5}]
    a = by_path(profile_records(records))["$.a"]
    assert a.types == {"boolean": 1, "integer": 2, "number": 2}
    assert (a.min, a.max) == (1, Decimal("2.5"))
    assert a.distinct == 4  # True, 1 (twice), 1.5, 2.5


def test_big_integers_stay_exact() -> None:
    big = 2**70
    a = by_path(profile_records([{"a": big}, {"a": -big}]))["$.a"]
    assert (a.min, a.max) == (-big, big)
    assert big in a.examples
    assert dumps_exact(profile_records([{"a": big}]).to_dict()).count(str(big)) >= 2


def test_wrappers_are_classified_by_kind_with_their_payload_member() -> None:
    records = [
        {
            "t": {
                "_arrow": "timestamp",
                "iso": "2026-01-02T03:04:05Z",
                "unit": "ns",
                "tz": "UTC",
                "value": 1,
            }
        },
        {"t": {"_arrow": "timestamp", "iso": None, "unit": "ns", "tz": "UTC", "value": None}},
        {"t": {"_arrow": "duration", "seconds": Decimal("1.5"), "unit": "ms"}},
        {"t": {"_arrow": "binary", "base64": None}},
        {"t": {"_arrow": "binary", "base64": "QUJD"}},
        {"t": {"_arrow": "float", "value": "NaN"}},
    ]
    stats = by_path(profile_records(records))
    t = stats["$.t"]
    assert t.types == {
        "arrow:timestamp": 2,
        "arrow:duration": 1,
        "arrow:binary": 2,
        "arrow:float": 1,
    }
    assert t.nulls == 2
    assert "$.t.iso" not in stats and "$.t.value" not in stats  # children are not paths
    assert t.wrapper == {
        "kind": "timestamp",
        "units": {"ns": 2, "ms": 1},
        "tz": {"UTC": 2},
        "accessors": ["$.t.iso", "$.t.value"],
    }
    assert "2026-01-02T03:04:05Z" in t.examples
    assert Decimal("1.5") in t.examples


def test_unaddressable_keys_are_reported_not_flattened() -> None:
    records = [{"a.b": 1, "a": {"b": 2}, "0x": 3, "with space": 4, "é": 5, "k" * 201: 6}]
    profile = profile_records(records)
    stats = by_path(profile)
    assert stats["$.a.b"].values == 1  # only the nested one
    reported = {(u.key, u.reason) for u in profile.unaddressable}
    assert reported == {
        ("a.b", "key_not_addressable"),
        ("0x", "key_not_addressable"),
        ("with space", "key_not_addressable"),
        ("é", "key_not_addressable"),
        ("k" * 80, "key_too_long"),
    }
    assert all(u.parent == "$" for u in profile.unaddressable)


def test_sensitive_keys_are_withheld_with_their_subtree() -> None:
    records = [{"sean@example.com": {"deep": "value"}, "ok": 1, "/Users/sean/x": 2}]
    profile = profile_records(records)
    assert set(by_path(profile)) == {"$", "$.ok"}
    assert [(w.parent, w.reason) for w in profile.withheld] == [("$", "email"), ("$", "path")]
    text = dumps_exact(profile.to_dict())
    assert "sean" not in text and "example.com" not in text


def test_a_sensitive_unaddressable_key_is_withheld_not_reported() -> None:
    profile = profile_records([{"contact sean@example.com": 1, "k" * 300: 2}])
    assert profile.unaddressable == [] or all("@" not in u.key for u in profile.unaddressable)
    assert [(w.parent, w.reason) for w in profile.withheld] == [("$", "email")]
    assert [u.reason for u in profile.unaddressable] == ["key_too_long"]  # long is not sensitive


def test_examples_are_redacted_before_selection_and_cut_after() -> None:
    long_secret = "sk-or-v1-" + "a" * 100
    records = [{"s": long_secret}, {"s": "short"}, {"s": "x" * 300}]
    s = by_path(profile_records(records))["$.s"]
    assert s.examples == ["short", "<token>", "<text 300 chars>"]
    assert s.max_length == 300  # lengths describe the source, examples do not
    assert all(len(str(e)) <= 80 for e in s.examples)


def test_examples_prefer_shortest_distinct_values() -> None:
    records = [{"s": "z" * (10 - i)} for i in range(10)] + [{"s": "z"}]
    s = by_path(profile_records(records))["$.s"]
    assert s.examples == ["z", "zz", "zzz", "zzzz", "zzzzz"]


def test_hints_come_from_values_only() -> None:
    iso = [{"t": f"2026-01-0{i % 9 + 1}T00:00:00Z"} for i in range(25)]
    epoch_s = [{"t": 1_757_000_000 + i} for i in range(25)]
    epoch_ms = [{"t": 1_757_000_000_000 + i} for i in range(25)]
    uuids = [{"t": f"{i:08x}-0000-4000-8000-000000000000"} for i in range(25)]
    enum = [{"t": ["a", "b", "c"][i % 3]} for i in range(25)]
    text = [{"t": "word " * 30 + str(i)} for i in range(25)]
    mixed = [{"t": 1_757_000_000}, {"t": "x"}]
    assert by_path(profile_records(iso))["$.t"].hints == ["iso8601", "enum"]
    assert by_path(profile_records(epoch_s))["$.t"].hints == ["epoch_seconds"]
    assert by_path(profile_records(epoch_ms))["$.t"].hints == ["epoch_millis"]
    assert by_path(profile_records(uuids))["$.t"].hints == ["uuid", "identifier"]
    assert by_path(profile_records(enum))["$.t"].hints == ["enum"]
    assert by_path(profile_records(text))["$.t"].hints == ["free_text"]
    assert by_path(profile_records(mixed))["$.t"].hints == []


def test_saturated_distinct_state_gives_no_cardinality_hint() -> None:
    limits = ProfileLimits(distinct=5, records=6_000)
    records = [{"id": f"id_{i}"} for i in range(6_000)]
    stat = by_path(profile_records(records, limits=limits))["$.id"]
    assert stat.distinct == 5 and stat.distinct_capped
    assert "identifier" not in stat.hints  # exact tracking stopped at 5,000: unknown, not claimed


def test_every_limit_is_reported_with_its_count() -> None:
    wide = {f"k{i}": i for i in range(10)}
    deep: Any = 1
    for level in range(12):
        deep = {f"l{level}": deep}
    records = [{"wide": wide, "deep": deep, "arr": list(range(300))}, {"x": 1}, {"y": 2}]
    narrow = profile_records(records, limits=ProfileLimits(records=2, paths=8))
    assert narrow.inspected == 2
    # $, $.wide, k0..k5 fit; k6..k9, $.deep, $.arr and $.x are over
    assert narrow.truncated == {"paths": 7, "records": 1}
    assert len(narrow.fields) == 8
    shallow = profile_records(records, limits=ProfileLimits(depth=3, array_items=100))
    assert shallow.truncated == {"array_items": 200, "depth": 1}
    assert by_path(shallow)["$.arr"].max_length == 300  # length is exact, elements are sampled
    assert "$.deep.l11.l10.l9" not in by_path(shallow)


def test_node_budget_stops_traversal_and_says_so() -> None:
    records = [{"a": list(range(1_000))} for _ in range(10)]
    profile = profile_records(records, limits=ProfileLimits(nodes=2_500, array_items=1_000))
    assert profile.nodes_visited == 2_500
    assert profile.truncated == {"nodes": 1}
    assert profile.inspected <= 3


def test_coverage_sample_lists_records_that_first_show_a_path() -> None:
    records = [{"a": 1}, {"a": 2}, {"b": 3}, {"a": 4, "b": 5}, {"c": {"d": 6}}]
    profile = profile_records(records, limits=ProfileLimits(sample_records=2))
    assert profile.coverage_sample == [0, 2]
    assert profile_records(records).coverage_sample == [0, 2, 4]


def test_unknown_python_types_are_reported_not_raised() -> None:
    stat = by_path(profile_records([{"x": object()}]))["$.x"]
    assert stat.types == {"object": 1}  # type(value).__name__


def test_root_can_be_a_scalar_or_an_array() -> None:
    profile = profile_records([1, [1, 2], "s", None])
    root = by_path(profile)["$"]
    assert root.types == {"integer": 1, "array": 1, "string": 1, "null": 1}
    assert by_path(profile)["$[*]"].values == 2


def test_tracelab_fixture_profile() -> None:
    with gzip.open(FIXTURE, "rt", encoding="utf-8") as stream:
        rows = [json.loads(line) for line in stream]
    profile = profile_records(rows)
    assert profile.version == PROFILER_VERSION
    assert profile.inspected == 2_000
    assert profile.truncated == {"records": len(rows) - 2_000}
    stats = by_path(profile)
    assert {"$.session_id", "$.timing_events[*].timestamp", "$.tools[*].tool_call_id"} <= set(stats)
    assert stats["$.timing_events[*].timestamp"].hints == ["iso8601"]
    assert stats["$.provider"].hints == ["enum"] and stats["$.provider"].distinct == 2
    assert stats["$.round_id"].hints == ["identifier"]
    assert stats["$.tools[*].tool_call_id"].hints == ["identifier"]
    assert stats["$.reasoning_output_tokens"].nulls > 0
    assert profile.unaddressable == [] and profile.withheld == []
    for stat in profile.fields:
        parse_path(stat.path)
    dumps_exact(profile.to_dict())  # serialisable, exact


# --- properties -----------------------------------------------------------------------

_json_scalars = st.one_of(
    st.none(),
    st.booleans(),
    st.integers(min_value=-(2**64), max_value=2**64),
    st.decimals(allow_nan=False, allow_infinity=False, places=3),
    st.text(max_size=300),
)
_json_values = st.recursive(
    _json_scalars,
    lambda children: st.one_of(
        st.lists(children, max_size=6),
        st.dictionaries(st.text(min_size=1, max_size=12), children, max_size=6),
    ),
    max_leaves=40,
)


@settings(max_examples=150, deadline=None)
@given(st.lists(_json_values, max_size=12))
def test_profile_never_raises_paths_parse_and_examples_are_clean(records: list[Any]) -> None:
    limits = ProfileLimits(nodes=2_000, paths=60, depth=5)
    profile = profile_records(records, limits=limits)
    assert profile.inspected == len(records)
    assert profile.nodes_visited <= limits.nodes
    assert len(profile.fields) <= limits.paths
    for stat in profile.fields:
        parse_path(stat.path)
        assert stat.records <= profile.inspected
        assert stat.nulls <= stat.values
        assert sum(stat.types.values()) == stat.values
        for example in stat.examples:
            if isinstance(example, str):
                assert len(example) <= limits.example_chars
                assert redact_text(example)[0] == example
    for reported in profile.unaddressable:
        assert redact_text(reported.key)[0] == reported.key
    dumps_exact(profile.to_dict())


def test_credential_named_keys_never_show_their_value_in_examples() -> None:
    records = [
        {"session": f"s{i}", "password": f"hunter{i}", "api_key": "abcdef123456"} for i in range(3)
    ]
    profile = profile_records(records)
    stats = by_path(profile)
    assert stats["$.password"].examples == ["<token>"]
    assert stats["$.api_key"].examples == ["<token>"]
    assert profile.redactions == {"token": 6}
    assert "hunter" not in dumps_exact(profile.to_dict())


def test_credential_named_keys_hide_containers_and_numbers_in_the_profile() -> None:
    records = [{"Authorization": ["Basic dXNlcjpwYXNz"], "password": 123456 + i} for i in range(3)]
    profile = profile_records(records)
    stats = by_path(profile)
    assert stats["$.password"].examples == ["<token>"]
    assert stats["$.password"].min is None and stats["$.password"].max is None
    assert stats["$.Authorization"].examples == ["<token>"]
    assert "$.Authorization[*]" not in stats
    text = dumps_exact(profile.to_dict())
    assert "dXNlcjpwYXNz" not in text and "123456" not in text
    assert profile.redactions == {"token": 6}
