import copy
from collections.abc import Callable
from typing import Any

from agentscope_app.domain.errors import Severity
from agentscope_app.domain.mapping.contract import ParsedMapping
from agentscope_app.domain.mapping.parser import parse_mapping
from agentscope_app.domain.schema import FieldType

VALID: dict[str, Any] = {
    "dsl_version": 1,
    "target_schema_version": 1,
    "name": "t",
    "source": "test",
    "input_format": "jsonl",
    "rules": [
        {
            "id": "session",
            "entity": "session",
            "select": "$",
            "fields": {"external_id": {"path": "$.sid"}, "agent": {"literal": "codex"}},
        },
        {
            "id": "model_call",
            "entity": "model_call",
            "select": "$",
            "where": [{"path": "$.kind", "op": "eq", "value": "call"}],
            "native_key": ["external_id"],
            "fields": {
                "session_external_id": {"path": "$.sid"},
                "external_id": {"path": "$.id"},
                "started_at": {"path": "$.ts", "timestamp_format": "epoch_ms"},
                "input_tokens": {"paths": ["$.usage.input", "$.in"], "on_missing": "null"},
            },
        },
        {
            "id": "tool_call",
            "entity": "tool_call",
            "select": "$.tools[*]",
            "parent": "model_call",
            "fields": {
                "tool_name": {
                    "path": "$.name",
                    "transforms": [
                        "trim",
                        {"enum_map": {"mapping": {"bash": "Bash"}, "unmapped": "keep"}},
                    ],
                },
                "wall_latency_ms": {"path": "$.secs", "unit": {"from": "s", "to": "ms"}},
                "is_error": {"path": "$.err", "on_invalid": "null"},
            },
        },
    ],
    "unmapped": [{"path": "$.noise", "reason": "no target"}],
    "notes": "fixture",
}

Mutator = Callable[[dict[str, Any]], None]


def codes(parsed: ParsedMapping, severity: Severity = Severity.ERROR) -> list[tuple[str, str]]:
    return [(i.path, i.code) for i in parsed.issues if i.severity is severity]


def variant(mutate: Mutator) -> ParsedMapping:
    doc = copy.deepcopy(VALID)
    mutate(doc)
    return parse_mapping(doc)


def test_valid_document_parses_into_executable_spec() -> None:
    parsed = parse_mapping(VALID)
    assert parsed.issues == ()
    assert parsed.is_executable and parsed.spec is not None
    spec = parsed.spec
    assert [r.id for r in spec.rules] == ["session", "model_call", "tool_call"]
    mc = spec.rules[1]
    assert mc.native_key == ("external_id",)
    assert mc.where[0].op == "eq" and mc.where[0].value == "call"
    assert mc.fields["started_at"].type is FieldType.TIMESTAMP
    assert mc.fields["started_at"].timestamp_format == "epoch_ms"
    assert len(mc.fields["input_tokens"].paths) == 2
    tc = spec.rules[2]
    assert tc.parent == "model_call" and tc.select.has_wildcard
    assert [t.name for t in tc.fields["tool_name"].transforms] == ["trim", "enum_map"]
    assert tc.fields["wall_latency_ms"].unit_from == "s"
    assert tc.fields["is_error"].on_invalid == "null"
    assert spec.rules[0].native_key == ("external_id",)
    assert spec.rules[0].fields["agent"].has_literal
    assert spec.unmapped[0].reason == "no target"
    assert spec.rule("tool_call") is tc


def test_not_a_document() -> None:
    parsed = parse_mapping(["nope"])
    assert parsed.spec is None and codes(parsed) == [("$", "not_an_object")]


def _unknown_entity(d: dict[str, Any]) -> None:
    d["rules"][0]["entity"] = "widget"


def _unknown_field(d: dict[str, Any]) -> None:
    d["rules"][1]["fields"]["colour"] = {"path": "$.c"}


def _duplicate_rule(d: dict[str, Any]) -> None:
    d["rules"][1]["id"] = "session"


def _missing_required(d: dict[str, Any]) -> None:
    del d["rules"][0]["fields"]["external_id"]


def _bad_path(d: dict[str, Any]) -> None:
    d["rules"][0]["fields"]["agent"] = {"path": "sid"}


def _wildcard_field(d: dict[str, Any]) -> None:
    d["rules"][0]["fields"]["agent"] = {"path": "$.a[*]"}


def _both_path_and_literal(d: dict[str, Any]) -> None:
    d["rules"][0]["fields"]["agent"] = {"path": "$.a", "literal": "x"}


def _unknown_transform(d: dict[str, Any]) -> None:
    d["rules"][2]["fields"]["tool_name"]["transforms"] = ["eval"]


def _bad_enum_params(d: dict[str, Any]) -> None:
    d["rules"][2]["fields"]["tool_name"]["transforms"] = [{"enum_map": {"unmapped": "explode"}}]


def _unit_on_non_duration(d: dict[str, Any]) -> None:
    d["rules"][1]["fields"]["input_tokens"]["unit"] = {"from": "s", "to": "ms"}


def _unit_wrong_target(d: dict[str, Any]) -> None:
    d["rules"][2]["fields"]["wall_latency_ms"]["unit"] = {"from": "s", "to": "s"}


def _unit_unknown_source(d: dict[str, Any]) -> None:
    d["rules"][2]["fields"]["wall_latency_ms"]["unit"] = {"from": "furlong", "to": "ms"}


def _type_mismatch(d: dict[str, Any]) -> None:
    d["rules"][1]["fields"]["external_id"]["type"] = "integer"


def _parent_not_root(d: dict[str, Any]) -> None:
    d["rules"][1]["select"] = "$.calls[*]"


def _parent_unknown(d: dict[str, Any]) -> None:
    d["rules"][2]["parent"] = "nope"


def _parent_on_session(d: dict[str, Any]) -> None:
    d["rules"][0]["parent"] = "model_call"


def _where_bad_op(d: dict[str, Any]) -> None:
    d["rules"][1]["where"] = [{"path": "$.k", "op": "matches", "value": ".*"}]


def _where_in_needs_list(d: dict[str, Any]) -> None:
    d["rules"][1]["where"] = [{"path": "$.k", "op": "in", "value": "x"}]


def _native_key_unmapped(d: dict[str, Any]) -> None:
    d["rules"][1]["native_key"] = ["model"]


def _default_missing(d: dict[str, Any]) -> None:
    d["rules"][0]["fields"]["agent"] = {"path": "$.a", "on_missing": "default"}


def _bad_versions(d: dict[str, Any]) -> None:
    d["dsl_version"] = 2
    d["target_schema_version"] = 9


def _no_rules(d: dict[str, Any]) -> None:
    d["rules"] = []


def _empty_fields(d: dict[str, Any]) -> None:
    d["rules"][0]["fields"] = {}


def _unmapped_without_reason(d: dict[str, Any]) -> None:
    d["unmapped"] = [{"path": "$.x"}]


def _bad_timestamp_format(d: dict[str, Any]) -> None:
    d["rules"][1]["fields"]["started_at"]["timestamp_format"] = "unix"


def _bad_on_missing(d: dict[str, Any]) -> None:
    d["rules"][0]["fields"]["agent"] = {"path": "$.a", "on_missing": "explode"}


def _bad_input_format(d: dict[str, Any]) -> None:
    d["input_format"] = "xml"


EXPECTATIONS: list[tuple[Mutator, str, str]] = [
    (_unknown_entity, "rules[0].entity", "unknown_entity"),
    (_unknown_field, "rules[1].fields.colour", "unknown_field"),
    (_duplicate_rule, "rules[1].id", "duplicate_rule_id"),
    (_missing_required, "rules[0].fields", "required_field_unmapped"),
    (_bad_path, "rules[0].fields.agent.path", "invalid_path"),
    (_wildcard_field, "rules[0].fields.agent.path", "wildcard_in_field_path"),
    (_both_path_and_literal, "rules[0].fields.agent", "ambiguous_source"),
    (_unknown_transform, "rules[2].fields.tool_name.transforms[0]", "unknown_transform"),
    (_bad_enum_params, "rules[2].fields.tool_name.transforms[0]", "invalid_transform_params"),
    (_unit_on_non_duration, "rules[1].fields.input_tokens.unit", "unit_not_applicable"),
    (_unit_wrong_target, "rules[2].fields.wall_latency_ms.unit", "unit_target_mismatch"),
    (_unit_unknown_source, "rules[2].fields.wall_latency_ms.unit", "unknown_unit"),
    (_type_mismatch, "rules[1].fields.external_id.type", "type_mismatch"),
    (_parent_not_root, "rules[2].parent", "parent_not_root"),
    (_parent_unknown, "rules[2].parent", "unknown_parent"),
    (_parent_on_session, "rules[0].parent", "parent_not_allowed"),
    (_where_bad_op, "rules[1].where[0].op", "unknown_operator"),
    (_where_in_needs_list, "rules[1].where[0].value", "invalid_condition_value"),
    (_native_key_unmapped, "rules[1].native_key", "native_key_unmapped"),
    (_default_missing, "rules[0].fields.agent.default", "default_required"),
    (_bad_versions, "dsl_version", "unsupported_version"),
    (_bad_versions, "target_schema_version", "unsupported_version"),
    (_no_rules, "rules", "no_rules"),
    (_empty_fields, "rules[0].fields", "no_fields"),
    (_unmapped_without_reason, "unmapped[0].reason", "missing_reason"),
    (
        _bad_timestamp_format,
        "rules[1].fields.started_at.timestamp_format",
        "unknown_timestamp_format",
    ),
    (_bad_on_missing, "rules[0].fields.agent.on_missing", "unknown_policy"),
    (_bad_input_format, "input_format", "unknown_input_format"),
]


def test_structural_and_semantic_errors_are_explained() -> None:
    for mutate, path, code in EXPECTATIONS:
        parsed = variant(mutate)
        assert (path, code) in codes(parsed), (mutate.__name__, parsed.issues)
        assert not parsed.is_executable, mutate.__name__
        assert all(i.message for i in parsed.issues)


def test_unknown_keys_are_warnings_not_errors() -> None:
    parsed = variant(lambda d: d["rules"][0].__setitem__("colour", "blue"))
    assert parsed.is_executable
    assert codes(parsed, Severity.WARNING) == [("rules[0].colour", "unknown_key")]


def test_tool_call_without_parent_must_map_session() -> None:
    def no_parent(d: dict[str, Any]) -> None:
        del d["rules"][2]["parent"]

    parsed = variant(no_parent)
    assert ("rules[2].fields", "required_field_unmapped") in codes(parsed)

    def no_parent_but_session(d: dict[str, Any]) -> None:
        del d["rules"][2]["parent"]
        d["rules"][2]["fields"]["session_external_id"] = {"path": "@root.sid"}

    assert variant(no_parent_but_session).is_executable


def test_native_key_defaults_to_external_id_only_when_mapped() -> None:
    def no_external_id(d: dict[str, Any]) -> None:
        del d["rules"][1]["fields"]["external_id"]
        del d["rules"][1]["native_key"]

    parsed = variant(no_external_id)
    assert parsed.is_executable and parsed.spec is not None
    assert parsed.spec.rules[1].native_key == ()


def _rule_id_with_bracket(d: dict[str, Any]) -> None:
    d["rules"][0]["id"] = "t[0]"


def _missing_name(d: dict[str, Any]) -> None:
    del d["name"]


def _empty_source(d: dict[str, Any]) -> None:
    d["source"] = "  "


def _missing_input_format(d: dict[str, Any]) -> None:
    del d["input_format"]


def _parent_declared_after_child(d: dict[str, Any]) -> None:
    d["rules"] = [d["rules"][0], d["rules"][2], d["rules"][1]]


REVIEW_EXPECTATIONS: list[tuple[Mutator, str, str]] = [
    (_rule_id_with_bracket, "rules[0].id", "invalid_id"),
    (_missing_name, "name", "missing_key"),
    (_empty_source, "source", "missing_key"),
    (_missing_input_format, "input_format", "missing_key"),
    (_parent_declared_after_child, "rules[1].parent", "parent_order"),
]


def test_review_findings_are_rejected_with_explanations() -> None:
    for mutate, path, code in REVIEW_EXPECTATIONS:
        parsed = variant(mutate)
        assert (path, code) in codes(parsed), (mutate.__name__, parsed.issues)
        assert not parsed.is_executable, mutate.__name__


def test_huge_path_index_is_a_located_issue_not_a_crash() -> None:
    parsed = variant(lambda d: d["rules"][0].__setitem__("select", "$[" + "9" * 5000 + "]"))
    assert ("rules[0].select", "invalid_path") in codes(parsed)


def test_parent_issues_use_document_indexes_even_after_invalid_rules() -> None:
    doc: dict[str, Any] = copy.deepcopy(VALID)
    doc["rules"] = [
        None,
        {
            "id": "t",
            "entity": "tool_call",
            "select": "$.tools[*]",
            "parent": "missing",
            "fields": {"tool_name": {"literal": "t"}},
        },
    ]
    parsed = parse_mapping(doc)
    assert ("rules[1].parent", "unknown_parent") in codes(parsed)
    assert ("rules[0]", "not_an_object") in codes(parsed)
