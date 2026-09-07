"""Restricted path language used by mappings.

Grammar: ``("$" | "@root") ( "." NAME | "[" INT "]" | "[*]" )*``.
``$`` is the current item (the root record, or one item of a selector);
``@root`` is always the root record. No filters, no recursion, no expressions.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Final

MAX_SEGMENTS: Final = 16
_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_-]*")
_INT = re.compile(r"-?\d+")


class PathSyntaxError(ValueError):
    pass


class _Missing:
    __slots__ = ()

    def __repr__(self) -> str:
        return "MISSING"


MISSING: Final = _Missing()


@dataclass(frozen=True)
class Key:
    name: str


@dataclass(frozen=True)
class Index:
    index: int


@dataclass(frozen=True)
class Wildcard:
    pass


Segment = Key | Index | Wildcard


@dataclass(frozen=True)
class Path:
    scope: str  # "current" | "root"
    segments: tuple[Segment, ...]
    text: str

    @property
    def has_wildcard(self) -> bool:
        return any(isinstance(s, Wildcard) for s in self.segments)


def parse_path(text: str) -> Path:
    if text.startswith("@root"):
        scope, rest = "root", text[5:]
    elif text.startswith("$"):
        scope, rest = "current", text[1:]
    else:
        raise PathSyntaxError(f"Path must start with '$' or '@root': {text!r}")
    segments: list[Segment] = []
    pos = 0
    while pos < len(rest):
        if rest[pos] == ".":
            m = _NAME.match(rest, pos + 1)
            if not m:
                raise PathSyntaxError(f"Expected a name after '.' at {pos} in {text!r}")
            segments.append(Key(m.group()))
            pos = m.end()
        elif rest[pos] == "[":
            end = rest.find("]", pos)
            if end < 0:
                raise PathSyntaxError(f"Unclosed '[' in {text!r}")
            inner = rest[pos + 1 : end]
            if inner == "*":
                segments.append(Wildcard())
            elif _INT.fullmatch(inner):
                segments.append(Index(int(inner)))
            else:
                raise PathSyntaxError(f"Index must be an integer or '*' in {text!r}")
            pos = end + 1
        else:
            raise PathSyntaxError(f"Unexpected character {rest[pos]!r} at {pos} in {text!r}")
    if len(segments) > MAX_SEGMENTS:
        raise PathSyntaxError(f"Path deeper than {MAX_SEGMENTS} segments: {text!r}")
    return Path(scope, tuple(segments), text)


def _step(value: Any, segment: Key | Index) -> Any:
    if isinstance(segment, Key):
        if isinstance(value, dict) and segment.name in value:
            return value[segment.name]
        return MISSING
    if isinstance(value, list) and -len(value) <= segment.index < len(value):
        return value[segment.index]
    return MISSING


def resolve_one(path: Path, current: Any, root: Any) -> Any:
    """Resolve a wildcard-free path to a single value or MISSING."""
    value = root if path.scope == "root" else current
    for segment in path.segments:
        if isinstance(segment, Wildcard):
            raise ValueError(f"Wildcard not allowed in single-value path {path.text!r}")
        value = _step(value, segment)
        if value is MISSING:
            return MISSING
    return value


def resolve_many(path: Path, current: Any, root: Any, *, limit: int) -> list[Any]:
    """Resolve a path, fanning out over wildcards. Missing branches yield nothing."""
    values: list[Any] = [root if path.scope == "root" else current]
    for segment in path.segments:
        next_values: list[Any] = []
        for value in values:
            if isinstance(segment, Wildcard):
                if isinstance(value, list):
                    next_values.extend(value)
            else:
                stepped = _step(value, segment)
                if stepped is not MISSING:
                    next_values.append(stepped)
            if len(next_values) > limit:
                raise ValueError(f"Selector {path.text!r} exceeded the item limit of {limit}")
        values = next_values
    return values
