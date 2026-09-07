import pytest

from agentscope_app.domain.mapping.paths import (
    MISSING,
    PathSyntaxError,
    parse_path,
    resolve_many,
    resolve_one,
)

RECORD = {
    "session_id": "s1",
    "tools": [{"name": "Read", "ms": 5}, {"name": "Bash", "ms": None}],
    "usage": {"input": 10},
    "empty": [],
}


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("$", RECORD),
        ("$.session_id", "s1"),
        ("$.usage.input", 10),
        ("$.tools[0].name", "Read"),
        ("$.tools[-1].name", "Bash"),
        ("$.tools[1].ms", None),
    ],
)
def test_resolve_one_reads_keys_and_indexes(text: str, expected: object) -> None:
    assert resolve_one(parse_path(text), RECORD, RECORD) == expected


@pytest.mark.parametrize(
    "text", ["$.nope", "$.usage.nope", "$.tools[5].name", "$.session_id.deeper", "$.usage[0]"]
)
def test_resolve_one_returns_missing_for_absent_paths(text: str) -> None:
    assert resolve_one(parse_path(text), RECORD, RECORD) is MISSING


def test_root_scope_reads_the_root_record_from_a_nested_item() -> None:
    current = RECORD["tools"][0]
    assert resolve_one(parse_path("@root.session_id"), current, RECORD) == "s1"
    assert resolve_one(parse_path("$.name"), current, RECORD) == "Read"


def test_resolve_one_refuses_wildcards() -> None:
    with pytest.raises(ValueError, match="Wildcard"):
        resolve_one(parse_path("$.tools[*].name"), RECORD, RECORD)


def test_resolve_many_fans_out_over_wildcards_and_is_bounded() -> None:
    assert resolve_many(parse_path("$.tools[*].name"), RECORD, RECORD, limit=10) == ["Read", "Bash"]
    assert resolve_many(parse_path("$.empty[*]"), RECORD, RECORD, limit=10) == []
    assert resolve_many(parse_path("$.nope[*]"), RECORD, RECORD, limit=10) == []
    assert resolve_many(parse_path("$.usage[*]"), RECORD, RECORD, limit=10) == []
    assert resolve_many(parse_path("$"), RECORD, RECORD, limit=10) == [RECORD]
    with pytest.raises(ValueError, match="limit"):
        resolve_many(parse_path("$.tools[*]"), RECORD, RECORD, limit=1)


def test_wildcard_flag_and_syntax_errors() -> None:
    assert parse_path("$.tools[*].name").has_wildcard
    assert not parse_path("$.tools[0].name").has_wildcard
    assert parse_path("$").segments == ()
    for bad in ["", "tools", "$.", "$..a", "$[x]", "$.a[", "$.a b", "$" + ".b" * 17, "@rootx"]:
        with pytest.raises(PathSyntaxError):
            parse_path(bad)
