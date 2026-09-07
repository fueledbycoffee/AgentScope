from datetime import UTC, datetime

from agentscope_app.domain.identity import SourceOccurrence
from agentscope_app.domain.mapping.interpreter import Emission
from agentscope_app.domain.reducer import reduce_sessions


def occ(path: str, line: int = 1) -> SourceOccurrence:
    return SourceOccurrence("f", f"line:{line}", path)


def ts(minute: int) -> datetime:
    return datetime(2026, 5, 11, 6, minute, tzinfo=UTC)


def session(line: int, **fields: object) -> Emission:
    return Emission("session", "session", occ("session", line), dict(fields), ("s1",))


def call(line: int, **fields: object) -> Emission:
    return Emission("model_call", "model_call", occ("model_call", line), dict(fields))


def tool(line: int, index: int = 0, **fields: object) -> Emission:
    return Emission("tool_call", "tool_call", occ(f"tool_call[{index}]", line), dict(fields))


def test_sessions_merge_contributions_and_observe_bounds() -> None:
    emissions = [
        session(1, external_id="s1", agent="codex", repo=None),
        call(1, session_external_id="s1", started_at=ts(5), ended_at=ts(6)),
        tool(1, session_external_id="s1", tool_name="Bash", started_at=ts(5), ended_at=ts(9)),
        session(2, external_id="s1", agent="codex", repo="r1", started_at=ts(1)),
        call(2, session_external_id="s1", started_at=ts(2), ended_at=None),
        call(3, session_external_id="s1", started_at=None, ended_at=None),
    ]
    sessions = reduce_sessions(emissions)
    assert set(sessions) == {"s1"}
    s = sessions["s1"]
    assert s.agent == "codex" and s.repo == "r1" and s.user is None
    assert s.declared_started_at == ts(1) and s.declared_ended_at is None
    assert s.observed_start_at == ts(2) and s.observed_end_at == ts(9)
    assert s.model_call_count == 3 and s.tool_call_count == 1
    assert [c.locator for c in s.contributions] == ["line:1"] * 3 + ["line:2"] * 2 + ["line:3"]
    assert s.conflicts == ()


def test_conflicts_keep_first_value_and_are_reported() -> None:
    emissions = [
        session(1, external_id="s1", agent="codex"),
        session(2, external_id="s1", agent="claude-code"),
    ]
    s = reduce_sessions(emissions)["s1"]
    assert s.agent == "codex"
    assert [(c.code, c.field, c.occurrence.locator) for c in s.conflicts] == [
        ("conflicting_value", "agent", "line:2")
    ]


def test_children_without_session_emission_create_an_implicit_session() -> None:
    emissions = [tool(1, session_external_id="orphan", tool_name="Read")]
    s = reduce_sessions(emissions)["orphan"]
    assert s.agent is None and s.tool_call_count == 1 and s.observed_start_at is None
    assert [c.code for c in s.conflicts] == ["implicit_session"]


def test_emissions_without_identity_are_ignored() -> None:
    emissions = [
        Emission("session", "session", occ("session"), {"external_id": None}),
        call(1, session_external_id=None, started_at=ts(1)),
    ]
    assert reduce_sessions(emissions) == {}


def test_session_declared_after_its_children_is_not_implicit() -> None:
    emissions = [
        call(1, session_external_id="s1", started_at=ts(1)),
        session(1, external_id="s1", agent="codex"),
    ]
    s = reduce_sessions(emissions)["s1"]
    assert s.conflicts == () and s.model_call_count == 1 and s.agent == "codex"
