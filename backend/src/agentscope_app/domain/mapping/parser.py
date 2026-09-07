"""Turn a mapping document (plain dict) into a validated ``MappingSpec``.

Stage 1 (schema): shapes and types of the document. Stage 2 (semantic):
targets, types, units, keys, references. Both stages report every problem
they can find instead of stopping at the first. Content problems never raise;
they come back as issues so a draft can still be shown and corrected.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

from agentscope_app.domain.errors import Severity, ValidationIssue
from agentscope_app.domain.mapping.contract import (
    BOUNDS,
    CONDITION_OPERATORS,
    DSL_VERSION,
    INPUT_FORMATS,
    ON_INVALID_POLICIES,
    ON_MISSING_POLICIES,
    Condition,
    FieldMapping,
    MappingSpec,
    ParsedMapping,
    Rule,
    UnmappedPath,
)
from agentscope_app.domain.mapping.paths import Path, PathSyntaxError, parse_path
from agentscope_app.domain.mapping.transforms import (
    ENUM_UNMAPPED_POLICIES,
    TRANSFORM_NAMES,
    Transform,
)
from agentscope_app.domain.schema import (
    TARGET_SCHEMA,
    TARGET_SCHEMA_VERSION,
    FieldType,
    TargetField,
)
from agentscope_app.domain.units import DURATION_UNITS, TIMESTAMP_FORMATS

_DOC_KEYS = frozenset(
    {
        "dsl_version",
        "target_schema_version",
        "name",
        "source",
        "input_format",
        "rules",
        "unmapped",
        "notes",
    }
)
_RULE_KEYS = frozenset({"id", "entity", "select", "where", "parent", "native_key", "fields"})
_FIELD_KEYS = frozenset(
    {
        "path",
        "paths",
        "literal",
        "transforms",
        "type",
        "timestamp_format",
        "unit",
        "empty_as_missing",
        "on_missing",
        "default",
        "on_invalid",
        "bounds",
    }
)
_CONDITION_KEYS = frozenset({"path", "op", "value"})
_RULE_ID = re.compile(r"[A-Za-z_][A-Za-z0-9_-]*")
_REQUIRED_DOC_KEYS = ("name", "source", "input_format")


class _Issues:
    def __init__(self) -> None:
        self.items: list[ValidationIssue] = []

    def error(self, stage: str, path: str, code: str, message: str) -> None:
        self.items.append(ValidationIssue(stage, path, code, message))

    def warning(self, stage: str, path: str, code: str, message: str) -> None:
        self.items.append(ValidationIssue(stage, path, code, message, Severity.WARNING))

    def unknown_keys(self, obj: Mapping[str, Any], known: frozenset[str], path: str) -> None:
        for key in obj:
            if key not in known:
                location = f"{path}.{key}" if path else str(key)
                self.warning("schema", location, "unknown_key", f"Unknown key {key!r} is ignored")


def parse_mapping(raw: Any) -> ParsedMapping:
    issues = _Issues()
    if not isinstance(raw, Mapping):
        issues.error("schema", "$", "not_an_object", "A mapping document must be a JSON object")
        return ParsedMapping(None, tuple(issues.items))
    issues.unknown_keys(raw, _DOC_KEYS, "")

    if not _is_version(raw.get("dsl_version"), DSL_VERSION):
        issues.error(
            "schema",
            "dsl_version",
            "unsupported_version",
            f"dsl_version must be {DSL_VERSION}, got {raw.get('dsl_version')!r}",
        )
    if not _is_version(raw.get("target_schema_version"), TARGET_SCHEMA_VERSION):
        issues.error(
            "schema",
            "target_schema_version",
            "unsupported_version",
            f"target_schema_version must be {TARGET_SCHEMA_VERSION}, "
            f"got {raw.get('target_schema_version')!r}",
        )
    name = _required_string(raw, "name", issues)
    source = _required_string(raw, "source", issues)
    input_format = _required_string(raw, "input_format", issues)
    if input_format and input_format not in INPUT_FORMATS:
        issues.error(
            "schema",
            "input_format",
            "unknown_input_format",
            f"input_format must be one of {INPUT_FORMATS}, got {input_format!r}",
        )
    notes = _string(raw, "notes", "notes", issues, default="")

    raw_rules = raw.get("rules")
    rules: list[Rule] = []
    if not isinstance(raw_rules, list) or not raw_rules:
        issues.error("schema", "rules", "no_rules", "A mapping needs at least one rule")
    else:
        seen: set[str] = set()
        indexed: list[tuple[int, Rule]] = []  # document index kept for locations
        for index, raw_rule in enumerate(raw_rules):
            rule = _parse_rule(raw_rule, f"rules[{index}]", issues)
            if rule is None:
                continue
            indexed.append((index, rule))
            if rule.id in seen:
                issues.error(
                    "semantic",
                    f"rules[{index}].id",
                    "duplicate_rule_id",
                    f"Rule id {rule.id!r} is used more than once",
                )
            seen.add(rule.id)
            rules.append(rule)
        _check_parents(indexed, issues)

    unmapped = _parse_unmapped(raw.get("unmapped", []), issues)
    spec = MappingSpec(
        dsl_version=DSL_VERSION,
        target_schema_version=TARGET_SCHEMA_VERSION,
        name=name,
        source=source,
        input_format=input_format,
        rules=tuple(rules),
        unmapped=tuple(unmapped),
        notes=notes,
    )
    return ParsedMapping(spec, tuple(issues.items))


MAX_CONDITION_DEPTH = 16


def _depth(value: Any, limit: int = MAX_CONDITION_DEPTH + 1) -> int:
    """Nesting depth of a JSON value, capped at ``limit`` to stay cheap on hostile input."""
    if not isinstance(value, list | dict) or limit == 0:
        return 0
    children = value.values() if isinstance(value, dict) else value
    return 1 + max((_depth(child, limit - 1) for child in children), default=0)


def _is_version(value: Any, expected: int) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value == expected


def _required_string(obj: Mapping[str, Any], key: str, issues: _Issues) -> str:
    value = obj.get(key)
    if not isinstance(value, str) or not value.strip():
        issues.error(
            "schema", key, "missing_key", f"{key} is required and must be a non-empty string"
        )
        return ""
    return value


def _string(obj: Mapping[str, Any], key: str, path: str, issues: _Issues, *, default: str) -> str:
    value = obj.get(key, default)
    if not isinstance(value, str):
        issues.error("schema", path, "invalid_type", f"{key} must be a string")
        return default
    return value


def _parse_rule(raw_rule: Any, path: str, issues: _Issues) -> Rule | None:
    if not isinstance(raw_rule, Mapping):
        issues.error("schema", path, "not_an_object", "A rule must be a JSON object")
        return None
    issues.unknown_keys(raw_rule, _RULE_KEYS, path)
    rule_id = _string(raw_rule, "id", f"{path}.id", issues, default="")
    if not rule_id:
        issues.error("schema", f"{path}.id", "missing_id", "A rule needs a non-empty id")
        rule_id = path
    elif not _RULE_ID.fullmatch(rule_id):
        issues.error(
            "schema",
            f"{path}.id",
            "invalid_id",
            "Rule ids must match [A-Za-z_][A-Za-z0-9_-]* (they form provenance paths)",
        )
    entity_name = _string(raw_rule, "entity", f"{path}.entity", issues, default="")
    entity = TARGET_SCHEMA.get(entity_name)
    if entity is None:
        issues.error(
            "semantic",
            f"{path}.entity",
            "unknown_entity",
            f"Unknown entity {entity_name!r}; expected one of {sorted(TARGET_SCHEMA)}",
        )
    select = _path(raw_rule.get("select", "$"), f"{path}.select", issues, allow_wildcard=True)
    if select is None:
        select = parse_path("$")

    where: list[Condition] = []
    raw_where = raw_rule.get("where", [])
    if not isinstance(raw_where, list):
        issues.error("schema", f"{path}.where", "invalid_type", "where must be a list")
    else:
        for i, raw_cond in enumerate(raw_where):
            cond = _parse_condition(raw_cond, f"{path}.where[{i}]", issues)
            if cond is not None:
                where.append(cond)

    parent = raw_rule.get("parent")
    if parent is not None and not isinstance(parent, str):
        issues.error("schema", f"{path}.parent", "invalid_type", "parent must be a rule id string")
        parent = None

    fields: dict[str, FieldMapping] = {}
    raw_fields = raw_rule.get("fields")
    if not isinstance(raw_fields, Mapping) or not raw_fields:
        issues.error(
            "schema", f"{path}.fields", "no_fields", "A rule needs at least one field mapping"
        )
    elif entity is not None:
        for target, raw_field in raw_fields.items():
            target_field = entity.fields.get(str(target))
            if target_field is None:
                issues.error(
                    "semantic",
                    f"{path}.fields.{target}",
                    "unknown_field",
                    f"{entity_name} has no field {target!r}; "
                    f"expected one of {sorted(entity.fields)}",
                )
                continue
            fm = _parse_field(raw_field, target_field, f"{path}.fields.{target}", issues)
            if fm is not None:
                fields[str(target)] = fm
        required = [f.name for f in entity.fields.values() if f.required and f.name not in fields]
        if entity_name == "tool_call" and parent is not None:
            required = [r for r in required if r != "session_external_id"]
        if required:
            issues.error(
                "semantic",
                f"{path}.fields",
                "required_field_unmapped",
                f"Required fields of {entity_name} are not mapped: {required}",
            )

    raw_key = raw_rule.get("native_key")
    native_key: tuple[str, ...]
    if raw_key is None:
        native_key = ("external_id",) if "external_id" in fields else ()
    elif isinstance(raw_key, list) and all(isinstance(k, str) for k in raw_key):
        native_key = tuple(raw_key)
        unmapped_keys = [k for k in native_key if k not in fields]
        if unmapped_keys:
            issues.error(
                "semantic",
                f"{path}.native_key",
                "native_key_unmapped",
                f"native_key fields are not mapped in this rule: {unmapped_keys}",
            )
    else:
        issues.error(
            "schema", f"{path}.native_key", "invalid_type", "native_key must be a list of names"
        )
        native_key = ()
    return Rule(rule_id, entity_name, select, fields, tuple(where), parent, native_key)


def _check_parents(indexed: list[tuple[int, Rule]], issues: _Issues) -> None:
    by_id = {r.id: r for _, r in indexed}
    position = {r.id: i for i, r in indexed}
    for index, rule in indexed:
        if rule.parent is None:
            continue
        path = f"rules[{index}].parent"
        if rule.entity != "tool_call":
            issues.error(
                "semantic", path, "parent_not_allowed", "Only tool_call rules may declare a parent"
            )
            continue
        parent = by_id.get(rule.parent)
        if parent is None:
            issues.error(
                "semantic", path, "unknown_parent", f"Parent rule {rule.parent!r} does not exist"
            )
        elif parent.entity != "model_call" or parent.select.segments:
            issues.error(
                "semantic",
                path,
                "parent_not_root",
                "A parent must be a model_call rule whose select is exactly '$'",
            )
        elif position[parent.id] > index:
            issues.error(
                "semantic",
                path,
                "parent_order",
                f"Parent rule {rule.parent!r} must be declared before the rule that uses it",
            )


def _parse_condition(raw: Any, path: str, issues: _Issues) -> Condition | None:
    if not isinstance(raw, Mapping):
        issues.error("schema", path, "not_an_object", "A condition must be a JSON object")
        return None
    issues.unknown_keys(raw, _CONDITION_KEYS, path)
    cond_path = _path(raw.get("path"), f"{path}.path", issues, allow_wildcard=False)
    op = raw.get("op")
    if op not in CONDITION_OPERATORS:
        issues.error(
            "semantic",
            f"{path}.op",
            "unknown_operator",
            f"Operator {op!r} is not one of {CONDITION_OPERATORS}",
        )
        return None
    value = raw.get("value")
    if _depth(value) > MAX_CONDITION_DEPTH:
        issues.error(
            "semantic",
            f"{path}.value",
            "invalid_condition_value",
            f"Condition values may not be nested deeper than {MAX_CONDITION_DEPTH}",
        )
        return None
    if op in ("in", "not_in") and not isinstance(value, list):
        issues.error(
            "semantic",
            f"{path}.value",
            "invalid_condition_value",
            f"Operator {op!r} needs a list value",
        )
        return None
    if op in ("exists", "not_exists") and "value" in raw:
        issues.warning(
            "semantic", f"{path}.value", "ignored_value", f"Operator {op!r} ignores value"
        )
    if cond_path is None:
        return None
    return Condition(cond_path, str(op), value)


def _path(raw: Any, path: str, issues: _Issues, *, allow_wildcard: bool) -> Path | None:
    if not isinstance(raw, str):
        issues.error(
            "schema", path, "invalid_path", "A path must be a string like '$.field' or '@root.x'"
        )
        return None
    try:
        parsed = parse_path(raw)
    except PathSyntaxError as exc:
        issues.error("schema", path, "invalid_path", str(exc))
        return None
    if parsed.has_wildcard and not allow_wildcard:
        issues.error(
            "semantic",
            path,
            "wildcard_in_field_path",
            f"Field paths cannot contain '[*]': {raw!r}",
        )
        return None
    return parsed


def _parse_field(raw: Any, target: TargetField, path: str, issues: _Issues) -> FieldMapping | None:
    if not isinstance(raw, Mapping):
        issues.error("schema", path, "not_an_object", "A field mapping must be a JSON object")
        return None
    issues.unknown_keys(raw, _FIELD_KEYS, path)
    sources = [k for k in ("path", "paths", "literal") if k in raw]
    if len(sources) != 1:
        issues.error(
            "semantic",
            path,
            "ambiguous_source",
            "A field mapping needs exactly one of path, paths or literal",
        )
        return None
    bounds = raw.get("bounds")
    if bounds is not None:
        if bounds not in BOUNDS:
            issues.error(
                "semantic", f"{path}.bounds", "unknown_policy", f"bounds must be one of {BOUNDS}"
            )
            return None
        if target.type is not FieldType.TIMESTAMP:
            issues.error(
                "semantic",
                f"{path}.bounds",
                "bounds_not_applicable",
                "bounds only applies to timestamp fields",
            )
            return None
        if "path" not in raw:
            issues.error(
                "semantic",
                f"{path}.bounds",
                "bounds_requires_wildcard_path",
                "bounds needs a single path containing '[*]'",
            )
            return None
    paths: list[Path] = []
    if "path" in raw:
        single = _path(raw["path"], f"{path}.path", issues, allow_wildcard=bounds is not None)
        if single is None:
            return None
        if bounds is not None and not single.has_wildcard:
            issues.error(
                "semantic",
                f"{path}.bounds",
                "bounds_requires_wildcard_path",
                "bounds needs a path containing '[*]' to select several timestamps",
            )
            return None
        paths.append(single)
    elif "paths" in raw:
        if not isinstance(raw["paths"], list) or not raw["paths"]:
            issues.error(
                "schema", f"{path}.paths", "invalid_type", "paths must be a non-empty list"
            )
            return None
        for i, item in enumerate(raw["paths"]):
            candidate = _path(item, f"{path}.paths[{i}]", issues, allow_wildcard=False)
            if candidate is None:
                return None
            paths.append(candidate)

    transforms: list[Transform] = []
    raw_transforms = raw.get("transforms", [])
    if not isinstance(raw_transforms, list):
        issues.error("schema", f"{path}.transforms", "invalid_type", "transforms must be a list")
    else:
        for i, item in enumerate(raw_transforms):
            transform = _parse_transform(item, f"{path}.transforms[{i}]", issues)
            if transform is not None:
                transforms.append(transform)

    declared_type = raw.get("type")
    if declared_type is not None and declared_type != target.type.value:
        issues.error(
            "semantic",
            f"{path}.type",
            "type_mismatch",
            f"{target.name} is {target.type.value} in the target schema, not {declared_type!r}",
        )

    timestamp_format = raw.get("timestamp_format")
    if timestamp_format is not None:
        if target.type is not FieldType.TIMESTAMP:
            issues.warning(
                "semantic",
                f"{path}.timestamp_format",
                "ignored_option",
                "timestamp_format only applies to timestamp fields",
            )
        elif timestamp_format not in TIMESTAMP_FORMATS:
            issues.error(
                "semantic",
                f"{path}.timestamp_format",
                "unknown_timestamp_format",
                f"timestamp_format must be one of {TIMESTAMP_FORMATS}",
            )
    elif target.type is FieldType.TIMESTAMP:
        timestamp_format = "iso8601"

    unit_from = unit_to = None
    raw_unit = raw.get("unit")
    if raw_unit is not None:
        if (
            not isinstance(raw_unit, Mapping)
            or not isinstance(raw_unit.get("from"), str)
            or not isinstance(raw_unit.get("to"), str)
        ):
            issues.error(
                "schema", f"{path}.unit", "invalid_type", "unit must be an object {from, to}"
            )
        elif target.unit not in DURATION_UNITS:
            issues.error(
                "semantic",
                f"{path}.unit",
                "unit_not_applicable",
                f"{target.name} has no convertible unit (canonical unit: {target.unit})",
            )
        elif raw_unit["to"] != target.unit:
            issues.error(
                "semantic",
                f"{path}.unit",
                "unit_target_mismatch",
                f"unit.to must be the canonical unit {target.unit!r}",
            )
        elif raw_unit["from"] not in DURATION_UNITS:
            issues.error(
                "semantic",
                f"{path}.unit",
                "unknown_unit",
                f"unit.from must be one of {sorted(DURATION_UNITS)}",
            )
        else:
            unit_from, unit_to = raw_unit["from"], raw_unit["to"]

    empty_as_missing = raw.get("empty_as_missing", False)
    if not isinstance(empty_as_missing, bool):
        issues.error(
            "schema", f"{path}.empty_as_missing", "invalid_type", "empty_as_missing must be boolean"
        )
        empty_as_missing = False
    on_missing = raw.get("on_missing", "null")
    if on_missing not in ON_MISSING_POLICIES:
        issues.error(
            "semantic",
            f"{path}.on_missing",
            "unknown_policy",
            f"on_missing must be one of {ON_MISSING_POLICIES}",
        )
    if on_missing == "default" and "default" not in raw:
        issues.error(
            "semantic",
            f"{path}.default",
            "default_required",
            "on_missing 'default' needs a default value",
        )
    on_invalid = raw.get("on_invalid", "reject")
    if on_invalid not in ON_INVALID_POLICIES:
        issues.error(
            "semantic",
            f"{path}.on_invalid",
            "unknown_policy",
            f"on_invalid must be one of {ON_INVALID_POLICIES}",
        )

    return FieldMapping(
        target=target.name,
        type=target.type,
        paths=tuple(paths),
        literal=raw.get("literal"),
        has_literal="literal" in raw,
        transforms=tuple(transforms),
        timestamp_format=timestamp_format if target.type is FieldType.TIMESTAMP else None,
        unit_from=unit_from,
        unit_to=unit_to,
        empty_as_missing=empty_as_missing,
        on_missing=str(on_missing),
        default=raw.get("default"),
        on_invalid=str(on_invalid),
        bounds=bounds,
    )


def _parse_transform(raw: Any, path: str, issues: _Issues) -> Transform | None:
    params: Mapping[str, Any]
    if isinstance(raw, str):
        name, params = raw, {}
    elif isinstance(raw, Mapping) and len(raw) == 1:
        name = str(next(iter(raw)))
        raw_params = raw[name]
        if not isinstance(raw_params, Mapping):
            issues.error(
                "schema",
                path,
                "invalid_transform_params",
                f"Parameters of {name!r} must be an object",
            )
            return None
        params = raw_params
    else:
        issues.error("schema", path, "invalid_type", "A transform is a name or a single-key object")
        return None
    if name not in TRANSFORM_NAMES:
        issues.error(
            "semantic",
            path,
            "unknown_transform",
            f"Transform {name!r} is not allowed; allowed: {TRANSFORM_NAMES}",
        )
        return None
    if name == "enum_map":
        mapping = params.get("mapping")
        policy = params.get("unmapped", "reject")
        if not isinstance(mapping, Mapping) or policy not in ENUM_UNMAPPED_POLICIES:
            issues.error(
                "semantic",
                path,
                "invalid_transform_params",
                "enum_map needs {mapping: {..}, unmapped: keep|null|reject}",
            )
            return None
    elif params:
        issues.warning(
            "semantic", path, "ignored_params", f"Transform {name!r} takes no parameters"
        )
    return Transform(name, dict(params))


def _parse_unmapped(raw: Any, issues: _Issues) -> list[UnmappedPath]:
    result: list[UnmappedPath] = []
    if not isinstance(raw, list):
        issues.error("schema", "unmapped", "invalid_type", "unmapped must be a list")
        return result
    for i, item in enumerate(raw):
        if not isinstance(item, Mapping) or not isinstance(item.get("path"), str):
            issues.error(
                "schema", f"unmapped[{i}]", "invalid_type", "Each unmapped entry needs a path"
            )
            continue
        reason = item.get("reason")
        if not isinstance(reason, str) or not reason.strip():
            issues.error(
                "semantic", f"unmapped[{i}].reason", "missing_reason", "Explain why it is unmapped"
            )
            continue
        result.append(UnmappedPath(item["path"], reason))
    return result
