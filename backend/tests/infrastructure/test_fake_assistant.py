"""The fake adapter answers by profile shape, through the production readers and the use cases."""

from __future__ import annotations

import io
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

from agentscope_app.application.dto import AssistantRequest, MappingIdentity, Turn
from agentscope_app.application.use_cases.assistant import (
    PrepareContext,
    ProfileFile,
    RunAssistant,
)
from agentscope_app.application.use_cases.uploads import StoreUpload
from agentscope_app.domain.mapping.parser import parse_mapping
from agentscope_app.infrastructure.llm.fake import BEHAVIOURS, FakeMappingAssistant
from agentscope_app.infrastructure.llm.unavailable import UnavailableMappingAssistant
from agentscope_app.infrastructure.readers.router import FormatRouter
from tests.application.fakes import FakeClock, FakeIds, FakeStore, FakeUnitOfWork

BUNDLED = Path(__file__).resolve().parents[2] / "mappings"
FIXTURE = BUNDLED.parents[1] / "fixtures" / "tracelab" / "tracelab-sample.jsonl.gz"


def swe_sessions_parquet(rows: int = 3) -> bytes:
    """The SWE-chat sessions table's shape (columns and Arrow types), synthetic values."""
    table = pa.table(
        {
            "session_id": pa.array([f"sess-{i}" for i in range(rows)], pa.large_string()),
            "repo_id": pa.array(["repo-1"] * rows, pa.large_string()),
            "user_id": pa.array([f"user-{i}" for i in range(rows)], pa.large_string()),
            "agent": pa.array(["claude-code", "codex", "cursor"][:rows], pa.large_string()),
            "created_at": pa.array(
                [
                    int(datetime(2026, 6, 1, 12, i, tzinfo=UTC).timestamp()) * 10**9 + 123
                    for i in range(rows)
                ],
                pa.timestamp("ns", tz="UTC"),
            ),
            "checkpoints_count": pa.array([2] * rows, pa.int64()),
            "input_tokens": pa.array([1000 + i for i in range(rows)], pa.int64()),
            "output_tokens": pa.array([100] * rows, pa.int64()),
            "duration_seconds": pa.array([12.5] * rows, pa.float64()),
        }
    )
    return _bytes(table)


def swe_conversations_parquet(rows: int = 4) -> bytes:
    roles = ["user", "assistant", "tool_use", "tool_result"]
    table = pa.table(
        {
            "turn_id": pa.array([f"turn-{i}" for i in range(rows)], pa.large_string()),
            "session_id": pa.array(["sess-0"] * rows, pa.large_string()),
            "turn_number": pa.array(list(range(rows)), pa.int64()),
            "role": pa.array(roles[:rows], pa.large_string()),
            "content": pa.array(["hello"] * rows, pa.large_string()),
            "model": pa.array([None, "gpt-5.5", None, None][:rows], pa.large_string()),
            "timestamp": pa.array(
                [
                    int(datetime(2026, 6, 1, 12, 0, i, tzinfo=UTC).timestamp()) * 10**6
                    for i in range(rows)
                ],
                pa.timestamp("us", tz="UTC"),
            ),
            "input_tokens": pa.array([None, 10, None, None][:rows], pa.int64()),
            "output_tokens": pa.array([None, 5, None, None][:rows], pa.int64()),
            "cache_creation_input_tokens": pa.array([None, 0, None, 0][:rows], pa.int64()),
            "cache_read_input_tokens": pa.array([None, 0, None, 0][:rows], pa.int64()),
            "tool_name": pa.array([None, None, "Bash", "Bash"][:rows], pa.large_string()),
            "tool_call_id": pa.array([None, None, "call_1", "call_1"][:rows], pa.large_string()),
            "agent": pa.array(["claude-code"] * rows, pa.large_string()),
        }
    )
    return _bytes(table)


def _bytes(table: pa.Table) -> bytes:
    buf = io.BytesIO()
    pq.write_table(table, buf)
    return buf.getvalue()


class Harness:
    def __init__(self, script: list[str] | None = None) -> None:
        self.uow = FakeUnitOfWork()
        self.store = FakeStore()
        reader = FormatRouter()
        self.store_upload = StoreUpload(
            self.uow.factory, self.store, reader, FakeClock(), FakeIds()
        )
        profile = ProfileFile(self.uow.factory, self.store, reader)
        self.prepare = PrepareContext(self.uow.factory, self.store, reader, profile)
        self.assistant = FakeMappingAssistant(BUNDLED, script or [])
        self.run = RunAssistant(self.prepare, self.assistant)

    def propose(self, filename: str, data: bytes, **kw: Any) -> Any:
        upload_id = self.store_upload.execute(filename, data).upload_id
        request = AssistantRequest(
            kw.pop("kind", "propose"), upload_id, MappingIdentity("draft", "swe-chat"), **kw
        )
        prepared = self.prepare.execute(request)
        return self.run.execute(request, prepared.sha256), prepared, upload_id


def test_tracelab_shape_gets_the_bundled_mapping_under_the_requested_identity() -> None:
    outcome, prepared, _ = Harness().propose("tracelab.jsonl.gz", FIXTURE.read_bytes())
    assert outcome.proposal is not None and outcome.proposal.executable
    assert outcome.proposal.mapping["name"] == "draft"
    assert outcome.proposal.mapping["rules"][0]["fields"]["external_id"]["path"] == "$.session_id"
    assert prepared.document["upload"]["format"] == "jsonl"


def test_swe_sessions_shape_addresses_the_timestamp_wrapper_through_iso() -> None:
    outcome, prepared, _ = Harness().propose("sessions.parquet", swe_sessions_parquet())
    fields = {f["path"]: f for f in prepared.document["profile"]["fields"]}
    created = fields["$.created_at"]
    assert created["types"] == {"arrow:timestamp": 3}
    assert created["wrapper"]["units"] == {"ns": 3} and created["wrapper"]["tz"] == {"UTC": 3}
    assert created["wrapper"]["accessors"] == ["$.created_at.iso", "$.created_at.value"]
    assert "$.created_at.iso" not in fields  # children are not observations
    assert outcome.proposal is not None and outcome.proposal.executable
    started = outcome.proposal.mapping["rules"][0]["fields"]["started_at"]
    assert started == {"path": "$.created_at.iso", "timestamp_format": "iso8601"}
    assert [a.target for a in outcome.proposal.ambiguities] == ["model_call.input_tokens"]
    assert outcome.proposal.questions


def test_swe_conversations_shape_gets_calls_and_tools_with_unresolved_semantics() -> None:
    outcome, prepared, _ = Harness().propose("conversations.parquet", swe_conversations_parquet())
    fields = {f["path"]: f for f in prepared.document["profile"]["fields"]}
    assert fields["$.timestamp"]["wrapper"]["units"] == {"us": 4}
    assert fields["$.tool_name"]["nulls"] == 2 and fields["$.tool_name"]["values"] == 4
    assert outcome.proposal is not None and outcome.proposal.executable
    entities = [r["entity"] for r in outcome.proposal.mapping["rules"]]
    assert entities == ["session", "model_call", "tool_call"]
    assert outcome.proposal.mapping["rules"][1]["fields"]["started_at"]["path"] == "$.timestamp.iso"
    assert [a.target for a in outcome.proposal.ambiguities] == ["model_call.token_semantics"]


def test_epoch_ambiguity_is_settled_by_a_revise_message() -> None:
    rows = "\n".join(
        f'{{"session": "s{i % 2}", "id": "c{i}", "ts": {1_757_000_000 + i}}}' for i in range(30)
    ).encode()
    h = Harness()
    first, prepared, upload_id = h.propose("epoch.jsonl", rows)
    assert first.proposal is not None and first.proposal.executable
    assert [a.options for a in first.proposal.ambiguities] == [("epoch_s", "epoch_ms")]
    fields = {f["path"]: f for f in prepared.document["profile"]["fields"]}
    assert fields["$.ts"]["hints"] == ["epoch_seconds"]  # the evidence was there
    revise = AssistantRequest(
        "revise",
        upload_id,
        MappingIdentity("draft", "swe-chat"),
        current_mapping=first.proposal.mapping,
        message="treat ts as epoch seconds",
        history=(Turn("assistant", "is ts seconds or milliseconds?"),),
    )
    second = h.run.execute(revise, h.prepare.execute(revise).sha256)
    assert second.proposal is not None and second.proposal.executable
    started = second.proposal.mapping["rules"][1]["fields"]["started_at"]
    assert started["timestamp_format"] == "epoch_s"
    assert second.proposal.ambiguities == ()


def test_unknown_shape_gets_a_session_only_draft_and_questions() -> None:
    rows = "\n".join(f'{{"sid": "{c}", "n": {i}}}' for i, c in enumerate("abcde")).encode()
    outcome, _, _ = Harness().propose("other.jsonl", rows)
    assert outcome.proposal is not None and outcome.proposal.executable
    assert outcome.proposal.mapping["rules"][0]["fields"]["external_id"]["path"] == "$.sid"
    assert len(outcome.proposal.questions) == 3


def test_every_scripted_behaviour_is_known_and_the_valid_drafts_all_parse() -> None:
    assert set(BEHAVIOURS) == {
        "valid",
        "length",
        "refusal",
        "malformed",
        "envelope",
        "invalid",
        "timeout",
        "provider",
    }
    for filename, data in (
        ("sessions.parquet", swe_sessions_parquet()),
        ("conversations.parquet", swe_conversations_parquet()),
        ("tracelab.jsonl.gz", FIXTURE.read_bytes()),
    ):
        outcome, _, _ = Harness().propose(filename, data)
        assert outcome.proposal is not None
        assert parse_mapping(outcome.proposal.mapping).is_executable, filename


def test_unavailable_adapter_names_the_provider_and_the_fix() -> None:
    import pytest

    from agentscope_app.application.errors import AssistantError

    with pytest.raises(AssistantError) as caught:
        UnavailableMappingAssistant("openai_compatible").complete(None)  # type: ignore[arg-type]
    assert caught.value.kind == "unavailable"
    assert "openai_compatible" in caught.value.message and "fake" in caught.value.message


def test_swe_conversations_draft_runs_clean_on_the_synthetic_rows() -> None:
    from agentscope_app.domain.mapping.interpreter import apply_mapping

    h = Harness()
    outcome, _, upload_id = h.propose("conversations.parquet", swe_conversations_parquet())
    assert outcome.proposal is not None
    spec = parse_mapping(outcome.proposal.mapping).spec
    assert spec is not None
    info = h.uow.uploads.get(upload_id)
    assert info is not None
    rejects: list[Any] = []
    entities: list[str] = []
    with h.store.open(info.sha256) as stream:
        for record in FormatRouter().read(stream, "parquet"):
            result = apply_mapping(
                spec, record.payload, file_sha256=info.sha256, locator=record.locator
            )
            rejects.extend(result.rejects)
            entities.extend(e.entity for e in result.emissions)
    assert rejects == []
    assert entities.count("model_call") == 1 and entities.count("tool_call") == 1
