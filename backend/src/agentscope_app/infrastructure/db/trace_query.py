"""Compile the metric vocabulary into grain-preserving SQLite aggregates."""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import replace
from fractions import Fraction
from typing import Any

from sqlalchemy import (
    Boolean,
    Column,
    Integer,
    MetaData,
    String,
    Table,
    exists,
    func,
    or_,
    select,
    union,
)
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from agentscope_app.application.metric_queries import (
    AggregateRow,
    AggregateRows,
    MetricQuerySpec,
    TraceScope,
    combine_parts,
)
from agentscope_app.domain.metrics import (
    MEASURES,
    REGISTRY,
    AggregatePart,
    Aggregation,
    Dimension,
    EntityGrain,
)
from agentscope_app.domain.pricing import PriceSchedule, TokenUsage, price_usage
from agentscope_app.infrastructure.db.models import EntityContribution, UtcDateTime
from agentscope_app.infrastructure.prices import load_price_schedule

# Private metadata: Alembic must never mistake these views for canonical tables.
_VIEW_METADATA = MetaData()


def _view(
    name: str,
    strings: Sequence[str],
    times: Sequence[str],
    integers: Sequence[str] = (),
    booleans: Sequence[str] = (),
) -> Table:
    return Table(
        name,
        _VIEW_METADATA,
        *(Column(n, String) for n in strings),
        *(Column(n, UtcDateTime()) for n in times),
        *(Column(n, Integer) for n in integers),
        *(Column(n, Boolean) for n in booleans),
    )


SESSION_VIEW = _view(
    "metric_sessions_v1",
    ("id", "source", "external_id", "agent"),
    ("observed_start_at", "observed_end_at"),
)
MODEL_VIEW = _view(
    "metric_model_calls_v1",
    ("id", "session_id", "import_id", "source", "agent", "provider", "model", "token_semantics"),
    ("started_at", "ended_at"),
    MEASURES[EntityGrain.MODEL_CALL],
    ("is_error",),
)
TOOL_VIEW = _view(
    "metric_tool_calls_v1",
    ("id", "session_id", "model_call_id", "import_id", "source", "agent", "tool_name", "status"),
    ("started_at", "ended_at"),
    MEASURES[EntityGrain.TOOL_CALL],
    ("is_error",),
)
VIEWS = {
    EntityGrain.SESSION: SESSION_VIEW,
    EntityGrain.MODEL_CALL: MODEL_VIEW,
    EntityGrain.TOOL_CALL: TOOL_VIEW,
}
# Explicit canonical field -> view-column bindings. There is no metric-ID dispatch.
MEASURE_COLUMNS = {
    grain: {field: VIEWS[grain].c[field] for field in fields}
    for grain, fields in MEASURES.items()
    if grain in VIEWS
}


def _child_predicates(table: Any, grain: EntityGrain, scope: TraceScope) -> list[Any]:
    clauses: list[Any] = []
    if scope.import_id is not None:
        clauses.append(table.c.import_id == scope.import_id)
    if scope.started_from is not None:
        clauses.append(table.c.started_at >= scope.started_from)
    if scope.started_before is not None:
        clauses.append(table.c.started_at < scope.started_before)
    if scope.started_through is not None:
        clauses.append(table.c.started_at <= scope.started_through)
    if scope.timestamp_missing:
        clauses.append(table.c.started_at.is_(None))
    if grain == EntityGrain.MODEL_CALL:
        if scope.model is not None:
            clauses.append(table.c.model == scope.model)
        if scope.model_is_unknown:
            clauses.append(table.c.model.is_(None))
        if scope.usage_missing:
            clauses.append(table.c.input_tokens.is_(None))
        if scope.token_semantics is not None:
            clauses.append(table.c.token_semantics == scope.token_semantics)
    else:
        if scope.tool is not None:
            clauses.append(table.c.tool_name == scope.tool)
        if scope.tool_is_unlinked:
            clauses.append(table.c.model_call_id.is_(None))
        if scope.tool_is_linked:
            clauses.append(table.c.model_call_id.is_not(None))
    return clauses


def _witness(session_id: Any, grain: EntityGrain, scope: TraceScope) -> ColumnElement[bool]:
    table = VIEWS[grain].alias()
    if scope.witness_time_override and scope.activity_grain != grain:
        scope = replace(
            scope,
            started_from=scope.witness_started_from,
            started_before=scope.witness_started_before,
            started_through=scope.witness_started_through,
            timestamp_missing=scope.witness_timestamp_missing,
        )
    return exists(
        select(1)
        .select_from(table)
        .where(table.c.session_id == session_id, *_child_predicates(table, grain, scope))
    )


def _scope_clauses(grain: EntityGrain, scope: TraceScope) -> list[Any]:
    table = VIEWS[grain]
    session_id = table.c.id if grain == EntityGrain.SESSION else table.c.session_id
    clauses: list[Any] = []
    for name in ("source", "agent"):
        value = getattr(scope, name)
        if value is not None:
            clauses.append(table.c[name] == value)
    if scope.agent_is_unknown:
        clauses.append(table.c.agent.is_(None))
    if scope.session_ids is not None:
        clauses.append(session_id.in_(scope.session_ids))
    if grain != EntityGrain.SESSION:
        clauses.extend(_child_predicates(table, grain, scope))
        if grain == EntityGrain.MODEL_CALL and (
            scope.has_tool_predicate
            or scope.activity_grain == EntityGrain.TOOL_CALL
            or scope.witness_required
        ):
            clauses.append(_witness(session_id, EntityGrain.TOOL_CALL, scope))
        if grain == EntityGrain.TOOL_CALL and (
            scope.has_model_predicate
            or scope.activity_grain == EntityGrain.MODEL_CALL
            or scope.witness_required
        ):
            clauses.append(_witness(session_id, EntityGrain.MODEL_CALL, scope))
        return clauses

    if scope.import_id is not None:
        clauses.append(
            or_(
                exists(
                    select(1)
                    .where(
                        EntityContribution.session_id == session_id,
                        EntityContribution.import_id == scope.import_id,
                    )
                    .correlate_except(EntityContribution)
                ),
                _witness(session_id, EntityGrain.MODEL_CALL, scope),
                _witness(session_id, EntityGrain.TOOL_CALL, scope),
            )
        )
    if scope.has_model_predicate:
        clauses.append(_witness(session_id, EntityGrain.MODEL_CALL, scope))
    if scope.has_tool_predicate:
        clauses.append(_witness(session_id, EntityGrain.TOOL_CALL, scope))
    if scope.activity_grain is not None:
        clauses.append(_witness(session_id, scope.activity_grain, scope))
        if scope.witness_required:
            sibling = (
                EntityGrain.TOOL_CALL
                if scope.activity_grain == EntityGrain.MODEL_CALL
                else EntityGrain.MODEL_CALL
            )
            clauses.append(_witness(session_id, sibling, scope))
    elif scope.has_time_bounds and not (scope.has_model_predicate or scope.has_tool_predicate):
        clauses.append(
            or_(
                _witness(session_id, EntityGrain.MODEL_CALL, scope),
                _witness(session_id, EntityGrain.TOOL_CALL, scope),
            )
        )
    return clauses


def _dimension(grain: EntityGrain, dimension: Dimension) -> Any:
    table = VIEWS[grain]
    if dimension == Dimension.STARTED_DAY:
        # UtcDateTime stores fixed-format UTC text. SQLite's date parser can
        # round the final microsecond into the next day (or NULL at year 9999).
        return func.substr(table.c.started_at, 1, 10)
    if dimension == Dimension.LINKED:
        return table.c.model_call_id.is_not(None)
    if dimension == Dimension.SESSION_ID and grain == EntityGrain.SESSION:
        return table.c.id
    return table.c[dimension.value]


class SqlAlchemyTraceQuery:
    def __init__(self, session: Session, price_schedule: PriceSchedule | None = None) -> None:
        self._s = session
        self._price_schedule = price_schedule

    def aggregate(self, spec: MetricQuerySpec) -> AggregateRows:
        definition, scope = spec.definition, spec.scope
        if definition.grain == EntityGrain.IMPORT:
            return self._imports(scope)
        if definition.operation == Aggregation.COST:
            return self._cost(spec)
        if definition.operation == Aggregation.OBSERVED_SPAN:
            return self._observed_span(spec)
        grain = definition.grain
        table = VIEWS[grain]
        groups = [_dimension(grain, d) for d in spec.group_by]
        if definition.semantics_field:
            groups.append(table.c[definition.semantics_field])
        value: Any
        if definition.operation == Aggregation.COUNT:
            value, known = func.count(), func.count()
        else:
            assert definition.field is not None
            column = MEASURE_COLUMNS[grain][definition.field]
            aggregate = (
                func.exact_int_samples
                if definition.operation == Aggregation.DISTRIBUTION
                else func.exact_int_sum
            )
            value, known = aggregate(column), func.count(column)
        stmt = (
            select(*groups, value, known, func.count())
            .select_from(table)
            .where(*_scope_clauses(grain, scope))
        )
        if groups:
            stmt = stmt.group_by(*groups).order_by(*(g.asc().nulls_first() for g in groups))
        grouped: dict[tuple[str | bool | None, ...], list[AggregatePart]] = {}
        for row in self._s.execute(stmt):
            keys = tuple(row[: len(spec.group_by)])
            tag = row[len(spec.group_by)] if definition.semantics_field else None
            total_value, known_count, total = row[-3:]
            samples: tuple[int, ...] = ()
            if definition.operation == Aggregation.DISTRIBUTION:
                samples = tuple(json.loads(total_value)) if total_value else ()
                total_value = sum(samples) if samples else None
            grouped.setdefault(keys, []).append(
                AggregatePart(
                    None if total_value is None else int(total_value),
                    int(known_count),
                    int(total),
                    tag,
                    samples,
                )
            )
        excluded = self._excluded_unknown_timestamps(grain, scope)
        return AggregateRows(tuple(AggregateRow(k, tuple(v)) for k, v in grouped.items()), excluded)

    def _excluded_unknown_timestamps(self, grain: EntityGrain, scope: TraceScope) -> int:
        if not scope.has_time_bounds or grain == EntityGrain.SESSION:
            return 0
        table = VIEWS[grain]
        non_time = replace(scope, started_from=None, started_before=None, started_through=None)
        return int(
            self._s.scalar(
                select(func.count())
                .select_from(table)
                .where(*_scope_clauses(grain, non_time), table.c.started_at.is_(None))
            )
            or 0
        )

    def _cost(self, spec: MetricQuerySpec) -> AggregateRows:
        schedule = self._price_schedule or load_price_schedule()
        groups = [_dimension(EntityGrain.MODEL_CALL, d) for d in spec.group_by]
        fields = (
            "model",
            "token_semantics",
            "input_tokens",
            "output_tokens",
            "cache_read_tokens",
            "cache_creation_tokens",
        )
        stmt = select(*groups, *(MODEL_VIEW.c[f] for f in fields)).where(
            *_scope_clauses(EntityGrain.MODEL_CALL, spec.scope)
        )
        grouped: dict[tuple[str | bool | None, ...], tuple[AggregatePart, ...]] = {}
        if not spec.group_by:
            grouped[()] = ()
        for row in self._s.execute(stmt):
            keys = tuple(row[: len(spec.group_by)])
            usage = TokenUsage(*row[len(spec.group_by) :])
            priced = price_usage(usage, schedule)
            part = AggregatePart(
                priced.cost,
                int(priced.cost is not None),
                1,
                usage.semantics,
                priced_tokens=priced.priced_tokens,
                total_tokens=priced.total_tokens,
            )
            grouped[keys] = combine_parts(
                AggregateRows((AggregateRow(keys, (*grouped.get(keys, ()), part)),))
            )
        excluded = self._excluded_unknown_timestamps(EntityGrain.MODEL_CALL, spec.scope)
        return AggregateRows(
            tuple(
                AggregateRow(k, v)
                for k, v in sorted(
                    grouped.items(),
                    key=lambda item: tuple((v is not None, str(v)) for v in item[0]),
                )
            ),
            excluded,
            schedule.version if schedule else None,
        )

    def _observed_span(self, spec: MetricQuerySpec) -> AggregateRows:
        groups = [_dimension(EntityGrain.SESSION, d) for d in spec.group_by]
        stmt = select(
            *groups, SESSION_VIEW.c.observed_start_at, SESSION_VIEW.c.observed_end_at
        ).where(*_scope_clauses(EntityGrain.SESSION, spec.scope))
        grouped: dict[tuple[str | bool | None, ...], list[AggregatePart]] = {}
        if not spec.group_by:
            grouped[()] = []
        for row in self._s.execute(stmt):
            start, end = row[-2:]
            value = None
            if start is not None and end is not None:
                delta = end - start
                micros = (delta.days * 86400 + delta.seconds) * 1000000 + delta.microseconds
                value = Fraction(micros, 1000)
            grouped.setdefault(tuple(row[:-2]), []).append(
                AggregatePart(value, int(value is not None), 1)
            )
        return AggregateRows(
            tuple(
                AggregateRow(
                    keys,
                    (
                        AggregatePart(
                            sum((p.value for p in parts if p.value is not None), Fraction(0))
                            if any(p.known for p in parts)
                            else None,
                            sum(p.known for p in parts),
                            len(parts),
                        ),
                    ),
                )
                for keys, parts in sorted(
                    grouped.items(),
                    key=lambda item: tuple((v is not None, str(v)) for v in item[0]),
                )
            )
        )

    def _imports(self, scope: TraceScope) -> AggregateRows:
        queries = []
        for grain in (EntityGrain.MODEL_CALL, EntityGrain.TOOL_CALL):
            if scope.activity_grain is not None and scope.activity_grain != grain:
                continue
            table = VIEWS[grain]
            queries.append(select(table.c.import_id).where(*_scope_clauses(grain, scope)))
        if not scope.needs_child:
            contributions = (
                select(EntityContribution.import_id)
                .join(SESSION_VIEW, SESSION_VIEW.c.id == EntityContribution.session_id)
                .where(*_scope_clauses(EntityGrain.SESSION, scope))
            )
            if scope.import_id is not None:
                contributions = contributions.where(EntityContribution.import_id == scope.import_id)
            queries.append(contributions)
        population = union(*queries).subquery()
        count = int(self._s.scalar(select(func.count(func.distinct(population.c.import_id)))) or 0)
        return AggregateRows((AggregateRow((), (AggregatePart(count, count, count),)),))

    def session_ids(self, scope: TraceScope, *, limit: int, offset: int) -> Sequence[str]:
        return list(
            self._s.scalars(
                select(SESSION_VIEW.c.id)
                .where(*_scope_clauses(EntityGrain.SESSION, scope))
                .order_by(SESSION_VIEW.c.id)
                .limit(limit)
                .offset(offset)
            )
        )

    def session_metrics(self, scope: TraceScope) -> dict[str, dict[str, AggregateRows]]:
        """Three grouped queries for any page size; counts use the same scope as tokens."""
        result: dict[str, dict[str, AggregateRows]] = {}
        for metric_id in ("model_calls", "tool_calls", "input_tokens"):
            spec = MetricQuerySpec(REGISTRY.get(metric_id), scope, (Dimension.SESSION_ID,))
            for row in self.aggregate(spec).rows:
                session_id = row.keys[0]
                assert isinstance(session_id, str)
                result.setdefault(session_id, {})[metric_id] = AggregateRows(
                    (AggregateRow((), row.parts),)
                )
        return result
