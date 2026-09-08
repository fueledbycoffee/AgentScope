from datetime import UTC, datetime

import pytest

from agentscope_app.application.errors import InvalidInputError
from agentscope_app.application.metric_queries import MetricQuerySpec, TraceScope, drill_scope
from agentscope_app.domain.metrics import REGISTRY, Dimension, EntityGrain


@pytest.mark.parametrize(
    "kwargs",
    [
        {"started_from": datetime(2026, 1, 1)},
        {
            "started_from": datetime(2026, 1, 2, tzinfo=UTC),
            "started_before": datetime(2026, 1, 1, tzinfo=UTC),
        },
        {"agent": "a", "agent_is_unknown": True},
        {"model": "m", "model_is_unknown": True},
        {"timestamp_missing": True},
        {"activity_grain": EntityGrain.SESSION},
        {"tool_is_linked": True, "tool_is_unlinked": True},
    ],
)
def test_scope_rejects_invalid_combinations(kwargs):
    with pytest.raises(InvalidInputError) as error:
        TraceScope(**kwargs)
    assert set(error.value.details[0]) == {"path", "message"}


def test_specs_validate_dimensions_and_apply_definition_populations():
    with pytest.raises(InvalidInputError):
        MetricQuerySpec(REGISTRY.get("sessions"), group_by=(Dimension.MODEL,))
    with pytest.raises(InvalidInputError):
        MetricQuerySpec(REGISTRY.get("model_calls"), group_by=(Dimension.MODEL, Dimension.MODEL))
    assert MetricQuerySpec(REGISTRY.get("unlinked_tools")).scope.tool_is_unlinked
    assert MetricQuerySpec(REGISTRY.get("missing_usage")).scope.usage_missing
    assert MetricQuerySpec(REGISTRY.get("unknown_timestamps")).scope.timestamp_missing
    with pytest.raises(InvalidInputError):
        MetricQuerySpec(
            REGISTRY.get("unknown_timestamps"),
            TraceScope(started_from=datetime(2026, 1, 1, tzinfo=UTC)),
        )


def test_day_drill_is_aware_and_preserves_partial_day_range():
    start = datetime(2026, 1, 1, 12, tzinfo=UTC)
    spec = MetricQuerySpec(
        REGISTRY.get("model_calls"), TraceScope(started_from=start), (Dimension.STARTED_DAY,)
    )
    drill = drill_scope(spec, ("2026-01-01",))
    assert drill.started_from == start
    assert drill.started_before == datetime(2026, 1, 2, tzinfo=UTC)
    assert drill.activity_grain == EntityGrain.MODEL_CALL
    spec = MetricQuerySpec(REGISTRY.get("input_tokens"), group_by=(Dimension.MODEL,))
    assert drill_scope(spec, (None,), "unknown").model_is_unknown
    assert drill_scope(spec, ("unknown",)).model == "unknown"


def test_metric_use_cases_use_trace_query_and_reject_invalid_specs():
    from agentscope_app.application.metric_queries import AggregateRow, AggregateRows
    from agentscope_app.application.use_cases.queries import (
        ListMetricDefinitions,
        MetricsSummary,
        QueryMetric,
    )
    from agentscope_app.domain.metrics import AggregatePart
    from tests.application.fakes import FakeUnitOfWork

    uow = FakeUnitOfWork()
    uow.trace_query.results["input_tokens"] = AggregateRows(
        (AggregateRow((), (AggregatePart(10, 2, 3, "a"), AggregatePart(None, 0, 1, "b"))),)
    )
    result = MetricsSummary(uow.factory).execute(source="a", agent=None)
    assert [s.definition.id for s in uow.trace_query.specs] == [
        "sessions",
        "model_calls",
        "tool_calls",
        "input_tokens",
        "output_tokens",
    ]
    assert all(s.scope.source == "a" for s in uow.trace_query.specs)
    assert result.input_tokens.value_text == "10"
    assert result.input_tokens.by_semantics == {"a": 10}
    assert len(result.input_tokens.semantics_partitions) == 2
    assert result.sessions.value_text == "0"
    before = len(uow.trace_query.specs)
    query = QueryMetric(uow.factory)
    for metric_id, group_by in [
        ("nope", ()),
        ("sessions", (Dimension.MODEL,)),
        ("model_calls", (Dimension.SESSION_ID,)),
    ]:
        with pytest.raises(InvalidInputError):
            query.execute(metric_id, group_by=group_by)
    assert len(uow.trace_query.specs) == before
    assert {d["id"] for d in ListMetricDefinitions().execute()} == set(REGISTRY.definitions)
    result = query.execute("input_tokens")
    assert result.overall.value_text == "10"
    assert result.buckets[0].result.semantics_partitions[1].value_text is None


def test_query_overall_combines_repeated_semantics_across_buckets():
    from agentscope_app.application.metric_queries import (
        AggregateRow,
        AggregateRows,
        assemble_query,
    )
    from agentscope_app.domain.metrics import AggregatePart

    spec = MetricQuerySpec(REGISTRY.get("input_tokens"), group_by=(Dimension.MODEL,))
    result = assemble_query(
        spec,
        AggregateRows(
            (
                AggregateRow(("m",), (AggregatePart(10, 1, 1, "a"),)),
                AggregateRow(
                    (None,), (AggregatePart(5, 1, 2, "a"), AggregatePart(None, 0, 1, "b"))
                ),
            )
        ),
    )
    assert result.overall.value_text == "15"
    assert result.overall.coverage.known == 2 and result.overall.coverage.total == 4
    assert result.overall.semantics_partitions[0].value_text == "15"
    assert result.buckets[1].drill_scope.model_is_unknown


def test_switching_chart_grains_preserves_the_previous_activity_time_as_witness():
    original = TraceScope(tool="shell")
    model_spec = MetricQuerySpec(REGISTRY.get("model_calls"), original, (Dimension.STARTED_DAY,))
    model_drill = drill_scope(model_spec, ("2026-01-02",))
    assert model_drill.witness_time_override and model_drill.witness_started_from is None
    tool_spec = MetricQuerySpec(REGISTRY.get("tool_calls"), model_drill, (Dimension.TOOL_NAME,))
    tool_drill = drill_scope(tool_spec, ("shell",))
    assert tool_drill.activity_grain == EntityGrain.TOOL_CALL
    assert tool_drill.witness_started_from == datetime(2026, 1, 2, tzinfo=UTC)
    assert tool_drill.witness_started_before == datetime(2026, 1, 3, tzinfo=UTC)
