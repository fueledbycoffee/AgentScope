"""Declarative metric vocabulary and framework-free interpretation of aggregates."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType
from typing import Final

from agentscope_app.domain.schema import TARGET_SCHEMA, FieldType


class EntityGrain(StrEnum):
    SESSION = "session"
    MODEL_CALL = "model_call"
    TOOL_CALL = "tool_call"
    IMPORT = "import"


class Aggregation(StrEnum):
    COUNT = "count"
    SUM = "sum"


class ComparabilityRule(StrEnum):
    OBSERVATIONS = "observations"
    TOKEN_SEMANTICS = "token_semantics"


class Dimension(StrEnum):
    SOURCE = "source"
    AGENT = "agent"
    MODEL = "model"
    STARTED_DAY = "started_day"
    TOOL_NAME = "tool_name"
    LINKED = "linked"
    SESSION_ID = "session_id"  # internal batch operation, not an HTTP dimension


MEASURES: Final = MappingProxyType(
    {
        EntityGrain.SESSION: (),
        EntityGrain.MODEL_CALL: (
            "input_tokens",
            "output_tokens",
            "cache_read_tokens",
            "cache_creation_tokens",
            "reasoning_tokens",
        ),
        EntityGrain.TOOL_CALL: ("wall_latency_ms", "internal_latency_ms", "exit_code"),
        EntityGrain.IMPORT: (),
    }
)
DIMENSIONS: Final = MappingProxyType(
    {
        EntityGrain.SESSION: (Dimension.SOURCE, Dimension.AGENT, Dimension.SESSION_ID),
        EntityGrain.MODEL_CALL: (
            Dimension.SOURCE,
            Dimension.AGENT,
            Dimension.MODEL,
            Dimension.STARTED_DAY,
            Dimension.SESSION_ID,
        ),
        EntityGrain.TOOL_CALL: (
            Dimension.SOURCE,
            Dimension.AGENT,
            Dimension.TOOL_NAME,
            Dimension.STARTED_DAY,
            Dimension.LINKED,
            Dimension.SESSION_ID,
        ),
        EntityGrain.IMPORT: (),
    }
)


@dataclass(frozen=True)
class MetricDefinition:
    id: str
    version: int
    label: str
    description: str
    grain: EntityGrain
    operation: Aggregation
    field: str | None
    unit: str
    formula: str
    scope: str
    null_handling: str
    coverage_field: str | None = None
    semantics_field: str | None = None
    comparability_rule: ComparabilityRule = ComparabilityRule.OBSERVATIONS
    population: str | None = None

    @property
    def supported_dimensions(self) -> tuple[Dimension, ...]:
        return tuple(d for d in DIMENSIONS[self.grain] if d != Dimension.SESSION_ID)


@dataclass(frozen=True, init=False)
class MetricRegistry:
    definitions: Mapping[str, MetricDefinition]

    def __init__(self, definitions: Sequence[MetricDefinition]) -> None:
        items: dict[str, MetricDefinition] = {}
        for definition in definitions:
            self._validate(definition)
            if definition.id in items:
                raise ValueError(f"Duplicate metric ID: {definition.id}")
            items[definition.id] = definition
        object.__setattr__(self, "definitions", MappingProxyType(items))

    def get(self, metric_id: str) -> MetricDefinition:
        try:
            return self.definitions[metric_id]
        except KeyError:
            raise ValueError(f"Unknown metric ID: {metric_id}") from None

    @staticmethod
    def _validate(d: MetricDefinition) -> None:
        if (
            not d.id
            or d.version < 1
            or not all((d.label, d.description, d.formula, d.scope, d.null_handling))
        ):
            raise ValueError("Definitions require ID, positive version and complete metadata")
        if d.grain not in MEASURES or d.operation not in tuple(Aggregation):
            raise ValueError("Unsupported grain or operation")
        if d.operation == Aggregation.COUNT:
            if d.field is not None or d.coverage_field is not None or d.unit != "count":
                raise ValueError(
                    "Counts use canonical identities, count units and complete coverage"
                )
        else:
            if d.field not in MEASURES[d.grain]:
                raise ValueError(f"Unresolvable measure: {d.grain}.{d.field}")
            assert d.field is not None
            target = TARGET_SCHEMA[d.grain].fields[d.field]
            if target.type != FieldType.INTEGER or d.unit != (target.unit or "count"):
                raise ValueError("Measure type or canonical unit mismatch")
            if d.coverage_field != d.field:
                raise ValueError("Sum coverage must count the same measure")
        if d.comparability_rule not in tuple(ComparabilityRule):
            raise ValueError("Unsupported comparability rule")
        tokens = d.unit == "tokens"
        if tokens != (d.comparability_rule == ComparabilityRule.TOKEN_SEMANTICS):
            raise ValueError("Token measures require accounting partitions")
        if d.semantics_field != ("token_semantics" if tokens else None):
            raise ValueError("Invalid semantics field")
        allowed_populations = {
            "tool_is_unlinked": EntityGrain.TOOL_CALL,
            "usage_missing": EntityGrain.MODEL_CALL,
            "timestamp_missing": EntityGrain.MODEL_CALL,
        }
        if d.population is not None and allowed_populations.get(d.population) != d.grain:
            raise ValueError("Unsupported population predicate")


@dataclass(frozen=True)
class AggregatePart:
    value: int | None
    known: int
    total: int
    semantics: str | None = None


@dataclass(frozen=True)
class Evaluation:
    value: int | None
    recorded_sum: int | None
    known: int
    total: int
    comparability: str
    reason: str


def evaluate(definition: MetricDefinition, parts: Sequence[AggregatePart]) -> Evaluation:
    """All-null partitions affect coverage, never the comparability of known usage."""
    known = sum(p.known for p in parts)
    total = sum(p.total for p in parts)
    recorded: int | None = sum(p.value for p in parts if p.value is not None)
    if definition.operation == Aggregation.SUM and known == 0:
        recorded = None
    if definition.comparability_rule == ComparabilityRule.OBSERVATIONS:
        return Evaluation(
            recorded,
            recorded,
            known,
            total,
            "not_applicable",
            "Recorded observations in scope; no equivalent-workload claim.",
        )
    tags = {p.semantics for p in parts if p.known}
    if not tags:
        status, reason = "unknown", "No known usage in scope."
    elif "unknown" in tags or None in tags:
        status, reason = "unknown", "Contributing usage has unvalidated accounting."
        if len(tags) > 1:
            reason += " Multiple accounting tags are present."
    elif len(tags) > 1:
        status, reason = "mixed", "Contributing accounting tags differ; use the partition values."
    else:
        status, reason = "comparable", "Known usage shares one accounting tag."
    return Evaluation(
        recorded if status == "comparable" else None, recorded, known, total, status, reason
    )


def _count(
    metric_id: str, grain: EntityGrain, description: str, population: str | None = None
) -> MetricDefinition:
    return MetricDefinition(
        metric_id,
        1,
        metric_id.replace("_", " ").capitalize(),
        description,
        grain,
        Aggregation.COUNT,
        None,
        "count",
        "Count distinct eligible canonical IDs.",
        description,
        "Every eligible ID contributes; empty population is 0 with coverage 0/0.",
        population=population,
    )


def _sum(metric_id: str, grain: EntityGrain, field: str, unit: str) -> MetricDefinition:
    tokens = unit == "tokens"
    return MetricDefinition(
        metric_id,
        1,
        metric_id.replace("_", " ").capitalize(),
        f"Sum of recorded {grain}.{field}; no fallback or unit conversion.",
        grain,
        Aggregation.SUM,
        field,
        unit,
        f"Sum known {grain}.{field}.",
        "Eligible observations after the shared scope filters; coverage known / eligible rows.",
        "Null excludes a contributor; measured zero contributes; no known values yields null.",
        field,
        "token_semantics" if tokens else None,
        ComparabilityRule.TOKEN_SEMANTICS if tokens else ComparabilityRule.OBSERVATIONS,
    )


REGISTRY: Final = MetricRegistry(
    [
        _count("sessions", EntityGrain.SESSION, "Stored sessions reconciled within each source."),
        _count(
            "model_calls", EntityGrain.MODEL_CALL, "Model-call observations, not unique requests."
        ),
        _count(
            "tool_calls", EntityGrain.TOOL_CALL, "Tool-call observations, including unlinked tools."
        ),
        *[_sum(f, EntityGrain.MODEL_CALL, f, "tokens") for f in MEASURES[EntityGrain.MODEL_CALL]],
        _sum("tool_wall_latency_ms", EntityGrain.TOOL_CALL, "wall_latency_ms", "ms"),
        _sum("tool_internal_latency_ms", EntityGrain.TOOL_CALL, "internal_latency_ms", "ms"),
        _count(
            "unlinked_tools",
            EntityGrain.TOOL_CALL,
            "Tools with no recorded model-call link.",
            "tool_is_unlinked",
        ),
        _count(
            "missing_usage",
            EntityGrain.MODEL_CALL,
            "Model calls with null input_tokens.",
            "usage_missing",
        ),
        _count(
            "unknown_timestamps",
            EntityGrain.MODEL_CALL,
            "Model calls with null started_at.",
            "timestamp_missing",
        ),
        _count(
            "imports_in_scope",
            EntityGrain.IMPORT,
            "Distinct imports contributing sessions or eligible children; child-filtered scopes "
            "require eligible child observations. Duplicate attempts contribute nothing.",
        ),
    ]
)
