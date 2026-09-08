"""Exact descriptive statistics over original recorded observations."""

from collections.abc import Sequence
from dataclasses import dataclass
from fractions import Fraction

from agentscope_app.domain.numbers import number_text


@dataclass(frozen=True)
class Distribution:
    count: int
    min_text: str
    median_text: str
    p90_text: str
    max_text: str


def distribution(values: Sequence[int]) -> Distribution | None:
    if not values:
        return None
    ordered = sorted(values)
    n = len(ordered)
    median = Fraction(ordered[(n - 1) // 2] + ordered[n // 2], 2)
    median_text = number_text(median)
    assert median_text is not None
    return Distribution(
        n, str(ordered[0]), median_text, str(ordered[(9 * n + 9) // 10 - 1]), str(ordered[-1])
    )
