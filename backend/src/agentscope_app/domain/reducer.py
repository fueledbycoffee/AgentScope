"""Fold session contributions and their children into session aggregates.

This is the fixed domain rule that replaces any aggregation in the DSL:
identity reconciliation by ``external_id`` and observed bounds from the
timestamps of accepted model calls and tool calls.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime

from agentscope_app.domain.identity import SourceOccurrence
from agentscope_app.domain.mapping.interpreter import Diagnostic, Emission

_MERGED_FIELDS = ("agent", "repo", "user", "started_at", "ended_at")


@dataclass
class SessionAggregate:
    """One session as reconciled from every emission that named it.

    ``declared_*`` come from session rows in the source; ``observed_*`` are
    computed from the children and describe the span visible in imported
    data, not active working time.
    """

    external_id: str
    agent: str | None = None
    repo: str | None = None
    user: str | None = None
    declared_started_at: datetime | None = None
    declared_ended_at: datetime | None = None
    observed_start_at: datetime | None = None
    observed_end_at: datetime | None = None
    model_call_count: int = 0
    tool_call_count: int = 0
    contributions: tuple[SourceOccurrence, ...] = field(default_factory=tuple)
    conflicts: tuple[Diagnostic, ...] = field(default_factory=tuple)


class _Accumulator:
    """Mutable per-session state; lists are frozen into the aggregate once."""

    __slots__ = ("aggregate", "conflicts", "contributions", "declared", "first_child")

    def __init__(self, external_id: str) -> None:
        self.aggregate = SessionAggregate(external_id)
        self.contributions: list[SourceOccurrence] = []
        self.conflicts: list[Diagnostic] = []
        self.declared = False
        self.first_child: Emission | None = None


def reduce_sessions(emissions: Iterable[Emission]) -> dict[str, SessionAggregate]:
    accumulators: dict[str, _Accumulator] = {}

    def get(external_id: str, emission: Emission) -> _Accumulator:
        acc = accumulators.get(external_id)
        if acc is None:
            acc = _Accumulator(external_id)
            accumulators[external_id] = acc
        if emission.entity == "session":
            acc.declared = True
        elif acc.first_child is None:
            acc.first_child = emission
        acc.contributions.append(emission.occurrence)
        return acc

    for emission in emissions:
        if emission.entity == "session":
            external_id = emission.fields.get("external_id")
            if external_id is None:
                continue
            _merge_session_fields(get(str(external_id), emission), emission)
            continue
        session_id = emission.fields.get("session_external_id")
        if session_id is None:
            continue
        acc = get(str(session_id), emission)
        session = acc.aggregate
        if emission.entity == "model_call":
            session.model_call_count += 1
        elif emission.entity == "tool_call":
            session.tool_call_count += 1
        started = emission.fields.get("started_at")
        ended = emission.fields.get("ended_at") or started
        if isinstance(started, datetime) and (
            session.observed_start_at is None or started < session.observed_start_at
        ):
            session.observed_start_at = started
        if isinstance(ended, datetime) and (
            session.observed_end_at is None or ended > session.observed_end_at
        ):
            session.observed_end_at = ended

    sessions: dict[str, SessionAggregate] = {}
    for external_id, acc in accumulators.items():
        # Only decided once every contribution is in: a session row may arrive
        # after its children in file order without being "implicit".
        if not acc.declared and acc.first_child is not None:
            acc.conflicts.append(
                Diagnostic(
                    acc.first_child.rule_id,
                    acc.first_child.occurrence,
                    "implicit_session",
                    f"Session {external_id!r} is only known through its children",
                )
            )
        acc.aggregate.contributions = tuple(acc.contributions)
        acc.aggregate.conflicts = tuple(acc.conflicts)
        sessions[external_id] = acc.aggregate
    return sessions


def _merge_session_fields(acc: _Accumulator, emission: Emission) -> None:
    session = acc.aggregate
    for name in _MERGED_FIELDS:
        incoming = emission.fields.get(name)
        if incoming is None:
            continue
        attr = f"declared_{name}" if name.endswith("_at") else name
        current = getattr(session, attr)
        if current is None:
            setattr(session, attr, incoming)
        elif current != incoming:
            acc.conflicts.append(
                Diagnostic(
                    emission.rule_id,
                    emission.occurrence,
                    "conflicting_value",
                    f"{name}: kept {current!r}, ignored {incoming!r}",
                    name,
                )
            )
