"""Declarative metric vocabulary and framework-free interpretation of aggregates."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from enum import StrEnum
from types import MappingProxyType
from typing import Final

from agentscope_app.domain.numbers import Number
from agentscope_app.domain.schema import TARGET_SCHEMA, FieldType


class EntityGrain(StrEnum):
    SESSION = "session"
    MODEL_CALL = "model_call"
    TOOL_CALL = "tool_call"
    IMPORT = "import"


class Aggregation(StrEnum):
    COUNT = "count"
    SUM = "sum"
    OBSERVED_SPAN = "observed_span"
    DISTRIBUTION = "distribution"
    DIAGNOSTIC = "diagnostic"
    COST = "cost"


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
    headline_kpi: bool = False
    caveat: str | None = None
    quantile_rule: str = "nearest-rank: sorted[ceil(p*n)-1]"
    median_rule: str = "middle value; average the two middle values for even n"
    display_decimal_places: int = 0
    display_rounding: str = "half_even; display only, exact values are preserved"
    diagnostic: bool = False
    model_group_required: bool = False

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
        if d.display_decimal_places < 0:
            raise ValueError("Display precision must be nonnegative")
        if d.diagnostic != (d.operation == Aggregation.DIAGNOSTIC):
            raise ValueError("Diagnostic definitions must be non-executable")
        if d.model_group_required and d.grain != EntityGrain.MODEL_CALL:
            raise ValueError("Model grouping requires model calls")
        if d.operation == Aggregation.DIAGNOSTIC:
            if (d.grain, d.field, d.unit, d.coverage_field) != (
                EntityGrain.MODEL_CALL,
                None,
                "ratio",
                None,
            ):
                raise ValueError("Diagnostic ratio is definitions-only")
        elif d.operation == Aggregation.COST:
            if (d.grain, d.field, d.unit, d.coverage_field) != (
                EntityGrain.MODEL_CALL,
                None,
                "USD",
                None,
            ):
                raise ValueError("Cost requires model usage and USD")
        elif d.operation == Aggregation.COUNT:
            if d.field is not None or d.coverage_field is not None or d.unit != "count":
                raise ValueError(
                    "Counts use canonical identities, count units and complete coverage"
                )
        elif d.operation == Aggregation.OBSERVED_SPAN:
            if (d.grain, d.field, d.unit, d.coverage_field) != (
                EntityGrain.SESSION,
                None,
                "ms",
                None,
            ):
                raise ValueError("Observed span requires session bounds and milliseconds")
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
        tokens = d.unit == "tokens" or d.operation == Aggregation.COST
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
    value: Number | None
    known: int
    total: int
    semantics: str | None = None
    samples: tuple[int, ...] = ()
    priced_tokens: int = 0
    total_tokens: int = 0


@dataclass(frozen=True)
class Evaluation:
    value: Number | None
    recorded_sum: Number | None
    known: int
    total: int
    comparability: str
    reason: str


def evaluate(definition: MetricDefinition, parts: Sequence[AggregatePart]) -> Evaluation:
    """All-null partitions affect coverage, never the comparability of known usage."""
    known = sum(p.known for p in parts)
    total = sum(p.total for p in parts)
    recorded: Number | None = sum(p.value for p in parts if p.value is not None)
    if definition.operation != Aggregation.COUNT and known == 0:
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
            reason = (
                f"not comparable: {len(tags)} token semantics in selection; unknown is unvalidated"
            )
    elif len(tags) > 1:
        status, reason = "mixed", f"not comparable: {len(tags)} token semantics in selection"
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
        {
            "model_calls": "Model-call observations",
            "tool_calls": "Tool-call observations",
            "input_tokens": "Input usage by accounting group",
        }.get(metric_id, metric_id.replace("_", " ").capitalize()),
        description,
        grain,
        Aggregation.COUNT,
        None,
        "count",
        "Count distinct eligible canonical IDs.",
        description,
        "Every eligible ID contributes; empty population is 0 with coverage 0/0.",
        population=population,
        headline_kpi=metric_id in {"sessions", "model_calls", "tool_calls"},
    )


def _sum(metric_id: str, grain: EntityGrain, field: str, unit: str) -> MetricDefinition:
    tokens = unit == "tokens"
    return MetricDefinition(
        metric_id,
        1,
        {
            "model_calls": "Model-call observations",
            "tool_calls": "Tool-call observations",
            "input_tokens": "Input usage by accounting group",
        }.get(metric_id, metric_id.replace("_", " ").capitalize()),
        f"Sum of recorded {grain}.{field}; no fallback or unit conversion."
        + (
            " Instrumentation question: do zero/near-zero latencies reflect timer resolution, "
            "missing instrumentation, or real elapsed time? Every recorded value is included."
            if unit == "ms"
            else ""
        ),
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
        headline_kpi=metric_id == "input_tokens",
    )


OBSERVED_SPAN = MetricDefinition(
    id="observed_span_ms",
    version=1,
    label="observed span in imported data",
    description="Sum of full imported observed spans of eligible sessions.",
    grain=EntityGrain.SESSION,
    operation=Aggregation.OBSERVED_SPAN,
    field=None,
    unit="ms",
    formula="Sum (observed_end_at - observed_start_at) in exact milliseconds per session.",
    scope="Eligible sessions; child filters select sessions but do not clip their imported bounds.",
    null_handling="Both bounds required; known zero contributes; no known spans yields null.",
    display_decimal_places=3,
    caveat="May include idle time and resumptions. Neither active time nor task duration. "
    "Overlapping session spans are summed, not unioned; bounds cover full imported sessions.",
)


REGISTRY: Final = MetricRegistry(
    [
        OBSERVED_SPAN,
        MetricDefinition(
            id="scheduled_cost_usd",
            version=1,
            label="Scheduled token cost (USD)",
            description="Priced tokens × exact rates, by accounting group and schedule version.",
            grain=EntityGrain.MODEL_CALL,
            operation=Aggregation.COST,
            field=None,
            unit="USD",
            formula="Sum priced tokens × scheduled USD rate. Priced coverage = tokens with "
            "a rate and validated billing semantics / all recorded input and output tokens.",
            scope="Eligible model-call observations, exact model IDs, one pinned local schedule.",
            null_handling="Missing rates/unvalidated semantics stay unpriced; no priced component "
            "yields null. Known zero contributes. Ordinary coverage counts calls with "
            "any priced component / eligible calls; priced coverage counts tokens.",
            semantics_field="token_semantics",
            comparability_rule=ComparabilityRule.TOKEN_SEMANTICS,
            display_decimal_places=6,
            caveat="Schedule estimate, not an invoice. Codex prefix billing is unknown; "
            "all Codex input stays unpriced without a canonical validated split. Claude prompt "
            "is input minus known cache read and creation; inconsistent splits stay unpriced. "
            "Cache creation has no rate. Reasoning is not added to output. Missing token "
            "quantities cannot enter the denominator: priced coverage describes recorded tokens.",
        ),
        _count("sessions", EntityGrain.SESSION, "Stored sessions reconciled within each source."),
        _count(
            "model_calls", EntityGrain.MODEL_CALL, "Model-call observations, not unique requests."
        ),
        _count(
            "tool_calls", EntityGrain.TOOL_CALL, "Tool-call observations, including unlinked tools."
        ),
        *[
            replace(
                _sum(f, EntityGrain.MODEL_CALL, f, "tokens"),
                model_group_required=f == "reasoning_tokens",
            )
            for f in MEASURES[EntityGrain.MODEL_CALL]
        ],
        replace(
            _sum(
                "reasoning_tokens_distribution",
                EntityGrain.MODEL_CALL,
                "reasoning_tokens",
                "tokens",
            ),
            operation=Aggregation.DISTRIBUTION,
            model_group_required=True,
            display_decimal_places=1,
            formula=(
                "Total and min/median/p90/max of known reasoning tokens per call; "
                "nearest-rank quantiles."
            ),
            scope=(
                "Eligible calls grouped by exact model and compatible accounting; "
                "known calls / eligible calls."
            ),
        ),
        MetricDefinition(
            id="reasoning_to_output_ratio",
            version=1,
            label="Reasoning-to-output accounting diagnostic",
            description=(
                "Definitions-page diagnostic only; inclusion semantics are "
                "unvalidated, not a trend finding."
            ),
            grain=EntityGrain.MODEL_CALL,
            operation=Aggregation.DIAGNOSTIC,
            field=None,
            unit="ratio",
            formula=(
                "Sum known reasoning_tokens / sum output_tokens on the same known paired calls."
            ),
            scope="One compatible model/accounting group; diagnostic only, not executable.",
            null_handling=(
                "Missing pairs excluded; zero output denominator is undefined; "
                "unavailable is not zero."
            ),
            diagnostic=True,
            display_decimal_places=3,
        ),
        *[
            replace(
                _sum(f"tool_{field}_distribution", EntityGrain.TOOL_CALL, field, "ms"),
                operation=Aggregation.DISTRIBUTION,
                display_decimal_places=1,
                formula=f"Total and min/median/p90/max of known {field}; nearest-rank quantiles.",
            )
            for field in ("wall_latency_ms", "internal_latency_ms")
        ],
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
