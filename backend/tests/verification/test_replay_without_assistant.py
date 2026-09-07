"""Saved mappings replay without any assistant (issue #16, ADR-005).

Every document under ``documents/`` is a final, human-reviewed mapping from the
second-source verification runs. Each is saved through the application, applied
to synthetic Parquet shaped like its SWE-chat table, and imported while a
recording assistant that raises on any call is wired in: the import must commit
with the expected outcomes and the assistant call count must stay zero.
"""

from __future__ import annotations

import io
import json
from datetime import UTC, datetime
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from agentscope_app.application.dto import (
    AssistantReply,
    FileBinding,
    PreparedContext,
    RepairRequest,
)
from agentscope_app.application.use_cases.assistant import (
    PrepareContext,
    ProfileFile,
    RunAssistant,
)
from agentscope_app.application.use_cases.imports import CommitImport, PreviewImport
from agentscope_app.application.use_cases.mappings import SaveMappingRevision
from agentscope_app.application.use_cases.uploads import StoreUpload
from agentscope_app.infrastructure.db.engine import create_engine_for, run_migrations
from agentscope_app.infrastructure.db.unit_of_work import make_uow_factory
from agentscope_app.infrastructure.files.raw_store import FilesystemRawFileStore
from agentscope_app.infrastructure.ids import UtcClock, UuidIdGenerator
from agentscope_app.infrastructure.readers.router import FormatRouter

DOCUMENTS = sorted(
    p
    for p in (Path(__file__).parent / "documents").glob("*.json")
    if not p.name.endswith(".expected.json")
)


class RaisingAssistant:
    """Any call is a test failure: the import path must never reach the assistant."""

    def __init__(self) -> None:
        self.calls = 0

    def complete(
        self, prepared: PreparedContext, *, repair: RepairRequest | None = None
    ) -> AssistantReply:
        self.calls += 1
        raise AssertionError("the assistant was called during a replay")


def sessions_table(rows: int = 3) -> bytes:
    """The SWE-chat sessions table's columns and Arrow types (synthetic values)."""
    table = pa.table(
        {
            "session_id": pa.array([f"sess-{i}" for i in range(rows)], pa.large_string()),
            "repo_id": pa.array(["repo-1"] * rows, pa.large_string()),
            "user_id": pa.array([f"user-{i}" for i in range(rows)], pa.large_string()),
            "agent": pa.array(["claude-code", "codex", "cursor"][:rows], pa.large_string()),
            "created_at": pa.array(
                [
                    int(datetime(2026, 6, 1, 12, i, tzinfo=UTC).timestamp()) * 10**9
                    for i in range(rows)
                ],
                pa.timestamp("ns", tz="UTC"),
            ),
            "checkpoints_count": pa.array([2] * rows, pa.int64()),
            "input_tokens": pa.array([1000 + i for i in range(rows)], pa.int64()),
            "output_tokens": pa.array([100] * rows, pa.int64()),
            "api_call_count": pa.array([2] * rows, pa.int64()),
            "duration_seconds": pa.array([12.5] * rows, pa.float64()),
        }
    )
    return _bytes(table)


def conversations_table() -> bytes:
    """Assistant response, thinking, tool_use / tool_result pair, user prompt, metadata."""
    roles = ["user", "assistant", "assistant", "tool_use", "tool_result", "metadata"]
    turn_types = [
        "user_prompt",
        "assistant_response",
        "assistant_thinking",
        "tool_use",
        "tool_result",
        "progress",
    ]
    n = len(roles)
    table = pa.table(
        {
            "turn_id": pa.array([f"turn-{i}" for i in range(n)], pa.large_string()),
            "session_id": pa.array(["sess-0"] * n, pa.large_string()),
            "turn_number": pa.array(list(range(n)), pa.int64()),
            "role": pa.array(roles, pa.large_string()),
            "turn_type": pa.array(turn_types, pa.large_string()),
            "is_continuation": pa.array([False] * n, pa.bool_()),
            "content": pa.array(["hello"] * n, pa.large_string()),
            "model": pa.array([None, "gpt-5.5", "gpt-5.5", None, None, None], pa.large_string()),
            "timestamp": pa.array(
                [
                    int(datetime(2026, 6, 1, 12, 0, i, tzinfo=UTC).timestamp()) * 10**6
                    for i in range(n)
                ],
                pa.timestamp("us", tz="UTC"),
            ),
            "input_tokens": pa.array([None, 10, None, None, None, None], pa.int64()),
            "output_tokens": pa.array([None, 5, 3, None, None, None], pa.int64()),
            "cache_creation_input_tokens": pa.array([None, 0, None, None, None, None], pa.int64()),
            "cache_read_input_tokens": pa.array([None, 0, None, None, None, None], pa.int64()),
            "tool_name": pa.array([None, None, None, "Bash", "Bash", None], pa.large_string()),
            "tool_call_id": pa.array(
                [None, None, None, "call_1", "call_1", None], pa.large_string()
            ),
            "category": pa.array([None, None, None, "shell", None, None], pa.large_string()),
            "agent": pa.array(["claude-code"] * n, pa.large_string()),
        }
    )
    return _bytes(table)


def _bytes(table: pa.Table) -> bytes:
    buf = io.BytesIO()
    pq.write_table(table, buf)
    return buf.getvalue()


@pytest.mark.parametrize("document_path", DOCUMENTS, ids=[p.stem for p in DOCUMENTS])
def test_saved_document_replays_without_the_assistant(document_path: Path, tmp_path: Path) -> None:
    document = json.loads(document_path.read_text(encoding="utf-8"))
    expected = json.loads(document_path.with_suffix(".expected.json").read_text(encoding="utf-8"))
    engine = create_engine_for(f"sqlite:///{tmp_path / 'db.sqlite3'}")
    run_migrations(engine)
    uow_factory = make_uow_factory(engine)
    store = FilesystemRawFileStore(tmp_path / "raw")
    reader = FormatRouter()
    clock, ids = UtcClock(), UuidIdGenerator()
    assistant = RaisingAssistant()
    # the assistant is wired exactly as the container wires it, and never reached
    profile = ProfileFile(uow_factory, store, reader)
    RunAssistant(PrepareContext(uow_factory, store, reader, profile), assistant)

    saved = SaveMappingRevision(uow_factory, clock).execute(document, created_by="user")
    data = sessions_table() if expected["table"] == "sessions" else conversations_table()
    upload = StoreUpload(uow_factory, store, reader, clock, ids).execute(
        f"{expected['table']}.parquet", data
    )
    preview = PreviewImport(uow_factory, store, reader).execute(
        upload.upload_id, saved.record.id, sample=50
    )
    assert preview.records.get("rejected", 0) == expected["rejected"], preview.rejects[:3]
    report = CommitImport(uow_factory, store, reader, clock, ids).execute(
        document["source"], [FileBinding(upload.upload_id, saved.record.id)]
    )
    assert report.status == "committed"
    assert (
        report.records.get("accepted", 0) + report.records.get("partial", 0) == expected["accepted"]
    )
    for entity, count in expected["entities"].items():
        assert report.entities.get(entity, 0) == count, (entity, report.entities)
    assert assistant.calls == 0
    # a second start of the application still finds the same revision by hash
    with make_uow_factory(engine)() as uow:
        again = uow.mappings.find_by_hash(saved.record.content_hash)
    assert again is not None and again.id == saved.record.id


def test_at_least_one_reviewed_document_is_committed() -> None:
    assert DOCUMENTS, "the verification run must commit its final documents under documents/"
