import json
from fractions import Fraction

import pytest
from pydantic import TypeAdapter

from agentscope_app.application.metric_queries import (
    AggregateRow,
    AggregateRows,
    MetricQueryResult,
    MetricQuerySpec,
    assemble_query,
)
from agentscope_app.domain.metrics import REGISTRY, AggregatePart, Dimension
from agentscope_app.domain.pricing import ModelRates, PriceSchedule, TokenUsage, price_usage


@pytest.mark.parametrize("quantity", [0, 9_007_199_254_740_993, 2**63 - 1])
@pytest.mark.parametrize("schedule_available", [True, False])
def test_token_weighted_coverage_survives_lossy_json_parsing(quantity, schedule_available):
    schedule = (
        PriceSchedule("test-v1", {"m": ModelRates(prompt=Fraction(1, 1_000_000))})
        if schedule_available
        else None
    )
    rows = []
    expected = []
    # Different buckets and accounting partitions exercise both kinds of aggregation.
    for source, semantics in [("a", "tracelab-claude"), ("b", "tracelab-claude"), ("c", "unknown")]:
        usage = price_usage(TokenUsage("m", semantics, quantity, None, 0, 0), schedule)
        rows.append(
            AggregateRow(
                (source,),
                (
                    AggregatePart(
                        usage.cost,
                        int(usage.cost is not None),
                        1,
                        semantics,
                        priced_tokens=usage.priced_tokens,
                        total_tokens=usage.total_tokens,
                    ),
                ),
            )
        )
        expected.append((usage.priced_tokens, usage.total_tokens))
    result = assemble_query(
        MetricQuerySpec(REGISTRY.get("scheduled_cost_usd"), group_by=(Dimension.SOURCE,)),
        AggregateRows(tuple(rows), schedule_version=schedule.version if schedule else None),
    )
    # FastAPI serializes this response type with Pydantic. IEEE-754 parsing reproduces
    # the browser's rounding, without adding a Node dependency to the backend suite.
    payload = TypeAdapter(MetricQueryResult).dump_json(result)
    body = json.loads(payload, parse_int=float)

    def assert_coverage(coverage, known, total):
        assert coverage["known_text"] == str(known)
        assert coverage["total_text"] == str(total)
        assert int(coverage["known_text"]) == known
        assert int(coverage["total_text"]) == total
        assert coverage["known"] == float(known)
        assert coverage["total"] == float(total)

    assert_coverage(body["overall"]["priced_coverage"], sum(p[0] for p in expected), 3 * quantity)
    for partition in body["overall"]["semantics_partitions"]:
        matching = [
            pair
            for row, pair in zip(rows, expected, strict=True)
            if row.parts[0].semantics == partition["semantics"]
        ]
        assert_coverage(
            partition["priced_coverage"], *(sum(p[i] for p in matching) for i in (0, 1))
        )
    for bucket, pair in zip(body["buckets"], expected, strict=True):
        assert_coverage(bucket["result"]["priced_coverage"], *pair)
        assert_coverage(bucket["result"]["semantics_partitions"][0]["priced_coverage"], *pair)
    if quantity == 9_007_199_254_740_993 and schedule_available:
        coverage = body["buckets"][0]["result"]["priced_coverage"]
        assert int(coverage["known"]) == 9_007_199_254_740_992
        assert int(coverage["known_text"]) == 9_007_199_254_740_993
