"""Mapping DSL v1 abstract syntax. Built only by ``parser.parse_mapping``."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Final

from agentscope_app.domain.errors import Severity, ValidationIssue
from agentscope_app.domain.mapping.paths import Path
from agentscope_app.domain.mapping.transforms import Transform
from agentscope_app.domain.schema import FieldType

DSL_VERSION: Final = 1
CONDITION_OPERATORS: Final = ("eq", "ne", "in", "not_in", "exists", "not_exists")
INPUT_FORMATS: Final = ("jsonl", "parquet")
ON_MISSING_POLICIES: Final = ("null", "default", "reject")
ON_INVALID_POLICIES: Final = ("null", "reject")


@dataclass(frozen=True)
class Condition:
    path: Path
    op: str
    value: Any = None


@dataclass(frozen=True)
class FieldMapping:
    target: str
    type: FieldType
    paths: tuple[Path, ...] = ()
    literal: Any = None
    has_literal: bool = False
    transforms: tuple[Transform, ...] = ()
    timestamp_format: str | None = None
    unit_from: str | None = None
    unit_to: str | None = None
    empty_as_missing: bool = False
    on_missing: str = "null"
    default: Any = None
    on_invalid: str = "reject"
    bounds: str | None = None  # "min" | "max" over a wildcard path of timestamps


BOUNDS: Final = ("min", "max")


@dataclass(frozen=True)
class Rule:
    id: str
    entity: str
    select: Path
    fields: dict[str, FieldMapping]
    where: tuple[Condition, ...] = ()
    parent: str | None = None
    native_key: tuple[str, ...] = ()


@dataclass(frozen=True)
class UnmappedPath:
    path: str
    reason: str


@dataclass(frozen=True)
class MappingSpec:
    dsl_version: int
    target_schema_version: int
    name: str
    source: str
    input_format: str
    rules: tuple[Rule, ...]
    unmapped: tuple[UnmappedPath, ...] = ()
    notes: str = ""

    def rule(self, rule_id: str) -> Rule:
        for rule in self.rules:
            if rule.id == rule_id:
                return rule
        raise KeyError(rule_id)


@dataclass(frozen=True)
class ParsedMapping:
    spec: MappingSpec | None
    issues: tuple[ValidationIssue, ...] = field(default_factory=tuple)

    @property
    def errors(self) -> tuple[ValidationIssue, ...]:
        return tuple(i for i in self.issues if i.severity is Severity.ERROR)

    @property
    def warnings(self) -> tuple[ValidationIssue, ...]:
        return tuple(i for i in self.issues if i.severity is Severity.WARNING)

    @property
    def is_executable(self) -> bool:
        return self.spec is not None and not self.errors
