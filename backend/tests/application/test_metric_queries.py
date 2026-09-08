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
