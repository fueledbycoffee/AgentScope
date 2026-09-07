import copy
import json
from collections.abc import Callable
from importlib import resources
from typing import Any

import jsonschema
import pytest

from agentscope_app.domain.mapping.parser import parse_mapping
from tests.domain.test_parser import VALID

SCHEMA: dict[str, Any] = json.loads(
    resources.files("agentscope_app.domain.mapping")
    .joinpath("mapping-dsl-v1.schema.json")
    .read_text(encoding="utf-8")
)


def test_schema_is_a_valid_draft_2020_12_schema() -> None:
    jsonschema.Draft202012Validator.check_schema(SCHEMA)


def test_valid_document_passes_schema_and_parser() -> None:
    jsonschema.validate(VALID, SCHEMA)
    assert parse_mapping(VALID).is_executable


def _rules_not_a_list(d: dict[str, Any]) -> None:
    d["rules"] = "x"


def _path_not_a_string(d: dict[str, Any]) -> None:
    d["rules"][0]["fields"] = {"external_id": {"path": 3}}


def _bad_policy(d: dict[str, Any]) -> None:
    d["rules"][0]["fields"]["external_id"]["on_missing"] = "explode"


def _bad_operator(d: dict[str, Any]) -> None:
    d["rules"][1]["where"][0]["op"] = "matches"


def _bad_transform(d: dict[str, Any]) -> None:
    d["rules"][2]["fields"]["tool_name"]["transforms"] = [{"eval": {}}]


def _version_as_string(d: dict[str, Any]) -> None:
    d["dsl_version"] = "1"


def _version_as_boolean(d: dict[str, Any]) -> None:
    d["target_schema_version"] = True


def _wildcard_in_field(d: dict[str, Any]) -> None:
    d["rules"][0]["fields"]["external_id"]["path"] = "$.ids[*]"


def _no_source_in_field(d: dict[str, Any]) -> None:
    d["rules"][0]["fields"]["external_id"] = {"transforms": ["trim"]}


def _null_unit(d: dict[str, Any]) -> None:
    d["rules"][2]["fields"]["wall_latency_ms"]["unit"] = None


def _null_timestamp_format(d: dict[str, Any]) -> None:
    d["rules"][1]["fields"]["started_at"]["timestamp_format"] = None


def _null_type(d: dict[str, Any]) -> None:
    d["rules"][1]["fields"]["external_id"]["type"] = None


def _null_bounds(d: dict[str, Any]) -> None:
    d["rules"][1]["fields"]["started_at"]["bounds"] = None


def _null_transforms(d: dict[str, Any]) -> None:
    d["rules"][2]["fields"]["tool_name"]["transforms"] = None


def _null_native_key(d: dict[str, Any]) -> None:
    d["rules"][1]["native_key"] = None


def _path_too_deep(d: dict[str, Any]) -> None:
    d["rules"][0]["select"] = "$" + ".a" * 17


def _field_path_too_deep(d: dict[str, Any]) -> None:
    d["rules"][0]["fields"]["external_id"]["path"] = "$" + ".a" * 17


@pytest.mark.parametrize(
    "mutate",
    [
        _rules_not_a_list,
        _path_not_a_string,
        _bad_policy,
        _bad_operator,
        _bad_transform,
        _version_as_string,
        _version_as_boolean,
        _wildcard_in_field,
        _no_source_in_field,
        _null_unit,
        _null_timestamp_format,
        _null_type,
        _null_bounds,
        _null_transforms,
        _null_native_key,
        _path_too_deep,
        _field_path_too_deep,
    ],
)
def test_schema_and_parser_agree_on_structural_rejections(
    mutate: Callable[[dict[str, Any]], None],
) -> None:
    doc = copy.deepcopy(VALID)
    mutate(doc)
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(doc, SCHEMA)
    assert not parse_mapping(doc).is_executable


def test_schema_rejects_rule_ids_that_would_break_provenance_paths() -> None:
    doc = copy.deepcopy(VALID)
    doc["rules"][0]["id"] = "t[0]"
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(doc, SCHEMA)
    assert not parse_mapping(doc).is_executable


def test_schema_and_parser_both_require_document_metadata() -> None:
    for key in ("name", "source", "input_format"):
        doc = copy.deepcopy(VALID)
        del doc[key]
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(doc, SCHEMA)
        assert not parse_mapping(doc).is_executable
