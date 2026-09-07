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
