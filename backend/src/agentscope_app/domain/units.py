"""Strict conversions to canonical types and units. Nothing here guesses."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from decimal import (
    Decimal,
    DecimalException,
    Inexact,
    InvalidOperation,
    Overflow,
    Subnormal,
    Underflow,
    localcontext,
)
from typing import Any, Final

from agentscope_app.domain.errors import ConversionError
from agentscope_app.domain.schema import FieldType

# Factors to milliseconds, exact decimals so conversions never accumulate float error.
DURATION_UNITS: Final[dict[str, Decimal]] = {
    "ns": Decimal("0.000001"),
    "us": Decimal("0.001"),
    "ms": Decimal(1),
    "s": Decimal(1000),
    "min": Decimal(60000),
}
TIMESTAMP_FORMATS: Final = ("iso8601", "epoch_s", "epoch_ms")
# Converted durations must stay below 10^19 target units (about 300 million years
# in ms); anything larger is out of range rather than a multi-megabyte integer.
MAX_DURATION_MAGNITUDE: Final = Decimal(10) ** 19
# Every integer measure must fit a signed 64-bit column. The digit bound is a
# cheap pre-check on Decimal.adjusted() (no arithmetic) before the exact one.
INT64_MIN: Final = -(2**63)
INT64_MAX: Final = 2**63 - 1
MAX_INTEGER_DIGITS: Final = 19  # Decimal.adjusted() >= 19 means |value| >= 10**19 > INT64_MAX
_TRUE: Final = frozenset({"true", "1", "yes", "y", "t"})
_FALSE: Final = frozenset({"false", "0", "no", "n", "f"})
_INT_STRING: Final = re.compile(r"-?\d{1,19}")  # 19 digits reach the exact int64 check


def _bounded_int(value: int) -> int:
    if not INT64_MIN <= value <= INT64_MAX:
        raise ConversionError("out_of_range", f"{value} does not fit a signed 64-bit integer")
    return value


def convert_duration(value: Any, from_unit: str, to_unit: str) -> int | Decimal:
    """Convert a duration exactly. Accepts ints, floats and numeric strings.

    Strings are parsed as decimals directly (never through a binary float).
    The arithmetic runs in a context that traps any inexact, overflowing or
    underflowing result, so a value is either converted exactly or refused;
    it is never rounded. Integral results come back as ``int``, others as
    ``Decimal`` so that a later integer coercion still sees the fraction.
    """
    if from_unit not in DURATION_UNITS or to_unit not in DURATION_UNITS:
        raise ConversionError(
            "unknown_unit", f"Unknown duration unit: {from_unit!r} -> {to_unit!r}"
        )
    if isinstance(value, bool) or not isinstance(value, int | float | str | Decimal):
        raise ConversionError("invalid_type", f"Cannot convert {value!r} to a duration")
    try:
        with localcontext() as ctx:
            ctx.prec = 60
            ctx.traps[Inexact] = True
            ctx.traps[Overflow] = True
            ctx.traps[Underflow] = True
            ctx.traps[Subnormal] = True
            if isinstance(value, Decimal):
                exact = value
            elif isinstance(value, int):
                exact = Decimal(value)
            elif isinstance(value, float):
                exact = Decimal(repr(value))
            else:
                exact = Decimal(value.strip())
            if not exact.is_finite():
                raise ConversionError(
                    "nonfinite_value", f"Duration {value!r} is not a finite number"
                )
            result = exact * DURATION_UNITS[from_unit] / DURATION_UNITS[to_unit]
    except (InvalidOperation, ValueError) as exc:
        raise ConversionError("invalid_type", f"Cannot convert {value!r} to a duration") from exc
    except DecimalException as exc:
        raise ConversionError(
            "precision_loss",
            f"Duration {value!r} {from_unit} cannot be converted to {to_unit} exactly",
        ) from exc
    if result.copy_abs() >= MAX_DURATION_MAGNITUDE:  # copy_abs is context-free
        # Never expand a huge exponent into a huge integer: bound before int().
        raise ConversionError(
            "out_of_range", f"Duration {value!r} {from_unit} exceeds the supported range"
        )
    if result == result.to_integral_value():
        return _bounded_int(int(result))
    return result


def parse_timestamp(value: Any, fmt: str) -> datetime:
    if fmt not in TIMESTAMP_FORMATS:
        raise ConversionError("unknown_timestamp_format", f"Unknown timestamp format {fmt!r}")
    if isinstance(value, bool) or value is None:
        raise ConversionError("invalid_timestamp", f"Cannot parse timestamp from {value!r}")
    try:
        if fmt == "iso8601":
            if not isinstance(value, str):
                raise TypeError("iso8601 timestamps must be strings")
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)
        seconds = float(value) if fmt == "epoch_s" else float(value) / 1000.0
        return datetime.fromtimestamp(seconds, tz=UTC)
    except (ValueError, TypeError, OverflowError, OSError) as exc:
        raise ConversionError("invalid_timestamp", f"Cannot parse {value!r} as {fmt}") from exc


_FRACTION = re.compile(r"[Tt ]\d{2}:\d{2}:\d{2}[.,](\d+)")


def timestamp_notes(value: Any, fmt: str) -> tuple[str, ...]:
    """Codes describing what ``parse_timestamp`` had to give up on ``value``.

    ``precision_reduced``: more than six fractional digits (the canonical
    datetime is microsecond). ``naive_timestamp``: no offset or ``Z``, so the
    instant was taken as UTC. Both are warnings, never rejections, and both
    are decided by the same parser that accepts the value.
    """
    if fmt != "iso8601" or not isinstance(value, str):
        return ()
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00").replace("z", "+00:00"))
    except ValueError:
        return ()
    notes: list[str] = []
    if parsed.tzinfo is None:
        notes.append("naive_timestamp")
    match = _FRACTION.search(value)
    if match and len(match.group(1)) > 6:
        notes.append("precision_reduced")
    return tuple(notes)


def coerce(value: Any, field_type: FieldType, *, timestamp_format: str | None = None) -> Any:
    """Convert ``value`` to ``field_type`` without guessing.

    Accepted: strings for STRING plus ints/floats rendered with ``str``;
    ints, integral floats and integer strings for INTEGER; ints, floats and
    numeric strings for NUMBER; bools and the usual true/false words for
    BOOLEAN; TIMESTAMP goes through ``parse_timestamp``. Bools never become
    numbers or strings, and None is never a valid input.
    """
    if field_type is FieldType.TIMESTAMP:
        return parse_timestamp(value, timestamp_format or "iso8601")
    if isinstance(value, bool):
        if field_type is FieldType.BOOLEAN:
            return value
        raise ConversionError("invalid_type", f"Boolean {value!r} cannot become {field_type.value}")
    if field_type is FieldType.STRING:
        if isinstance(value, str):
            return value
        if isinstance(value, int | float | Decimal):
            return str(value)
    elif field_type is FieldType.INTEGER:
        if isinstance(value, int):
            return _bounded_int(value)
        if isinstance(value, Decimal):
            if not value.is_finite():
                raise ConversionError("nonfinite_value", f"{value} is not a finite number")
            # adjusted() reads the exponent without arithmetic, so a huge exponent
            # is refused before any context operation can overflow or expand it.
            if not value.is_zero() and value.adjusted() >= MAX_INTEGER_DIGITS:
                raise ConversionError("out_of_range", f"{value} exceeds the supported range")
            if value != value.to_integral_value():
                raise ConversionError("invalid_type", f"Cannot convert {value} to integer exactly")
            return _bounded_int(int(value))
        if isinstance(value, float) and value.is_integer():
            return _bounded_int(int(value))
        if isinstance(value, str) and _INT_STRING.fullmatch(value.strip()):
            return _bounded_int(int(value.strip()))
    elif field_type is FieldType.NUMBER:
        if isinstance(value, int | float):
            return value
        if isinstance(value, Decimal) and value.is_finite():
            if not value.is_zero() and value.adjusted() >= MAX_INTEGER_DIGITS:
                raise ConversionError("out_of_range", f"{value} exceeds the supported range")
            return float(value)
        if isinstance(value, str):
            try:
                return float(value)
            except ValueError:
                pass
    elif field_type is FieldType.BOOLEAN and isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in _TRUE:
            return True
        if lowered in _FALSE:
            return False
    raise ConversionError("invalid_type", f"Cannot convert {value!r} to {field_type.value}")
