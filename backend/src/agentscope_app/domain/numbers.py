"""Exact terminating-decimal transport, independent of Decimal context precision."""

from fractions import Fraction

Number = int | Fraction


def number_text(value: Number | None) -> str | None:
    if value is None:
        return None
    fraction = Fraction(value)
    numerator, denominator = fraction.numerator, fraction.denominator
    twos = fives = 0
    while denominator % 2 == 0:
        denominator //= 2
        twos += 1
    while denominator % 5 == 0:
        denominator //= 5
        fives += 1
    if denominator != 1:
        raise ValueError("Only terminating decimal measurements are supported")
    scale = max(twos, fives)
    scaled = abs(numerator) * 2 ** (scale - twos) * 5 ** (scale - fives)
    digits = str(scaled).zfill(scale + 1)
    text = (
        digits if not scale else (digits[:-scale] + "." + digits[-scale:]).rstrip("0").rstrip(".")
    )
    return ("-" if numerator < 0 else "") + text
