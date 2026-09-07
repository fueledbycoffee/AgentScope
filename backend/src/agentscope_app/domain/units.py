"""Strict conversions to canonical types and units. Nothing here guesses."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any, Final

from agentscope_app.domain.errors import ConversionError
from agentscope_app.domain.schema import FieldType

DURATION_UNITS: Final[dict[str, float]] = {
    "ns": 1e-6,
    "us": 1e-3,
    "ms": 1.0,
    "s": 1000.0,
    "min": 60000.0,
}
TIMESTAMP_FORMATS: Final = ("iso8601", "epoch_s", "epoch_ms")
_TRUE: Final = frozenset({"true", "1", "yes", "y", "t"})
_FALSE: Final = frozenset({"false", "0", "no", "n", "f"})
_INT_STRING: Final = re.compile(r"-?\d{1,18}")


def convert_duration(value: int | float, from_unit: str, to_unit: str) -> int | float:
    if from_unit not in DURATION_UNITS or to_unit not in DURATION_UNITS:
        raise ConversionError(
            "unknown_unit", f"Unknown duration unit: {from_unit!r} -> {to_unit!r}"
        )
    result = value * DURATION_UNITS[from_unit] / DURATION_UNITS[to_unit]
    return int(result) if float(result).is_integer() else result


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
        if isinstance(value, int | float):
            return str(value)
    elif field_type is FieldType.INTEGER:
        if isinstance(value, int):
            return value
        if isinstance(value, float) and value.is_integer():
            return int(value)
        if isinstance(value, str) and _INT_STRING.fullmatch(value.strip()):
            return int(value.strip())
    elif field_type is FieldType.NUMBER:
        if isinstance(value, int | float):
            return value
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
