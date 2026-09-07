"""Exposure control for values that leave the server (ADR-005).

Redaction is applied to values, never to keys: keys are the structure a mapping
addresses. Replacements keep the shape (``<email>``, ``<token>``, ``<path>``)
so a model still sees what kind of value was there. A whole string is
classified before anything truncates it, so a credential is recognised whole
and a long trace becomes ``<text N chars>`` rather than an excerpt.

This is exposure control, not anonymisation: it removes the well-known shapes
of secrets and personal locators, it does not claim that what remains
identifies nobody. Deliberately absent: a generic "long base64/hex run" rule,
which would destroy the ids (``call_…``, ``round_…``, session ids, UUIDs,
digests) a mapping needs intact.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any, Final

SANITIZER_VERSION: Final = 1
MAX_TEXT_CHARS: Final = 200

POLICY: Final = (
    "Values are redacted by shape: private-key blocks, known credential formats "
    "(OpenAI/OpenRouter/Anthropic keys, GitHub, Slack, AWS, Google, JWT, Bearer "
    "and key=value assignments, plus any value under a key named like a credential), "
    "URL credentials, e-mail addresses, home-directory "
    "paths, IP addresses, and any text longer than 200 characters. Keys are never "
    "rewritten: a key that would be redacted is withheld together with its subtree. "
    "Identifiers, UUIDs and digests are kept. This is exposure control, not "
    "anonymisation."
)

_PRIVATE_KEY = re.compile(
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?(?:-----END [A-Z ]*PRIVATE KEY-----|\Z)", re.S
)
_TOKENS: Final[tuple[re.Pattern[str], ...]] = (
    re.compile(r"\bsk-(?:or-|ant-)?[A-Za-z0-9_-]{20,}"),
    re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"\bxox[abp]-[A-Za-z0-9-]{10,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{30,}"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b"),
)
_BEARER = re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{8,}")
_ASSIGNMENT = re.compile(
    r"(?i)\b((?:authorization|api[_-]?key|api[_-]?token|access[_-]?token|secret|password"
    r"|passwd|token)['\"]?)(\s*[:=]\s*)['\"]?(?!Bearer\b)([^\s'\",;]{6,})['\"]?"
)
_URL_CREDENTIALS = re.compile(r"(?i)\b([a-z][a-z0-9+.-]*://)([^/\s@]+)@")
# bounded quantifiers keep the scan linear; the caller also skips texts without "@"
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}")
# a key whose *name* says its value is a credential: the value is replaced whatever it looks like
_CREDENTIAL_KEY = re.compile(
    r"(?i)^(?:authorization|api[_-]?key|api[_-]?token|access[_-]?token|refresh[_-]?token"
    r"|auth[_-]?token|bearer|secret|client[_-]?secret|password|passwd|token)$"
)
_PATH = re.compile(
    r"(?<![\w/])(?:/Users/[^\s\"'`]+|/home/[^\s\"'`]+|/root(?:/[^\s\"'`]*)?"
    r"|~/[^\s\"'`]+|[A-Za-z]:\\Users\\[^\s\"'`]+)"
)
_IPV4 = re.compile(r"(?<![\w.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\w.])")
_IPV6 = re.compile(
    r"(?<![\w:])(?:(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}"
    r"|(?:[0-9A-Fa-f]{1,4}:){1,6}:(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,5})?)(?![\w:])"
)


def _ipv4(m: re.Match[str]) -> str:
    octets = [int(g) for g in m.groups()]
    if any(o > 255 for o in octets) or octets[0] == 127 or octets == [0, 0, 0, 0]:
        return m.group(0)
    return "<ip>"


def _ipv6(m: re.Match[str]) -> str:
    return m.group(0) if m.group(0) in {"::1", "::"} else "<ip>"


def redact_text(text: str, *, long_text: bool = True) -> tuple[str, Counter[str]]:
    """Return the redacted text and the number of replacements per reason.

    ``long_text=False`` skips the length rule (used for key names, whose length
    the profiler bounds itself).
    """
    counts: Counter[str] = Counter()

    def sub(pattern: re.Pattern[str], reason: str, repl: str) -> None:
        nonlocal text
        text, n = pattern.subn(repl, text)
        if n:
            counts[reason] += n

    original_length = len(text)
    sub(_PRIVATE_KEY, "private_key", "<private-key>")
    for pattern in _TOKENS:
        sub(pattern, "token", "<token>")
    sub(_BEARER, "token", "Bearer <token>")
    sub(_ASSIGNMENT, "token", r"\1\2<token>")
    if "@" in text:
        sub(_URL_CREDENTIALS, "credentials", r"\1<credentials>@")
        sub(_EMAIL, "email", "<email>")
    sub(_PATH, "path", "<path>")
    for pattern, repl in ((_IPV4, _ipv4), (_IPV6, _ipv6)):
        before = text
        text = pattern.sub(repl, text)
        replaced = text.count("<ip>") - before.count("<ip>")
        if replaced:
            counts["ip"] += replaced
    if long_text and original_length > MAX_TEXT_CHARS:
        counts["long_text"] += 1
        text = f"<text {original_length} chars>"
    return text, counts


def key_sensitivity(key: Any) -> str | None:
    """The redaction reason a key name would trigger, or None when it is safe to show.

    Length is not a reason here: keys are bounded by whoever reports them.
    """
    if not isinstance(key, str) or not key:
        return None
    shown, counts = redact_text(key, long_text=False)
    if shown == key:
        return None
    return next(iter(sorted(counts))) if counts else "redacted"


def key_is_credential(key: Any) -> bool:
    """Whether a key's name marks its value as a credential (``password``, ``api_key``, …)."""
    return isinstance(key, str) and _CREDENTIAL_KEY.match(key) is not None


def credential_value(value: Any) -> Any:
    """What a credential-named key's value becomes: ``<token>`` for any non-empty string."""
    return "<token>" if isinstance(value, str) and value else value


def sanitize(value: Any) -> tuple[Any, dict[str, int]]:
    """Redact every string inside a JSON value; container shapes are kept.

    Keys are never rewritten (a rewritten key would point at nothing): a key the
    redactor would change is withheld together with its subtree and counted
    under ``key_withheld``.
    """
    counts: Counter[str] = Counter()
    result = _sanitize(value, counts)
    return result, dict(sorted(counts.items()))


def _sanitize(value: Any, counts: Counter[str]) -> Any:
    if isinstance(value, str):
        text, found = redact_text(value)
        counts.update(found)
        return text
    if isinstance(value, dict):
        clean: dict[Any, Any] = {}
        for key, item in value.items():
            if key_sensitivity(key) is not None:
                counts["key_withheld"] += 1
                continue
            if key_is_credential(key) and isinstance(item, str) and item:
                counts["token"] += 1
                clean[key] = "<token>"
                continue
            clean[key] = _sanitize(item, counts)
        return clean
    if isinstance(value, list | tuple):
        return [_sanitize(item, counts) for item in value]
    return value
