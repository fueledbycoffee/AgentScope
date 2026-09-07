"""Target schema: the canonical entities a mapping can emit.

One ``session`` row is one observed coding-agent session; one ``model_call``
row is one recorded model invocation; one ``tool_call`` row is one recorded
tool invocation. Timestamps are UTC, durations integer milliseconds, tokens
non-negative integers. Every measure is nullable: missing is never zero.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Final

TARGET_SCHEMA_VERSION: Final = 1


class FieldType(StrEnum):
    STRING = "string"
    INTEGER = "integer"
    NUMBER = "number"
    BOOLEAN = "boolean"
    TIMESTAMP = "timestamp"


@dataclass(frozen=True)
class TargetField:
    name: str
    type: FieldType
    description: str
    required: bool = False
    unit: str | None = None  # canonical unit, e.g. "ms" or "tokens"


@dataclass(frozen=True)
class TargetEntity:
    name: str
    description: str
    fields: dict[str, TargetField] = field(default_factory=dict)


def _entity(name: str, description: str, *fields: TargetField) -> TargetEntity:
    return TargetEntity(name, description, {f.name: f for f in fields})


_S, _I, _B, _T = FieldType.STRING, FieldType.INTEGER, FieldType.BOOLEAN, FieldType.TIMESTAMP

TARGET_SCHEMA: Final[dict[str, TargetEntity]] = {
    "session": _entity(
        "session",
        "One observed coding-agent session, reconciled by external_id within a source.",
        TargetField("external_id", _S, "Native session identifier in the source.", required=True),
        TargetField("agent", _S, "Harness or agent product label (e.g. claude-code, codex)."),
        TargetField("repo", _S, "Repository or project label if the source has one."),
        TargetField("user", _S, "Pseudonymous user identifier if the source has one."),
        TargetField("started_at", _T, "Start time declared by the source (not observed)."),
        TargetField("ended_at", _T, "End time declared by the source (not observed)."),
    ),
    "model_call": _entity(
        "model_call",
        "One recorded model invocation observation.",
        TargetField("session_external_id", _S, "Session this call belongs to.", required=True),
        TargetField("external_id", _S, "Claimed native identifier of the invocation, if any."),
        TargetField("sequence", _I, "Order of the call inside the session as given by the source."),
        TargetField("provider", _S, "Provider label as given by the source."),
        TargetField("model", _S, "Model identifier as given by the source."),
        TargetField("started_at", _T, "First timestamp of the invocation."),
        TargetField("ended_at", _T, "Last timestamp of the invocation."),
        TargetField("input_tokens", _I, "Total input tokens billed for the call.", unit="tokens"),
        TargetField("output_tokens", _I, "Output tokens for the call.", unit="tokens"),
        TargetField("cache_read_tokens", _I, "Input tokens served from cache.", unit="tokens"),
        TargetField("cache_creation_tokens", _I, "Input tokens written to cache.", unit="tokens"),
        TargetField("reasoning_tokens", _I, "Reasoning/thinking output tokens.", unit="tokens"),
        TargetField("is_error", _B, "Whether the source marks the call as failed."),
        TargetField("error_message", _S, "Error text if the source has one."),
    ),
    "tool_call": _entity(
        "tool_call",
        "One recorded tool invocation observation, optionally linked to its model call.",
        TargetField("session_external_id", _S, "Session this tool call belongs to.", required=True),
        TargetField("external_id", _S, "Claimed native identifier of the tool call, if any."),
        TargetField("sequence", _I, "Order of the tool call as given by the source."),
        TargetField("tool_name", _S, "Tool name as given by the source.", required=True),
        TargetField("started_at", _T, "When the tool call was emitted."),
        TargetField("ended_at", _T, "When the tool result arrived."),
        TargetField("wall_latency_ms", _I, "Wall-clock latency observed in the trace.", unit="ms"),
        TargetField(
            "internal_latency_ms", _I, "Runner-reported latency, kept separate.", unit="ms"
        ),
        TargetField("is_error", _B, "Whether the tool call failed."),
        TargetField("exit_code", _I, "Process exit code if the tool ran a command."),
        TargetField("status", _S, "Status label as given by the source."),
    ),
}
