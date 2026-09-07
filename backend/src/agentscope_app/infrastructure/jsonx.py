"""JSON codec that keeps numbers exact: ints of any size and Decimal fractions.

Used for the SQLite JSON columns (so raw payloads round-trip exactly) and for
the API's ``payload_text`` (so browsers do not round what they display). It is
a direct recursive serialiser: strings and keys are never rewritten.
"""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any


def dumps_exact(payload: Any, *, indent: int | None = None) -> str:
    parts: list[str] = []
    _write(payload, parts, indent, 0)
    return "".join(parts)


def loads_exact(text: str) -> Any:
    return json.loads(text, parse_float=Decimal)


def _write(value: Any, out: list[str], indent: int | None, depth: int) -> None:
    if value is None:
        out.append("null")
    elif value is True:
        out.append("true")
    elif value is False:
        out.append("false")
    elif isinstance(value, int):
        out.append(str(value))
    elif isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError("non-finite decimals are not valid JSON")
        out.append(format(value, "f") if value == value.to_integral_value() else str(value))
    elif isinstance(value, float):
        out.append(json.dumps(value, allow_nan=False))
    elif isinstance(value, str):
        out.append(json.dumps(value, ensure_ascii=False))
    elif isinstance(value, dict):
        if not value:
            out.append("{}")
            return
        out.append("{")
        for index, (key, item) in enumerate(value.items()):
            if index:
                out.append(",")
            _newline(out, indent, depth + 1)
            out.append(json.dumps(str(key), ensure_ascii=False))
            out.append(": " if indent is not None else ":")
            _write(item, out, indent, depth + 1)
        _newline(out, indent, depth)
        out.append("}")
    elif isinstance(value, list | tuple):
        if not value:
            out.append("[]")
            return
        out.append("[")
        for index, item in enumerate(value):
            if index:
                out.append(",")
            _newline(out, indent, depth + 1)
            _write(item, out, indent, depth + 1)
        _newline(out, indent, depth)
        out.append("]")
    else:
        raise TypeError(f"Object of type {type(value).__name__} is not JSON serialisable")


def _newline(out: list[str], indent: int | None, depth: int) -> None:
    if indent is not None:
        out.append("\n" + " " * (indent * depth))
