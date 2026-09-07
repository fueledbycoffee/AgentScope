import gzip
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from agentscope_app.application.dto import FileBinding, MappingRecord
from agentscope_app.application.errors import InvalidInputError, LimitExceededError, NotFoundError
from agentscope_app.application.use_cases.imports import CommitImport, PreviewImport
from agentscope_app.application.use_cases.uploads import StoreUpload
from tests.application.fakes import (
    FakeClock,
    FakeIds,
    FakeReader,
    FakeStore,
    FakeTraces,
    FakeUnitOfWork,
)

MAPPING_PATH = Path(__file__).resolve().parents[2] / "mappings" / "tracelab-v1.json"


def tracelab_row(
    session: str, round_index: int, tools: int, provider: str = "claude"
) -> dict[str, Any]:
    ts = f"2026-05-11T06:{40 + round_index:02d}:00Z"
    return {
        "provider": provider,
        "project": "project_x",
        "session_id": f"{provider}:{session}",
        "round_index": round_index,
        "round_id": f"round_{session}_{round_index}",
        "model": "claude-opus-4-6",
        "input_tokens_total": 100 + round_index,
        "prefix_tokens": 50,
        "newly_append_tokens": 50,
        "claude_uncached_input_tokens": 1,
        "claude_cache_creation_input_tokens": 2,
        "claude_cache_read_input_tokens": 3,
        "output_tokens": 10,
        "reasoning_output_tokens": None,
        "timing_events": [{"event_type": "user_message", "timestamp": ts}],
        "tools": [
            {
                "tool_index": i,
                "tool_name": "Bash",
                "tool_call_id": f"call_{session}_{round_index}_{i}",
                "emitted_at": ts,
                "result_at": ts,
                "tool_wall_latency_ms": 5,
                "tool_internal_latency_ms": None,
                "is_error": False,
                "input_chars": 1,
                "result_chars": 1,
            }
            for i in range(tools)
        ],
        "current_input_event_count": 1,
        "current_user_message_count": 1,
        "current_tool_result_count": 0,
        "current_user_message_chars": 1,
        "current_tool_result_chars": 0,
        "current_input_chars": 1,
        "first_input_event_type": "user_message",
        "user": "user_1",
        "store": ".claude",
        "trace_key": f"claude:{session}:{round_index}",
    }


ROWS = [tracelab_row("s1", 0, 2), tracelab_row("s1", 1, 1), tracelab_row("s2", 0, 0, "codex")]
JSONL = "\n".join(json.dumps(r) for r in ROWS).encode() + b"\n"
JSONL_WITH_BAD_LINE = JSONL + b"{not json\n" + json.dumps(tracelab_row("s3", 0, 1)).encode() + b"\n"


class Harness:
    def __init__(self, traces: FakeTraces | None = None) -> None:
        self.uow = FakeUnitOfWork(traces)
        self.clock = FakeClock()
        self.ids = FakeIds()
        self.store = FakeStore()
        self.reader = FakeReader()
        document = json.loads(MAPPING_PATH.read_text(encoding="utf-8"))
        self.mapping = MappingRecord(
            id="map_tracelab",
            name="tracelab-v1",
            source="tracelab",
            revision=1,
            created_by="bundled",
            input_format="jsonl",
            document=document,
            content_hash=hashlib.sha256(json.dumps(document, sort_keys=True).encode()).hexdigest(),
            created_at=datetime(2026, 9, 7, tzinfo=UTC),
        )
        self.uow.mappings.add(self.mapping)
        self.upload_uc = StoreUpload(
            self.uow.factory, self.store, self.reader, self.clock, self.ids
        )
        self.preview_uc = PreviewImport(self.uow.factory, self.store, self.reader)
        self.commit_uc = CommitImport(
            self.uow.factory, self.store, self.reader, self.clock, self.ids
        )

    def upload(self, data: bytes = JSONL, filename: str = "trace.jsonl") -> Any:
        return self.upload_uc.execute(filename, data)


def test_store_upload_reports_shape_and_preview() -> None:
    h = Harness()
    info = h.upload()
    assert info.upload_id == "upl_0001" and info.format == "jsonl"
    assert info.sha256 == hashlib.sha256(JSONL).hexdigest() and info.size_bytes == len(JSONL)
    assert info.record_count == 3 and [r.locator for r in info.preview] == [
        "line:1",
        "line:2",
        "line:3",
    ]
    assert info.preview[0].payload["session_id"] == "claude:s1"
    assert info.already_imported == ()
    assert h.uow.uploads.get("upl_0001") == info
    assert h.store.get(info.sha256) is not None


def test_store_upload_handles_gzip_and_rejects_unknown_types_and_limits() -> None:
    h = Harness()
    info = h.upload(gzip.compress(JSONL), "trace.jsonl.gz")
    assert info.format == "jsonl" and info.record_count == 3
    with pytest.raises(InvalidInputError):
        h.upload(b"a,b\n1,2\n", "trace.csv")
    small = StoreUpload(h.uow.factory, h.store, h.reader, h.clock, h.ids, max_bytes=10)
    with pytest.raises(LimitExceededError, match="25 MiB|bytes"):
        small.execute("trace.jsonl", JSONL)
    few = StoreUpload(h.uow.factory, h.store, h.reader, h.clock, h.ids, max_records=2)
    with pytest.raises(LimitExceededError, match="records"):
        few.execute("trace.jsonl", JSONL)


def test_preview_runs_mapping_on_sample_and_explains_rejects() -> None:
    h = Harness()
    info = h.upload(JSONL_WITH_BAD_LINE)
    report = h.preview_uc.execute(info.upload_id, "map_tracelab", sample=10)
    assert report.records == {
        "accepted": 4,
        "partial": 0,
        "rejected": 1,
        "ignored": 0,
        "sampled": 5,
    }
    assert report.entities == {"session": 4, "model_call": 4, "tool_call": 4}
    assert [(r.locator, r.code) for r in report.rejects] == [("line:4", "invalid_json")]
    assert report.warnings.get("null", 0) >= 1  # reasoning_output_tokens is null
    assert report.emissions[0].entity == "session" and report.emissions[0].locator == "line:1"
    with pytest.raises(NotFoundError):
        h.preview_uc.execute("upl_nope", "map_tracelab", sample=10)
    with pytest.raises(NotFoundError):
        h.preview_uc.execute(info.upload_id, "map_nope", sample=10)


def test_preview_refuses_non_executable_mapping_with_issues() -> None:
    h = Harness()
    broken = dict(h.mapping.document)
    broken = json.loads(json.dumps(broken))
    del broken["rules"][0]["fields"]["external_id"]
    h.uow.mappings.add(
        MappingRecord(
            "map_broken", "broken", "tracelab", 1, "human", "jsonl", broken, "h", datetime.now(UTC)
        )
    )
    info = h.upload()
    with pytest.raises(InvalidInputError) as caught:
        h.preview_uc.execute(info.upload_id, "map_broken", sample=10)
    assert any(d["code"] == "required_field_unmapped" for d in caught.value.details)


def test_commit_import_persists_everything_once_and_reports_counts() -> None:
    h = Harness()
    info = h.upload(JSONL_WITH_BAD_LINE)
    report = h.commit_uc.execute("tracelab", [FileBinding(info.upload_id, "map_tracelab")])
    assert report.status == "committed" and report.import_id == "imp_0002"
    assert report.records == {
        "accepted": 4,
        "partial": 0,
        "duplicate": 0,
        "rejected": 1,
        "ignored": 0,
    }
    assert report.entities == {"session": 3, "model_call": 4, "tool_call": 4}
    assert report.reject_count == 1 and report.files[0].record_count == 5
    assert report.mapping.name == "tracelab-v1" and report.finished_at is not None
    stored = h.uow.traces.stored
    assert len(stored) == 1 and set(stored[0]["sessions"]) == {"claude:s1", "codex:s2", "claude:s3"}
    assert h.uow.imports.get("imp_0002") == report
    assert [o.outcome for o in h.uow.imports.results["imp_0002"]] == ["accepted"] * 3 + [
        "rejected",
        "accepted",
    ]
    assert h.uow.imports.rejects("imp_0002", None, None, 10, 0)[0].code == "invalid_json"
    assert h.uow.commits == 2 and h.uow.rollbacks == 0  # one for the upload, one for the import


def test_reimporting_the_same_bytes_inserts_nothing() -> None:
    h = Harness()
    info = h.upload()
    first = h.commit_uc.execute("tracelab", [FileBinding(info.upload_id, "map_tracelab")])
    again = h.upload()  # same bytes, new upload id
    assert [ref.import_id for ref in again.already_imported] == [first.import_id]
    second = h.commit_uc.execute("tracelab", [FileBinding(again.upload_id, "map_tracelab")])
    assert second.status == "duplicate"
    assert second.records == {
        "accepted": 0,
        "partial": 0,
        "duplicate": 3,
        "rejected": 0,
        "ignored": 0,
    }
    assert second.entities == {}
    assert len(h.uow.traces.stored) == 1
    other_source = h.commit_uc.execute("other", [FileBinding(again.upload_id, "map_tracelab")])
    assert other_source.status == "committed"  # idempotency is scoped by source


def test_failed_commit_leaves_nothing_and_records_a_failed_report() -> None:
    h = Harness(traces=FakeTraces(fail=True))
    info = h.upload()
    report = h.commit_uc.execute("tracelab", [FileBinding(info.upload_id, "map_tracelab")])
    assert report.status == "failed" and "database exploded" in (report.error or "")
    assert report.entities == {} and h.uow.rollbacks >= 1
    assert h.uow.imports.get(report.import_id) == report
    assert h.uow.imports.find_committed(info.sha256, "tracelab") == []


def test_already_imported_covers_custom_sources() -> None:
    h = Harness()
    info = h.upload()
    report = h.commit_uc.execute("custom", [FileBinding(info.upload_id, "map_tracelab")])
    again = h.upload()
    assert [ref.import_id for ref in again.already_imported] == [report.import_id]


def test_concurrent_commit_conflict_propagates_instead_of_failing() -> None:
    from agentscope_app.application.errors import ConflictError

    h = Harness()
    info = h.upload()
    h.uow.imports.conflict_on_commit = True
    with pytest.raises(ConflictError):
        h.commit_uc.execute("tracelab", [FileBinding(info.upload_id, "map_tracelab")])
    assert h.uow.traces.stored == [] or h.uow.rollbacks >= 1
    assert h.uow.imports.find_committed(info.sha256, "tracelab") == []
