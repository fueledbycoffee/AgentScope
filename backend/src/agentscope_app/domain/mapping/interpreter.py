"""Apply a validated mapping to one source record.

No code from the mapping ever runs: the interpreter walks the AST, reads
values through the restricted path language, applies allowlisted transforms
and strict conversions, and reports every problem as a reject or warning.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from agentscope_app.domain.errors import ConversionError
from agentscope_app.domain.identity import SourceOccurrence
from agentscope_app.domain.mapping.contract import Condition, FieldMapping, MappingSpec, Rule
from agentscope_app.domain.mapping.paths import MISSING, resolve_many, resolve_one
from agentscope_app.domain.mapping.transforms import apply_transform
from agentscope_app.domain.schema import TARGET_SCHEMA, FieldType
from agentscope_app.domain.units import coerce, convert_duration


@dataclass(frozen=True)
class Diagnostic:
    """A non-fatal observation about an emission (stored as a warning)."""

    rule_id: str
    occurrence: SourceOccurrence
    code: str
    message: str
    field: str | None = None


@dataclass(frozen=True)
class Reject:
    """An item that could not be turned into an entity, with the reason."""

    rule_id: str
    occurrence: SourceOccurrence
    code: str
    message: str
    field: str | None = None


@dataclass(frozen=True)
class Emission:
    """One entity observation produced by one rule on one item."""

    entity: str
    rule_id: str
    occurrence: SourceOccurrence
    fields: dict[str, Any]
    native_key: tuple[str, ...] | None = None  # claimed native identity, one part per key field
    parent_occurrence: SourceOccurrence | None = None


@dataclass(frozen=True)
class RecordResult:
    emissions: tuple[Emission, ...] = field(default_factory=tuple)
    rejects: tuple[Reject, ...] = field(default_factory=tuple)
    warnings: tuple[Diagnostic, ...] = field(default_factory=tuple)


class _FieldRejectError(Exception):
    def __init__(self, code: str, message: str, field_name: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.field_name = field_name


def apply_mapping(
    spec: MappingSpec,
    record: Any,
    *,
    file_sha256: str,
    locator: str,
    max_items_per_selector: int = 10_000,
) -> RecordResult:
    emissions: list[Emission] = []
    rejects: list[Reject] = []
    warnings: list[Diagnostic] = []
    root_emissions: dict[str, Emission] = {}  # rule id -> emission for root-selected rules

    for rule in spec.rules:
        rule_occurrence = SourceOccurrence(file_sha256, locator, rule.id)
        try:
            items = resolve_many(rule.select, record, record, limit=max_items_per_selector)
        except ValueError as exc:
            rejects.append(Reject(rule.id, rule_occurrence, "selector_limit", str(exc)))
            continue
        is_root = not rule.select.segments
        for index, item in enumerate(items):
            if not all(_holds(cond, item, record) for cond in rule.where):
                continue
            emission_path = rule.id if is_root else f"{rule.id}[{index}]"
            occurrence = SourceOccurrence(file_sha256, locator, emission_path)
            try:
                emission = _emit(rule, item, record, occurrence, root_emissions, warnings)
            except _FieldRejectError as fr:
                rejects.append(Reject(rule.id, occurrence, fr.code, fr.message, fr.field_name))
                continue
            except Exception as exc:  # noqa: BLE001 - a rule must never take the import down
                message = f"{type(exc).__name__}: {exc}"
                rejects.append(Reject(rule.id, occurrence, "internal_error", message))
                continue
            emissions.append(emission)
            if is_root:
                root_emissions[rule.id] = emission
    return RecordResult(tuple(emissions), tuple(rejects), tuple(warnings))


def _holds(cond: Condition, item: Any, root: Any) -> bool:
    value = resolve_one(cond.path, item, root)
    if cond.op == "exists":
        return value is not MISSING
    if cond.op == "not_exists":
        return value is MISSING
    if value is MISSING:
        return cond.op in ("ne", "not_in")
    if cond.op == "eq":
        return bool(value == cond.value)
    if cond.op == "ne":
        return bool(value != cond.value)
    if cond.op == "in":
        return value in cond.value
    return value not in cond.value


def _emit(
    rule: Rule,
    item: Any,
    root: Any,
    occurrence: SourceOccurrence,
    root_emissions: dict[str, Emission],
    warnings: list[Diagnostic],
) -> Emission:
    entity = TARGET_SCHEMA[rule.entity]
    values: dict[str, Any] = {}
    for target, fm in rule.fields.items():
        try:
            values[target] = _evaluate(fm, item, root, rule, occurrence, warnings)
        except _FieldRejectError as fr:
            raise _FieldRejectError(fr.code, fr.message, target) from fr

    parent_occurrence = None
    if rule.parent is not None:
        parent = root_emissions.get(rule.parent)
        if parent is None:
            warnings.append(
                Diagnostic(
                    rule.id,
                    occurrence,
                    "parent_unavailable",
                    f"Parent rule {rule.parent!r} produced no entity for this record",
                )
            )
        else:
            parent_occurrence = parent.occurrence
            parent_session = parent.fields.get("session_external_id")
            child_session = values.get("session_external_id")
            if child_session is None:
                values["session_external_id"] = parent_session
            elif parent_session is not None and child_session != parent_session:
                raise _FieldRejectError(
                    "conflicting_relationship",
                    f"Tool call session {child_session!r} differs from its parent model call "
                    f"session {parent_session!r}",
                    "session_external_id",
                )
        if values.get("session_external_id") is None:
            raise _FieldRejectError(
                "missing_relationship",
                "Tool call has no parent model call and no session_external_id",
                "session_external_id",
            )

    for name, target_field in entity.fields.items():
        if target_field.required and values.get(name) is None:
            raise _FieldRejectError(
                "missing_required", f"Required field {name!r} of {rule.entity} is missing", name
            )

    native_key: tuple[str, ...] | None = None
    if rule.native_key:
        parts = [values.get(k) for k in rule.native_key]
        if all(p is not None for p in parts):
            native_key = tuple(str(p) for p in parts)
    return Emission(rule.entity, rule.id, occurrence, values, native_key, parent_occurrence)


def _evaluate(
    fm: FieldMapping,
    item: Any,
    root: Any,
    rule: Rule,
    occurrence: SourceOccurrence,
    warnings: list[Diagnostic],
) -> Any:
    if fm.has_literal:
        value: Any = fm.literal
        state = "null" if value is None else "present"
    else:
        value, state = MISSING, "absent"
        for path in fm.paths:
            value = resolve_one(path, item, root)
            if value is not MISSING:
                state = "null" if value is None else "present"
                break
    if (
        state == "present"
        and fm.empty_as_missing
        and isinstance(value, str)
        and value.strip() == ""
    ):
        state = "empty"
    if state != "present":
        if fm.on_missing == "reject":
            raise _FieldRejectError(
                "missing_value", f"{fm.target} is {state} and the mapping rejects missing values"
            )
        if fm.on_missing == "default":
            value = fm.default
        else:
            warnings.append(
                Diagnostic(
                    rule.id, occurrence, state, f"{fm.target} is {state}; stored as null", fm.target
                )
            )
            return None
    try:
        for transform in fm.transforms:
            value = apply_transform(transform, value)
            if value is None:
                return None
        if fm.unit_from and fm.unit_to:
            # Convert units on the numeric value first; the strict coercion below then
            # rejects anything that is not integral instead of rounding it.
            numeric = coerce(value, FieldType.NUMBER)
            value = convert_duration(numeric, fm.unit_from, fm.unit_to)
        value = coerce(value, fm.type, timestamp_format=fm.timestamp_format)
    except ConversionError as exc:
        if fm.on_invalid == "null":
            warnings.append(
                Diagnostic(
                    rule.id,
                    occurrence,
                    "invalid_value",
                    f"{fm.target}: {exc}; stored as null",
                    fm.target,
                )
            )
            return None
        raise _FieldRejectError("invalid_value", f"{fm.target}: {exc}") from exc
    target_unit = TARGET_SCHEMA[rule.entity].fields[fm.target].unit
    if target_unit in ("ms", "tokens") and isinstance(value, int | float) and value < 0:
        raise _FieldRejectError(
            "negative_measure", f"{fm.target} is negative ({value}); measures cannot be negative"
        )
    return value
