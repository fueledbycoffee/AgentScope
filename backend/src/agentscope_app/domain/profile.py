"""Bounded field profile of decoded records, for the mapping assistant.

A pure function over records as the readers return them: JSON values, with
the Parquet reader's ``{"_arrow": kind, ...}`` wrappers left as they are. It
never reads files and never imports a reader.

Observation units (used everywhere a rate is reported):

- ``inspected``: records looked at (at most ``limits.records``).
- per path, ``records``: inspected records in which the path yields at least
  one value (null included); ``values``: values observed across all records
  (one per array element); ``nulls``: values that are JSON null or a wrapper
  whose payload is null; ``missing = inspected - records``. Coverage is
  ``records / inspected``, the null rate is ``nulls / values``.

Paths are the mapping DSL's own (``$.usage.prompt_tokens``,
``$.tools[*].tool_name``) and are checked with ``parse_path`` so a proposal
can copy them. A key the grammar cannot address (a dot, a space, a leading
digit, a non-ASCII letter, or over ``limits.key_length``) is reported under
``unaddressable`` instead of being flattened into a path that would point at
a different value. Examples are redacted before they are chosen or cut.
"""

from __future__ import annotations

import hashlib
import math
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Final

from agentscope_app.domain.mapping.paths import _NAME as _KEY_NAME
from agentscope_app.domain.mapping.paths import parse_path
from agentscope_app.domain.redaction import (
    credential_value,
    key_is_credential,
    key_sensitivity,
    redact_text,
    sanitize,
)

PROFILER_VERSION: Final = 1
WRAPPER_KEY: Final = "_arrow"
_WRAPPER_PAYLOAD: Final = {
    "timestamp": "value",
    "duration": "seconds",
    "time": "seconds",
    "binary": "base64",
    "float": "value",
}
_WRAPPER_EXAMPLE: Final = {
    "timestamp": "iso",
    "duration": "seconds",
    "time": "seconds",
    "float": "value",
}
_WRAPPER_ACCESSORS: Final = {
    "timestamp": ("iso", "value"),
    "duration": ("seconds",),
    "time": ("seconds",),
    "binary": ("base64",),
    "float": ("value",),
}
_ISO8601 = re.compile(
    r"^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$"
)
_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_EPOCH_SECONDS = (Decimal(10) ** 8, Decimal(10) ** 10)  # 1973 .. 2286
_EPOCH_MILLIS = (Decimal(10) ** 11, Decimal(10) ** 13)
_DISTINCT_TRACKED: Final = 5_000  # exact distinct count up to this many values, for ratios


@dataclass(frozen=True)
class ProfileLimits:
    records: int = 2_000
    paths: int = 400
    depth: int = 8
    array_items: int = 200
    nodes: int = 200_000
    key_length: int = 200
    distinct: int = 50
    examples: int = 5
    example_chars: int = 80
    unaddressable: int = 100
    sample_records: int = 20


DEFAULT_LIMITS: Final = ProfileLimits()


@dataclass
class FieldStat:
    path: str
    selector: str
    relative: str
    depth: int
    records: int = 0
    values: int = 0
    nulls: int = 0
    types: dict[str, int] = field(default_factory=dict)
    distinct: int = 0
    distinct_capped: bool = False
    examples: list[Any] = field(default_factory=list)
    min: Any = None
    max: Any = None
    min_length: int | None = None
    max_length: int | None = None
    hints: list[str] = field(default_factory=list)
    wrapper: dict[str, Any] | None = None  # {kind, units, tz, accessors} for Arrow wrappers
    # working state, dropped by to_dict
    _seen: set[str] = field(default_factory=set, repr=False)
    _seen_capped: bool = field(default=False, repr=False)
    _candidates: dict[str, tuple[Any, dict[str, int]]] = field(default_factory=dict, repr=False)
    _strings: int = field(default=0, repr=False)
    _iso: int = field(default=0, repr=False)
    _uuid: int = field(default=0, repr=False)
    _long_text: int = field(default=0, repr=False)
    _numbers: int = field(default=0, repr=False)
    _epoch_s: int = field(default=0, repr=False)
    _epoch_ms: int = field(default=0, repr=False)


@dataclass(frozen=True)
class Unaddressable:
    parent: str
    key: str  # redacted and cut before it is reported
    reason: str


@dataclass(frozen=True)
class Withheld:
    """A key the redactor would change: its whole subtree stays out of the profile."""

    parent: str
    reason: str


@dataclass
class FieldProfile:
    version: int
    inspected: int
    fields: list[FieldStat]
    unaddressable: list[Unaddressable]
    withheld: list[Withheld]
    truncated: dict[str, int]
    nodes_visited: int
    coverage_sample: list[int]  # indices of the inspected records that first showed a path
    redactions: dict[str, int]  # replacements inside the retained examples, by reason

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "inspected": self.inspected,
            "nodes_visited": self.nodes_visited,
            "truncated": dict(self.truncated),
            "redactions": dict(self.redactions),
            "coverage_sample": list(self.coverage_sample),
            "fields": [_stat_to_dict(s, self.inspected) for s in self.fields],
            "unaddressable": [
                {"parent": u.parent, "key": u.key, "reason": u.reason} for u in self.unaddressable
            ],
            "withheld": [{"parent": w.parent, "reason": w.reason} for w in self.withheld],
        }


def _stat_to_dict(stat: FieldStat, inspected: int) -> dict[str, Any]:
    return {
        "path": stat.path,
        "selector": stat.selector,
        "relative": stat.relative,
        "depth": stat.depth,
        "records": stat.records,
        "missing": inspected - stat.records,
        "values": stat.values,
        "nulls": stat.nulls,
        "types": dict(stat.types),
        "distinct": stat.distinct,
        "distinct_capped": stat.distinct_capped,
        "examples": list(stat.examples),
        "min": stat.min,
        "max": stat.max,
        "min_length": stat.min_length,
        "max_length": stat.max_length,
        "hints": list(stat.hints),
        "wrapper": None if stat.wrapper is None else _wrapper_to_dict(stat.wrapper),
    }


def _wrapper_to_dict(wrapper: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": wrapper["kind"],
        "units": dict(wrapper["units"]),
        "tz": dict(wrapper["tz"]),
        "accessors": list(wrapper["accessors"]),
    }


class _Budget:
    def __init__(self, nodes: int) -> None:
        self.left = nodes
        self.visited = 0
        self.exhausted = False

    def take(self) -> bool:
        if self.left <= 0:
            self.exhausted = True
            return False
        self.left -= 1
        self.visited += 1
        return True


class _Profiler:
    def __init__(self, limits: ProfileLimits) -> None:
        self.limits = limits
        self.stats: dict[str, FieldStat] = {}
        self.unaddressable: dict[tuple[str, str], Unaddressable] = {}
        self.withheld: dict[tuple[str, str], Withheld] = {}
        self.truncated: dict[str, int] = {}
        self.budget = _Budget(limits.nodes)
        self.sample: list[int] = []
        self.credential_values = 0
        self._record_paths: set[str] = set()
        self._new_path_in_record = False

    def bump(self, limit: str, by: int = 1) -> None:
        self.truncated[limit] = self.truncated.get(limit, 0) + by

    def stat(self, path: str, selector: str, relative: str, depth: int) -> FieldStat | None:
        existing = self.stats.get(path)
        if existing is not None:
            return existing
        if len(self.stats) >= self.limits.paths:
            self.bump("paths")
            return None
        parse_path(path)  # every reported path is one the DSL accepts
        created = FieldStat(path=path, selector=selector, relative=relative, depth=depth)
        self.stats[path] = created
        self._new_path_in_record = True
        return created

    # -- traversal -------------------------------------------------------------------

    def record(self, index: int, value: Any) -> None:
        self._record_paths = set()
        self._new_path_in_record = False
        self.visit(value, "$", "$", "$", 0)
        if self._new_path_in_record and len(self.sample) < self.limits.sample_records:
            self.sample.append(index)

    def visit(self, value: Any, path: str, selector: str, relative: str, depth: int) -> None:
        if not self.budget.take():
            return
        stat = self.stat(path, selector, relative, depth)
        if stat is None:
            return
        if path not in self._record_paths:
            self._record_paths.add(path)
            stat.records += 1
        stat.values += 1
        kind = _wrapper_kind(value)
        if kind is not None:  # a known Arrow wrapper; any other "_arrow" is an ordinary key
            self.observe_wrapper(stat, kind, value)
            return
        if isinstance(value, dict):
            _count(stat, "object")
            if depth >= self.limits.depth:
                self.bump("depth")
                return
            for key, item in value.items():
                sensitive = key_sensitivity(key)
                if sensitive is not None:
                    self.note_withheld(path, str(key), sensitive)
                    continue
                reason = _key_problem(key, self.limits.key_length)
                if reason is not None:
                    self.note_unaddressable(path, str(key), reason)
                    continue
                if key_is_credential(key):
                    replaced = credential_value(item)  # a credential by name, whatever its shape
                    if replaced is not item:
                        item = replaced
                        self.credential_values += 1
                self.visit(item, f"{path}.{key}", selector, f"{relative}.{key}", depth + 1)
            return
        if isinstance(value, list | tuple):
            _count(stat, "array")
            _length(stat, len(value))
            if depth >= self.limits.depth:
                self.bump("depth")
                return
            child_path = f"{path}[*]"
            over = len(value) - self.limits.array_items
            if over > 0:
                self.bump("array_items", over)
            for item in value[: self.limits.array_items]:
                self.visit(item, child_path, child_path, "$", depth + 1)
            return
        self.observe_scalar(stat, value)

    def note_unaddressable(self, parent: str, key: str, reason: str) -> None:
        if (parent, key) in self.unaddressable:
            return
        if len(self.unaddressable) >= self.limits.unaddressable:
            self.bump("unaddressable")
            return
        # a key that would be redacted was withheld before reaching here; only the cut remains
        self.unaddressable[(parent, key)] = Unaddressable(parent, key[:80], reason)

    def note_withheld(self, parent: str, key: str, reason: str) -> None:
        if (parent, key) in self.withheld:
            return
        if len(self.withheld) >= self.limits.unaddressable:
            self.bump("withheld")
            return
        self.withheld[(parent, key)] = Withheld(parent, reason)

    # -- observation -----------------------------------------------------------------

    def observe_wrapper(self, stat: FieldStat, kind: str, value: dict[str, Any]) -> None:
        _count(stat, f"arrow:{kind}")
        if stat.wrapper is None:
            accessors = [f"{stat.relative}.{member}" for member in _WRAPPER_ACCESSORS.get(kind, ())]
            stat.wrapper = {"kind": kind, "units": {}, "tz": {}, "accessors": accessors}
        for meta in ("unit", "tz"):
            if meta in value and value[meta] is not None:
                bucket = stat.wrapper["units" if meta == "unit" else "tz"]
                # metadata is source data too: redact and bound it like any string
                label = redact_text(str(value[meta]), long_text=False)[0][:40]
                bucket[label] = bucket.get(label, 0) + 1
        payload = value.get(_WRAPPER_PAYLOAD.get(kind, "value"))
        if payload is None:
            stat.nulls += 1
            return
        shown = value.get(_WRAPPER_EXAMPLE.get(kind, ""))
        self.distinct(stat, f"{kind}:{payload!r}")
        if shown is not None and not isinstance(shown, dict | list):
            self.example(stat, shown)

    def observe_scalar(self, stat: FieldStat, value: Any) -> None:
        if value is None:
            _count(stat, "null")
            stat.nulls += 1
            return
        if isinstance(value, bool):
            _count(stat, "boolean")
            self.distinct(stat, f"b:{value}")
            self.example(stat, value)
            return
        if isinstance(value, int | Decimal | float):
            number = _as_decimal(value)
            _count(stat, "integer" if _is_integral(value, number) else "number")
            stat._numbers += 1
            if _EPOCH_SECONDS[0] <= number < _EPOCH_SECONDS[1]:
                stat._epoch_s += 1
            elif _EPOCH_MILLIS[0] <= number < _EPOCH_MILLIS[1]:
                stat._epoch_ms += 1
            exact: Any = value if isinstance(value, int) and not isinstance(value, bool) else number
            if stat.min is None or number < _as_decimal(stat.min):
                stat.min = exact
            if stat.max is None or number > _as_decimal(stat.max):
                stat.max = exact
            self.distinct(stat, f"n:{number}")
            self.example(stat, exact)
            return
        if isinstance(value, str):
            _count(stat, "string")
            stat._strings += 1
            _length(stat, len(value))
            if _ISO8601.match(value):
                stat._iso += 1
            elif _UUID.match(value):
                stat._uuid += 1
            if len(value) > 120 and " " in value:
                stat._long_text += 1
            self.distinct(stat, f"s:{value}")
            self.example(stat, value)
            return
        # an unknown Python type from a reader is reported, not raised
        _count(stat, type(value).__name__)

    def distinct(self, stat: FieldStat, key: str) -> None:
        if stat._seen_capped:
            return
        digest = hashlib.sha1(key.encode("utf-8", "surrogatepass")).hexdigest()
        if digest in stat._seen:
            return
        if len(stat._seen) >= _DISTINCT_TRACKED:
            stat._seen_capped = True
            return
        stat._seen.add(digest)

    def example(self, stat: FieldStat, value: Any) -> None:
        shown: Any = value
        counts: dict[str, int] = {}
        if isinstance(value, str):
            redacted, counts = sanitize(value)
            shown = redacted[: self.limits.example_chars]
        key = f"{type(shown).__name__}:{shown!r}"
        if key in stat._candidates:
            return
        if len(stat._candidates) < self.limits.examples:
            stat._candidates[key] = (shown, counts)
            return
        longest = max(stat._candidates, key=lambda k: len(str(stat._candidates[k][0])))
        if len(str(shown)) < len(str(stat._candidates[longest][0])):
            del stat._candidates[longest]
            stat._candidates[key] = (shown, counts)

    # -- finish ----------------------------------------------------------------------

    def finish(self, inspected: int) -> FieldProfile:
        redactions: dict[str, int] = {}
        if self.credential_values:
            redactions["token"] = self.credential_values
        for stat in self.stats.values():
            seen = len(stat._seen)
            stat.distinct = min(seen, self.limits.distinct)
            stat.distinct_capped = seen >= self.limits.distinct or stat._seen_capped
            kept = sorted(stat._candidates.values(), key=lambda c: (len(str(c[0])), str(c[0])))
            stat.examples = [shown for shown, _ in kept]
            for _, counts in kept:
                for reason, n in counts.items():
                    redactions[reason] = redactions.get(reason, 0) + n
            stat.hints = _hints(stat, seen)
        return FieldProfile(
            version=PROFILER_VERSION,
            inspected=inspected,
            fields=list(self.stats.values()),
            unaddressable=list(self.unaddressable.values()),
            withheld=list(self.withheld.values()),
            truncated=dict(sorted(self.truncated.items())),
            nodes_visited=self.budget.visited,
            coverage_sample=list(self.sample),
            redactions=dict(sorted(redactions.items())),
        )


def profile_records(
    records: Iterable[Any], *, limits: ProfileLimits = DEFAULT_LIMITS
) -> FieldProfile:
    """Profile at most ``limits.records`` records; every limit that bites is reported."""
    profiler = _Profiler(limits)
    inspected = 0
    for index, record in enumerate(records):
        if inspected >= limits.records:
            profiler.bump("records")
            continue
        inspected += 1
        profiler.record(index, record)
        if profiler.budget.exhausted:
            profiler.bump("nodes")
            break
    return profiler.finish(inspected)


# -- helpers ---------------------------------------------------------------------------


def _wrapper_kind(value: Any) -> str | None:
    if isinstance(value, dict):
        kind = value.get(WRAPPER_KEY)
        if isinstance(kind, str) and kind in _WRAPPER_PAYLOAD:
            return kind
    return None


def _key_problem(key: Any, max_length: int) -> str | None:
    if not isinstance(key, str):
        return "key_not_a_string"
    if len(key) > max_length:
        return "key_too_long"
    if not _KEY_NAME.fullmatch(key):
        return "key_not_addressable"
    return None


def _count(stat: FieldStat, kind: str) -> None:
    stat.types[kind] = stat.types.get(kind, 0) + 1


def _length(stat: FieldStat, length: int) -> None:
    stat.min_length = length if stat.min_length is None else min(stat.min_length, length)
    stat.max_length = length if stat.max_length is None else max(stat.max_length, length)


def _as_decimal(value: Any) -> Decimal:
    if isinstance(value, Decimal):
        return value
    if isinstance(value, float):
        return Decimal(repr(value)) if math.isfinite(value) else Decimal(0)
    return Decimal(int(value))


def _is_integral(value: Any, number: Decimal) -> bool:
    if isinstance(value, int):
        return True
    return number.is_finite() and number == number.to_integral_value()


def _hints(stat: FieldStat, seen: int) -> list[str]:
    hints: list[str] = []
    strings, numbers, non_null = stat._strings, stat._numbers, stat.values - stat.nulls
    if strings and strings == non_null:
        if stat._iso >= 0.9 * strings:
            hints.append("iso8601")
        if stat._uuid >= 0.9 * strings:
            hints.append("uuid")
        if stat._long_text > 0.5 * strings:
            hints.append("free_text")
    if numbers and numbers == non_null:
        if stat._epoch_s == numbers:
            hints.append("epoch_seconds")
        elif stat._epoch_ms == numbers:
            hints.append("epoch_millis")
    short = stat.max_length is not None and stat.max_length < 64
    unique = non_null >= 5 and not stat._seen_capped and seen > 0.9 * non_null
    all_strings = bool(strings) and strings == non_null
    if all_strings and unique and short and not ({"free_text", "iso8601"} & set(hints)):
        hints.append("identifier")
    if non_null >= 20 and seen <= 12 and (strings or numbers) and "boolean" not in stat.types:
        hints.append("enum")
    return hints
