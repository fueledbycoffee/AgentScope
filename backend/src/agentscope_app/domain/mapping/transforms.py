"""Allowlisted value transforms. Anything not listed here cannot run."""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Final

from agentscope_app.domain.errors import ConversionError

TRANSFORM_NAMES: Final = ("trim", "lower", "upper", "enum_map", "json_decode")
MAX_JSON_DECODE_CHARS: Final = 65536
ENUM_UNMAPPED_POLICIES: Final = ("keep", "null", "reject")


@dataclass(frozen=True)
class Transform:
    name: str
    params: Mapping[str, Any]


def _require_str(name: str, value: Any) -> str:
    if not isinstance(value, str):
        raise ConversionError(
            "invalid_type", f"{name} expects a string, got {type(value).__name__}"
        )
    return value


def apply_transform(transform: Transform, value: Any) -> Any:
    name = transform.name
    if name == "trim":
        return _require_str(name, value).strip()
    if name == "lower":
        return _require_str(name, value).lower()
    if name == "upper":
        return _require_str(name, value).upper()
    if name == "enum_map":
        mapping: Mapping[str, Any] = transform.params.get("mapping", {})
        policy = transform.params.get("unmapped", "reject")
        key = str(value)
        if key in mapping:
            return mapping[key]
        if policy == "keep":
            return value
        if policy == "null":
            return None
        raise ConversionError(
            "unmapped_enum", f"Value {value!r} is not in the enum mapping (unmapped policy: reject)"
        )
    if name == "json_decode":
        text = _require_str(name, value)
        if len(text) > MAX_JSON_DECODE_CHARS:
            raise ConversionError(
                "json_too_large", f"json_decode input exceeds {MAX_JSON_DECODE_CHARS} characters"
            )
        try:
            return json.loads(text)
        except ValueError as exc:
            raise ConversionError("invalid_json", f"json_decode failed: {exc}") from exc
    raise ConversionError("unknown_transform", f"Transform {name!r} is not allowed")
