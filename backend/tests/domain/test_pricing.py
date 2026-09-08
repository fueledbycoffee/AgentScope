from dataclasses import replace
from fractions import Fraction

from agentscope_app.domain.numbers import number_text
from agentscope_app.domain.pricing import ModelRates, PriceSchedule, TokenUsage, price_usage


def schedule():
    return PriceSchedule(
        "test-only-v1",
        {"vendor/model": ModelRates(Fraction("0.01"), Fraction("0.02"), Fraction("0.001"))},
    )


def test_pricing_reconciles_claude_components_and_coverage_without_double_counting():
    usage = TokenUsage("vendor/model", "tracelab-claude", 100, 10, 60, 20)
    result = price_usage(usage, schedule())
    assert number_text(result.cost) == "0.46"  # prompt 20, read 60, output 10
    assert (result.priced_tokens, result.total_tokens) == (90, 110)
    # Creation lacks a published rate; a missing creation count is not known zero.
    result = price_usage(replace(usage, cache_creation_tokens=None), schedule())
    assert number_text(result.cost) == "0.26"
    assert (result.priced_tokens, result.total_tokens) == (70, 110)
    result = price_usage(replace(usage, cache_read_tokens=110), schedule())
    assert number_text(result.cost) == "0.2"  # contradictory input split entirely unpriced
    assert (result.priced_tokens, result.total_tokens) == (10, 110)
    result = price_usage(replace(usage, input_tokens=None), schedule())
    assert (result.priced_tokens, result.total_tokens) == (70, 90)


def test_codex_input_unknown_semantics_and_missing_rates_are_unpriced():
    usage = TokenUsage("vendor/model", "tracelab-codex", 100, 10, None, None)
    result = price_usage(usage, schedule())
    assert number_text(result.cost) == "0.2"
    assert (result.priced_tokens, result.total_tokens) == (10, 110)
    for changed in (
        replace(usage, semantics="unknown"),
        replace(usage, semantics="other-tag"),
        replace(usage, model="model"),
        replace(usage, model=None),
    ):
        result = price_usage(changed, schedule())
        assert result.cost is None and result.priced_tokens == 0 and result.total_tokens == 110
    assert price_usage(usage, None).cost is None
    assert (
        price_usage(usage, PriceSchedule("missing-rates", {"vendor/model": ModelRates()})).cost
        is None
    )


def test_pricing_zero_missing_and_long_decimal_products_remain_exact():
    usage = TokenUsage("vendor/model", "tracelab-claude", 0, 0, 0, 0)
    result = price_usage(usage, schedule())
    assert result.cost == 0 and result.priced_tokens == result.total_tokens == 0
    assert (
        price_usage(
            replace(
                usage,
                input_tokens=None,
                output_tokens=None,
                cache_read_tokens=None,
                cache_creation_tokens=None,
            ),
            schedule(),
        ).cost
        is None
    )
    free = PriceSchedule(
        "free", {"vendor/model": ModelRates(Fraction(0), Fraction(0), Fraction(0))}
    )
    result = price_usage(replace(usage, input_tokens=10, output_tokens=10), free)
    assert result.cost == 0 and result.priced_tokens == result.total_tokens == 20
    rates = PriceSchedule("precise", {"vendor/model": ModelRates(completion=Fraction(1, 10**40))})
    result = price_usage(replace(usage, output_tokens=10**40 + 1), rates)
    assert number_text(result.cost) == "1." + "0" * 39 + "1"
