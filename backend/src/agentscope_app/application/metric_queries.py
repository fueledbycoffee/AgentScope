"""Typed query contracts; no storage or transport types cross the metric port."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta

from agentscope_app.application.errors import InvalidInputError
from agentscope_app.domain.metrics import (
    DIMENSIONS,
    AggregatePart,
    Dimension,
    EntityGrain,
    MetricDefinition,
)


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

    def __post_init__(self) -> None:
        for name in ("started_from", "started_before"):
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


def drill_scope(
    spec: MetricQuerySpec, keys: tuple[str | bool | None, ...], semantics: str | None = None
) -> TraceScope:
    scope = spec.scope
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
    # Even an ungrouped/model bucket needs the chart's eligible child population.
    if spec.definition.grain in (EntityGrain.MODEL_CALL, EntityGrain.TOOL_CALL):
        scope = replace(scope, activity_grain=spec.definition.grain)
    return scope
