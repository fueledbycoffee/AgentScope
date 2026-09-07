"""Domain-level error and diagnostic types."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class Severity(StrEnum):
    ERROR = "error"
    WARNING = "warning"


@dataclass(frozen=True)
class ValidationIssue:
    """One problem found while validating a mapping document.

    ``path`` locates the problem inside the mapping document (for example
    ``rules[1].fields.model``); ``code`` is a stable machine identifier;
    ``message`` explains the problem to a person.
    """

    stage: str
    path: str
    code: str
    message: str
    severity: Severity = Severity.ERROR


class MappingValidationError(ValueError):
    """Raised when a mapping document cannot be turned into an AST at all."""

    def __init__(self, issues: list[ValidationIssue] | tuple[ValidationIssue, ...]) -> None:
        self.issues: tuple[ValidationIssue, ...] = tuple(issues)
        lines = [f"{i.severity.value}: {i.path}: {i.code}: {i.message}" for i in self.issues]
        super().__init__("Invalid mapping:\n" + "\n".join(lines))


class ConversionError(ValueError):
    """A value could not be converted to the target type or unit."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)
