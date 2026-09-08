from dataclasses import replace

import pytest

from agentscope_app.domain.metrics import (
    REGISTRY,
    AggregatePart,
    MetricRegistry,
    evaluate,
)


def test_registry_has_complete_definitions_for_summary_and_chart_metrics():
    assert set(REGISTRY.definitions) == {
        "sessions",
        "model_calls",
        "tool_calls",
        "input_tokens",
        "output_tokens",
        "cache_read_tokens",
        "cache_creation_tokens",
        "reasoning_tokens",
        "tool_wall_latency_ms",
        "tool_internal_latency_ms",
        "unlinked_tools",
        "missing_usage",
        "unknown_timestamps",
        "imports_in_scope",
    }
    for definition in REGISTRY.definitions.values():
        assert all(
            (
                definition.formula,
                definition.unit,
                definition.scope,
                definition.null_handling,
                definition.description,
                definition.comparability_rule,
            )
        )


def test_registry_rejects_duplicate_ids_bad_fields_and_units():
    tokens = REGISTRY.get("input_tokens")
    with pytest.raises(ValueError, match="Duplicate"):
        MetricRegistry([tokens, tokens])
    for changes in (
        {"field": "started_at"},
        {"unit": "ms"},
        {"version": 0},
        {"coverage_field": "output_tokens"},
        {"operation": "average"},
        {"semantics_field": "model"},
    ):
        with pytest.raises(ValueError):
            MetricRegistry([replace(tokens, **changes)])
    with pytest.raises(ValueError):
        MetricRegistry([replace(tokens, grain="session", field="started_at")])
    assert REGISTRY.get("tool_wall_latency_ms").field == "wall_latency_ms"
    assert REGISTRY.get("tool_internal_latency_ms").field == "internal_latency_ms"
    with pytest.raises(TypeError):
        REGISTRY.definitions["foo"] = tokens


def test_null_zero_and_empty_populations():
    tokens = REGISTRY.get("input_tokens")
    result = evaluate(tokens, [AggregatePart(10, 2, 3, "a")])
    assert (result.value, result.known, result.total) == (10, 2, 3)
    assert evaluate(tokens, [AggregatePart(None, 0, 3, "a")]).value is None
    empty = evaluate(REGISTRY.get("sessions"), [])
    assert (empty.value, empty.known, empty.total) == (0, 0, 0)
    assert evaluate(tokens, [AggregatePart(0, 1, 1, "a")]).value == 0


def test_semantics_partitions_interpret_known_contributors_only():
    definition = REGISTRY.get("input_tokens")
    parts = [AggregatePart(10, 1, 2, "a"), AggregatePart(None, 0, 1, "b")]
    assert evaluate(definition, parts).comparability == "comparable"
    parts.append(AggregatePart(0, 1, 1, "b"))
    result = evaluate(definition, parts)
    assert result.comparability == "mixed" and result.value is None
    assert result.recorded_sum == 10
    parts.append(AggregatePart(0, 1, 1, "unknown"))
    result = evaluate(definition, parts)
    assert result.comparability == "unknown" and "3 token semantics" in result.reason


def test_registry_itself_is_immutable_and_rejects_unknown_comparability():
    from dataclasses import FrozenInstanceError

    with pytest.raises(FrozenInstanceError):
        REGISTRY.definitions = {}
    with pytest.raises(ValueError, match="comparability"):
        MetricRegistry([replace(REGISTRY.get("sessions"), comparability_rule="unrecognized")])
