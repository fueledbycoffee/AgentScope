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


def reduce_sessions(emissions: Iterable[Emission]) -> dict[str, SessionAggregate]:
    sessions: dict[str, SessionAggregate] = {}
    first_child: dict[str, Emission] = {}
    declared: set[str] = set()

    def get(external_id: str, emission: Emission) -> SessionAggregate:
        session = sessions.get(external_id)
        if session is None:
            session = SessionAggregate(external_id)
            sessions[external_id] = session
        if emission.entity == "session":
            declared.add(external_id)
        else:
            first_child.setdefault(external_id, emission)
        session.contributions += (emission.occurrence,)
        return session

    for emission in emissions:
        if emission.entity == "session":
            external_id = emission.fields.get("external_id")
            if external_id is None:
                continue
            session = get(str(external_id), emission)
            _merge_session_fields(session, emission)
            continue
        session_id = emission.fields.get("session_external_id")
        if session_id is None:
            continue
        session = get(str(session_id), emission)
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
    # Only decided once every contribution is in: a session row may arrive after
    # its children in file order without being "implicit".
    for external_id, child in first_child.items():
        if external_id not in declared:
            sessions[external_id].conflicts += (
                Diagnostic(
                    child.rule_id,
                    child.occurrence,
                    "implicit_session",
                    f"Session {external_id!r} is only known through its children",
                ),
            )
    return sessions


def _merge_session_fields(session: SessionAggregate, emission: Emission) -> None:
    for name in _MERGED_FIELDS:
        incoming = emission.fields.get(name)
        if incoming is None:
            continue
        attr = f"declared_{name}" if name.endswith("_at") else name
        current = getattr(session, attr)
        if current is None:
            setattr(session, attr, incoming)
        elif current != incoming:
            session.conflicts += (
                Diagnostic(
                    emission.rule_id,
                    emission.occurrence,
                    "conflicting_value",
                    f"{name}: kept {current!r}, ignored {incoming!r}",
                    name,
                ),
            )
