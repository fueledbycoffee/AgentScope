from dataclasses import replace
from fractions import Fraction

import pytest

from agentscope_app.domain.metrics import (
    REGISTRY,
    AggregatePart,
    MetricRegistry,
    evaluate,
)


def test_registry_has_complete_definitions_for_summary_and_chart_metrics():
    assert set(REGISTRY.definitions) == {
        "observed_span_ms",
        "scheduled_cost_usd",
        "reasoning_tokens_distribution",
        "reasoning_to_output_ratio",
        "tool_wall_latency_ms_distribution",
        "tool_internal_latency_ms_distribution",
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


def test_cost_sums_priced_groups_without_treating_token_semantics_as_currency_units():
    definition = REGISTRY.get("scheduled_cost_usd")
    result = evaluate(
        definition,
        [
            AggregatePart(Fraction("107.8042053"), 1583, 1583, "tracelab-claude"),
            AggregatePart(Fraction("25.0719925"), 3039, 3187, "tracelab-codex"),
            AggregatePart(None, 0, 149, "unknown"),
        ],
    )

    assert result.value == Fraction("132.8761978")
    assert result.recorded_sum == result.value
    assert result.comparability == "not_applicable"
    assert result.reason == "Sum of priced groups; unpriced groups excluded, see priced coverage."
    assert definition.comparability_rule == "observations"
    assert "sum of priced groups; unpriced groups excluded, see priced coverage" in (
        definition.description.lower()
    )


def test_registry_itself_is_immutable_and_rejects_unknown_comparability():
    from dataclasses import FrozenInstanceError

    with pytest.raises(FrozenInstanceError):
        REGISTRY.definitions = {}
    with pytest.raises(ValueError, match="comparability"):
        MetricRegistry([replace(REGISTRY.get("sessions"), comparability_rule="unrecognized")])


def test_quantiles_are_nearest_rank_and_even_median_is_exact():
    from fractions import Fraction

    from agentscope_app.domain.distributions import distribution
    from agentscope_app.domain.numbers import number_text

    result = distribution([10, 1, 8, 3, 6, 5, 7, 4, 9, 2])
    assert (result.p90_text, result.median_text) == ("9", "5.5")
    assert distribution([0]).median_text == "0"
    assert distribution([]) is None
    assert distribution([10**40, 10**40 + 1]).median_text == str(10**40) + ".5"
    assert (
        number_text(Fraction(10**60 + 1, 10**30))
        == "1000000000000000000000000000000.000000000000000000000000000001"
    )
    for definition in REGISTRY.definitions.values():
        assert "nearest-rank" in definition.quantile_rule
        assert "even n" in definition.median_rule
        assert definition.display_decimal_places >= 0
