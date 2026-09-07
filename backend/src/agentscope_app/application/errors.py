"""Errors raised by use cases; the interfaces layer maps them to HTTP responses."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any


class ApplicationError(Exception):
    code = "application_error"

    def __init__(self, message: str, details: Sequence[Any] = ()) -> None:
        super().__init__(message)
        self.message = message
        self.details: tuple[Any, ...] = tuple(details)


class NotFoundError(ApplicationError):
    code = "not_found"


class InvalidInputError(ApplicationError):
    code = "invalid_input"


class LimitExceededError(ApplicationError):
    code = "limit_exceeded"


class ConflictError(ApplicationError):
    code = "conflict"


class StaleContextError(ConflictError):
    """The prepared context the client acknowledged is not the one that would be sent now."""

    code = "stale_context"


class ContextTooLargeError(LimitExceededError):
    code = "context_too_large"


class AssistantUnavailableError(ApplicationError):
    code = "assistant_unavailable"


class AssistantFailedError(ApplicationError):
    code = "assistant_failed"


class AssistantError(Exception):
    """Raised by adapters; ``kind`` is one of unavailable, timeout, provider, malformed.

    Application-owned so vendor exceptions never cross the port. The message must
    already be safe: no headers, no keys, no SDK dumps.
    """

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message
