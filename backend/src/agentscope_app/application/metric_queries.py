"""Typed query contracts; no storage or transport types cross the metric port."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta

from agentscope_app.application.dto import Coverage, Metric, SemanticsPartition, TokenCoverage
from agentscope_app.application.errors import InvalidInputError
from agentscope_app.domain.distributions import Distribution, distribution
from agentscope_app.domain.metrics import (
    DIMENSIONS,
    AggregatePart,
    Aggregation,
    Dimension,
    EntityGrain,
    MetricDefinition,
    evaluate,
)
from agentscope_app.domain.numbers import Number, number_text


def invalid(path: str, message: str) -> InvalidInputError:
    return InvalidInputError(message, [{"path": path, "message": message}])


@dataclass(frozen=True)
class TraceScope:
    source: str | None = None
    agent: str | None = None
    model: str | None = None
    tool: str | None = None
    started_from: datetime | None = None
    started_before: datetime | None = None
    import_id: str | None = None
    session_ids: tuple[str, ...] | None = None
    activity_grain: EntityGrain | None = None
    token_semantics: str | None = None
    model_is_unknown: bool = False
    agent_is_unknown: bool = False
    timestamp_missing: bool = False
    tool_is_unlinked: bool = False
    usage_missing: bool = False
    tool_is_linked: bool = False  # inverse null-link bucket drill
    # A day drill narrows its activity grain, preserving the original sibling witnesses.
    witness_time_override: bool = False
    witness_started_from: datetime | None = None
    witness_started_before: datetime | None = None
    witness_timestamp_missing: bool = False

    def __post_init__(self) -> None:
        for name in (
            "started_from",
            "started_before",
            "witness_started_from",
            "witness_started_before",
        ):
            value = getattr(self, name)
            if value is not None:
                if value.tzinfo is None or value.utcoffset() is None:
                    raise invalid(name, "Date bounds must be timezone-aware")
                object.__setattr__(self, name, value.astimezone(UTC))
        if self.started_from and self.started_before and self.started_from >= self.started_before:
            raise invalid("started_before", "Date range must be increasing")
        if self.activity_grain not in (None, EntityGrain.MODEL_CALL, EntityGrain.TOOL_CALL):
            raise invalid("activity_grain", "Activity requires a child grain")
        for label in ("model", "agent"):
            if getattr(self, label) is not None and getattr(self, f"{label}_is_unknown"):
                raise invalid(label, "Exact label and null bucket are mutually exclusive")
        if self.tool_is_linked and self.tool_is_unlinked:
            raise invalid("tool_is_unlinked", "Linked and unlinked are mutually exclusive")
        if self.timestamp_missing and (self.has_time_bounds or self.activity_grain is None):
            raise invalid("timestamp_missing", "Missing time needs a grain and no time bounds")
        witness_bounds = (
            self.witness_started_from is not None or self.witness_started_before is not None
        )
        if self.witness_time_override and self.activity_grain is None:
            raise invalid("witness_time_override", "Witness time override needs an activity grain")
        if (witness_bounds or self.witness_timestamp_missing) and not self.witness_time_override:
            raise invalid("witness_time_override", "Witness time fields need an explicit override")
        if self.witness_timestamp_missing and witness_bounds:
            raise invalid("witness_timestamp_missing", "Missing witness time excludes date bounds")
        if (
            self.witness_started_from
            and self.witness_started_before
            and self.witness_started_from >= self.witness_started_before
        ):
            raise invalid("witness_started_before", "Witness date range must be increasing")

    @property
    def has_time_bounds(self) -> bool:
        return self.started_from is not None or self.started_before is not None

    @property
    def has_model_predicate(self) -> bool:
        return (
            self.model is not None
            or self.model_is_unknown
            or self.usage_missing
            or self.token_semantics is not None
        )

    @property
    def has_tool_predicate(self) -> bool:
        return self.tool is not None or self.tool_is_unlinked or self.tool_is_linked

    @property
    def needs_child(self) -> bool:
        return (
            self.has_model_predicate
            or self.has_tool_predicate
            or self.has_time_bounds
            or self.timestamp_missing
            or self.activity_grain is not None
        )


@dataclass(frozen=True)
class MetricQuerySpec:
    definition: MetricDefinition
    scope: TraceScope = TraceScope()
    group_by: tuple[Dimension, ...] = ()

    def __post_init__(self) -> None:
        if self.definition.diagnostic:
            raise invalid(
                "metric_id", "This definition is diagnostic only; no executable metric is published"
            )
        if (
            self.definition.model_group_required
            and self.scope.model is None
            and not self.scope.model_is_unknown
            and Dimension.MODEL not in self.group_by
        ):
            object.__setattr__(self, "group_by", (*self.group_by, Dimension.MODEL))
        if (
            len(self.group_by) > 2
            or len(set(self.group_by)) != len(self.group_by)
            or any(d not in DIMENSIONS[self.definition.grain] for d in self.group_by)
        ):
            raise invalid("group_by", "Use at most two distinct dimensions supported by the grain")
        population = self.definition.population
        if population is not None:
            # Explicit fields keep this contract statically typed.
            self_scope = replace(
                self.scope,
                tool_is_unlinked=self.scope.tool_is_unlinked or population == "tool_is_unlinked",
                usage_missing=self.scope.usage_missing or population == "usage_missing",
                timestamp_missing=self.scope.timestamp_missing or population == "timestamp_missing",
                activity_grain=(
                    self.definition.grain
                    if population == "timestamp_missing"
                    else self.scope.activity_grain
                ),
            )
            object.__setattr__(self, "scope", self_scope)


@dataclass(frozen=True)
class AggregateRow:
    keys: tuple[str | bool | None, ...]
    parts: tuple[AggregatePart, ...]


@dataclass(frozen=True)
class AggregateRows:
    rows: tuple[AggregateRow, ...] = ()
    excluded_unknown_timestamps: int = 0
    schedule_version: str | None = None


def _activity_scope(scope: TraceScope, grain: EntityGrain) -> TraceScope:
    if scope.witness_time_override and scope.activity_grain != grain:
        # Switching chart grains makes the previous activity grain the sibling witness.
        return replace(
            scope,
            activity_grain=grain,
            witness_started_from=scope.started_from,
            witness_started_before=scope.started_before,
            witness_timestamp_missing=scope.timestamp_missing,
        )
    return replace(scope, activity_grain=grain)


def drill_scope(
    spec: MetricQuerySpec, keys: tuple[str | bool | None, ...], semantics: str | None = None
) -> TraceScope:
    scope = spec.scope
    if spec.definition.grain in (EntityGrain.MODEL_CALL, EntityGrain.TOOL_CALL):
        scope = _activity_scope(scope, spec.definition.grain)
    for dimension, key in zip(spec.group_by, keys, strict=True):
        match dimension:
            case Dimension.SOURCE:
                assert isinstance(key, str)
                scope = replace(scope, source=key)
            case Dimension.AGENT:
                assert isinstance(key, str) or key is None
                scope = replace(scope, agent=key, agent_is_unknown=key is None)
            case Dimension.MODEL:
                assert isinstance(key, str) or key is None
                scope = replace(scope, model=key, model_is_unknown=key is None)
            case Dimension.TOOL_NAME:
                assert isinstance(key, str)
                scope = replace(scope, tool=key)
            case Dimension.LINKED:
                scope = replace(scope, tool_is_linked=bool(key), tool_is_unlinked=not key)
            case Dimension.SESSION_ID:
                assert isinstance(key, str)
                scope = replace(scope, session_ids=(key,))
            case Dimension.STARTED_DAY:
                assert isinstance(key, str) or key is None
                if not scope.witness_time_override:
                    scope = replace(
                        scope,
                        witness_time_override=True,
                        witness_started_from=scope.started_from,
                        witness_started_before=scope.started_before,
                        witness_timestamp_missing=scope.timestamp_missing,
                        activity_grain=spec.definition.grain,
                    )
                if key is None:
                    scope = replace(
                        scope, timestamp_missing=True, activity_grain=spec.definition.grain
                    )
                else:
                    start = datetime.fromisoformat(key).replace(tzinfo=UTC)
                    end = start + timedelta(days=1)
                    scope = replace(
                        scope,
                        started_from=max(start, scope.started_from or start),
                        started_before=min(end, scope.started_before or end),
                        activity_grain=spec.definition.grain,
                    )
    if semantics is not None:
        scope = replace(scope, token_semantics=semantics)
    return scope


@dataclass(frozen=True)
class PartitionResult:
    semantics: str
    value_text: str | None
    coverage: Coverage
    drill_scope: TraceScope
    distribution: Distribution | None = None
    priced_coverage: TokenCoverage | None = None
    schedule_version: str | None = None


@dataclass(frozen=True)
class MetricResult:
    value_text: str | None
    recorded_sum_text: str | None
    coverage: Coverage
    comparability: str
    reason: str
    semantics_partitions: tuple[PartitionResult, ...]
    distribution: Distribution | None = None
    priced_coverage: TokenCoverage | None = None
    schedule_version: str | None = None


@dataclass(frozen=True)
class MetricBucket:
    keys: tuple[str | bool | None, ...]
    result: MetricResult
    drill_scope: TraceScope


@dataclass(frozen=True)
class MetricQueryResult:
    metric_id: str
    definition: MetricDefinition
    supported_dimensions: tuple[Dimension, ...]
    scope: TraceScope
    group_by: tuple[Dimension, ...]
    overall: MetricResult
    excluded_unknown_timestamps: int
    buckets: tuple[MetricBucket, ...]


def _text(value: Number | None) -> str | None:
    return number_text(value)


def _legacy_int(value: Number | None) -> int | None:
    if value is None:
        return None
    if not isinstance(value, int):
        raise ValueError("Legacy summaries support integer counts and sums only")
    return value


def combine_parts(rows: AggregateRows) -> tuple[AggregatePart, ...]:
    grouped: dict[str | None, list[AggregatePart]] = {}
    for row in rows.rows:
        for part in row.parts:
            grouped.setdefault(part.semantics, []).append(part)
    return tuple(
        AggregatePart(
            sum(p.value for p in parts if p.value is not None)
            if any(p.value is not None for p in parts)
            else None,
            sum(p.known for p in parts),
            sum(p.total for p in parts),
            semantics,
            tuple(v for p in parts for v in p.samples),
            sum(p.priced_tokens for p in parts),
            sum(p.total_tokens for p in parts),
        )
        for semantics, parts in sorted(grouped.items(), key=lambda item: item[0] or "")
    )


def assemble_metric(definition: MetricDefinition, rows: AggregateRows) -> Metric:
    """The sole compatibility assembler for summary and session metrics."""
    parts = combine_parts(rows)
    result = evaluate(definition, parts)
    return Metric(
        value=_legacy_int(result.recorded_sum),
        definition=definition.description,
        unit=definition.unit,
        coverage=Coverage(result.known, result.total),
        by_semantics={
            p.semantics: p.value
            for p in parts
            if p.semantics is not None and isinstance(p.value, int)
        },
        metric_id=definition.id,
        version=definition.version,
        value_text=_text(result.value),
        recorded_sum_text=_text(result.recorded_sum),
        comparability=result.comparability,
        reason=result.reason,
        semantics_partitions=tuple(
            SemanticsPartition(p.semantics, _text(p.value), Coverage(p.known, p.total))
            for p in parts
            if p.semantics is not None
        ),
    )


def _result(
    spec: MetricQuerySpec,
    parts: tuple[AggregatePart, ...],
    scope: TraceScope,
    schedule_version: str | None = None,
) -> MetricResult:
    result = evaluate(spec.definition, parts)
    is_cost = spec.definition.operation == Aggregation.COST
    reason = result.reason
    if is_cost and schedule_version is None:
        reason = "Price schedule unavailable; no tokens priced."
    elif is_cost and result.known == 0:
        reason = "No recorded tokens have both a rate and validated billing semantics."
    return MetricResult(
        _text(result.value),
        _text(result.recorded_sum),
        Coverage(result.known, result.total),
        result.comparability,
        reason,
        tuple(
            PartitionResult(
                p.semantics,
                _text(p.value),
                Coverage(p.known, p.total),
                replace(_activity_scope(scope, spec.definition.grain), token_semantics=p.semantics),
                distribution(p.samples) if p.semantics != "unknown" else None,
                TokenCoverage(p.priced_tokens, p.total_tokens) if is_cost else None,
                schedule_version,
            )
            for p in parts
            if p.semantics is not None
        ),
        distribution([v for p in parts for v in p.samples])
        if result.comparability in ("comparable", "not_applicable")
        else None,
        TokenCoverage(sum(p.priced_tokens for p in parts), sum(p.total_tokens for p in parts))
        if is_cost
        else None,
        schedule_version,
    )


def assemble_query(spec: MetricQuerySpec, rows: AggregateRows) -> MetricQueryResult:
    buckets = []
    source_rows = rows.rows
    if not source_rows and not spec.group_by:
        source_rows = (AggregateRow((), ()),)
    for row in source_rows:
        scope = drill_scope(spec, row.keys)
        result = _result(spec, row.parts, scope, rows.schedule_version)
        if spec.definition.model_group_required and scope.model_is_unknown:
            result = replace(
                result,
                value_text=None,
                distribution=None,
                semantics_partitions=(),
                comparability="unknown",
                reason="Unknown model is not a compatible model group.",
            )
        buckets.append(MetricBucket(row.keys, result, scope))
    overall = _result(spec, combine_parts(rows), spec.scope, rows.schedule_version)
    if spec.definition.model_group_required and spec.scope.model_is_unknown:
        overall = replace(
            overall,
            value_text=None,
            distribution=None,
            semantics_partitions=(),
            comparability="unknown",
            reason="Unknown model is not a compatible model group.",
        )
    if spec.definition.model_group_required and Dimension.MODEL in spec.group_by:
        model_index = spec.group_by.index(Dimension.MODEL)
        models = {row.keys[model_index] for row in rows.rows}
        if len(models) > 1 or None in models:
            overall = replace(
                overall,
                value_text=None,
                recorded_sum_text=None,
                distribution=None,
                comparability="unknown" if None in models else "mixed",
                reason=(
                    "Reasoning usage requires a known compatible model group; use the "
                    "model buckets."
                ),
                semantics_partitions=(),
            )
    return MetricQueryResult(
        spec.definition.id,
        spec.definition,
        spec.definition.supported_dimensions,
        spec.scope,
        spec.group_by,
        overall,
        rows.excluded_unknown_timestamps,
        tuple(buckets),
    )
