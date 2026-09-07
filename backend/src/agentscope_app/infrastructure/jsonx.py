"""JSON codec that keeps numbers exact: ints of any size and Decimal fractions.

Used for the SQLite JSON columns (so raw payloads round-trip exactly) and for
the API's ``payload_text`` (so browsers do not round what they display).
"""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any


def dumps_exact(payload: Any, *, indent: int | None = None) -> str:
    numbers: dict[str, str] = {}

    def walk(value: Any) -> Any:
        if isinstance(value, Decimal) or (isinstance(value, int) and not isinstance(value, bool)):
            token = f"__exact_number_{len(numbers)}__"
            numbers[token] = str(value)
            return token
        if isinstance(value, dict):
            return {str(k): walk(v) for k, v in value.items()}
        if isinstance(value, list | tuple):
            return [walk(v) for v in value]
        return value

    text = json.dumps(walk(payload), ensure_ascii=False, indent=indent)
    for token, number in numbers.items():
        text = text.replace(f'"{token}"', number)
    return text


def loads_exact(text: str) -> Any:
    return json.loads(text, parse_float=Decimal)
