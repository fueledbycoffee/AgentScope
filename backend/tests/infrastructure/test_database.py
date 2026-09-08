"""Persistence: migrations, constraints, repositories and the unit of work on SQLite."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

from agentscope_app.application.dto import FileBinding, ImportReport, MappingRecord, MappingRef
from agentscope_app.application.metric_queries import TraceScope
from agentscope_app.application.use_cases.imports import CommitImport, PreviewImport
from agentscope_app.application.use_cases.queries import GetSession, ListSessions, MetricsSummary
from agentscope_app.application.use_cases.uploads import StoreUpload
from agentscope_app.domain.identity import SourceOccurrence
from agentscope_app.domain.mapping.interpreter import Emission
from agentscope_app.domain.reducer import reduce_sessions
from agentscope_app.infrastructure.db.engine import create_engine_for, run_migrations
from agentscope_app.infrastructure.db.unit_of_work import make_uow_factory
from agentscope_app.infrastructure.files.raw_store import FilesystemRawFileStore
from agentscope_app.infrastructure.ids import UtcClock, UuidIdGenerator
from agentscope_app.infrastructure.readers.jsonl import JsonlRecordReader

BACKEND = Path(__file__).resolve().parents[2]
FIXTURE = BACKEND.parent / "fixtures" / "tracelab" / "tracelab-sample.jsonl.gz"
MAPPING_PATH = BACKEND / "mappings" / "tracelab-v1.json"

EXPECTED_TABLES = {
    "sources",
    "raw_files",
    "uploads",
    "mappings",
    "imports",
    "import_files",
    "raw_records",
    "record_results",
    "rejects",
    "sessions",
    "model_calls",
    "tool_calls",
    "entity_contributions",
    "session_diagnostics",
}


@pytest.fixture
def engine(tmp_path: Path) -> Any:
    engine = create_engine_for(f"sqlite:///{tmp_path / 'test.sqlite3'}")
    run_migrations(engine)
    return engine


def mapping_record() -> MappingRecord:
    document = json.loads(MAPPING_PATH.read_text(encoding="utf-8"))
    return MappingRecord(
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


def test_migration_from_empty_creates_the_schema_with_foreign_keys(engine: Any) -> None:
    assert set(inspect(engine).get_table_names()) >= EXPECTED_TABLES
    with engine.connect() as conn:
        assert conn.execute(text("PRAGMA foreign_keys")).scalar() == 1
        with pytest.raises(IntegrityError):
            conn.execute(
                text(
                    "INSERT INTO import_files (id, import_id, sha256, filename, size_bytes, format,"
                    " record_count) VALUES ('f1', 'missing-import', 'x', 'a', 1, 'jsonl', 1)"
                )
            )
    run_migrations(engine)  # idempotent


def test_mapping_and_upload_repositories_round_trip(engine: Any, tmp_path: Path) -> None:
    uow_factory = make_uow_factory(engine)
    record = mapping_record()
    with uow_factory() as uow:
        uow.mappings.add(record)
        uow.commit()
    with uow_factory() as uow:
        assert uow.mappings.get("map_tracelab") == record
        assert uow.mappings.find_by_hash(record.content_hash) == record
        assert [m.name for m in uow.mappings.list()] == ["tracelab-v1"]
        assert uow.mappings.get("nope") is None
    store = FilesystemRawFileStore(tmp_path / "raw")
    upload = StoreUpload(uow_factory, store, JsonlRecordReader(), UtcClock(), UuidIdGenerator())
    info = upload.execute("t.jsonl", b'{"session_id": "s", "provider": "claude"}\n')
    with uow_factory() as uow:
        assert uow.uploads.get(info.upload_id) == info
        assert uow.uploads.get("nope") is None


def test_trace_repository_enforces_occurrence_uniqueness_per_source(engine: Any) -> None:
    uow_factory = make_uow_factory(engine)
    occ = SourceOccurrence("f" * 64, "line:1", "model_call")
    emissions = [
        Emission(
            "session",
            "session",
            SourceOccurrence("f" * 64, "line:1", "session"),
            {"external_id": "s"},
            ("s",),
        ),
        Emission("model_call", "model_call", occ, {"session_external_id": "s", "model": "m"}, None),
    ]
    with uow_factory() as uow:
        uow.mappings.add(mapping_record())
        uow.commit()
    with uow_factory() as uow:
        uow.imports.add_report(_report("imp_1", "tracelab"))
        counts = uow.traces.store(
            import_id="imp_1",
            source="tracelab",
            bindings={"f" * 64: "map_tracelab"},
            emissions=emissions,
            sessions=reduce_sessions(emissions),
        )
        uow.commit()
    assert counts.entity_counts == {"session": 1, "model_call": 1}
    from agentscope_app.application.errors import ConflictError

    with uow_factory() as uow:
        uow.imports.add_report(_report("imp_2", "tracelab"))
        with pytest.raises(ConflictError):
            uow.traces.store(
                import_id="imp_2",
                source="tracelab",
                bindings={"f" * 64: "map_tracelab"},
                emissions=emissions,
                sessions=reduce_sessions(emissions),
            )
            uow.commit()
        uow.rollback()
    with uow_factory() as uow:  # same occurrence under another source is a different observation
        uow.imports.add_report(_report("imp_3", "other"))
        counts = uow.traces.store(
            import_id="imp_3",
            source="other",
            bindings={"f" * 64: "map_tracelab"},
            emissions=emissions,
            sessions=reduce_sessions(emissions),
        )
        uow.commit()
    assert counts.entity_counts == {"session": 1, "model_call": 1}


def _report(import_id: str, source: str) -> ImportReport:
    return ImportReport(
        import_id=import_id,
        status="committed",
        source=source,
        mapping=MappingRef("map_tracelab", "tracelab-v1", 1),
        started_at=datetime(2026, 9, 7, tzinfo=UTC),
        finished_at=datetime(2026, 9, 7, tzinfo=UTC),
        files=(),
        records={"accepted": 0, "partial": 0, "duplicate": 0, "rejected": 0, "ignored": 0},
        entities={},
        warnings={},
        reject_count=0,
    )


def test_end_to_end_commit_over_the_fixture_then_reimport(engine: Any, tmp_path: Path) -> None:
    uow_factory = make_uow_factory(engine)
    with uow_factory() as uow:
        uow.mappings.add(mapping_record())
        uow.commit()
    store = FilesystemRawFileStore(tmp_path / "raw")
    reader = JsonlRecordReader()
    clock, ids = UtcClock(), UuidIdGenerator()
    info = StoreUpload(uow_factory, store, reader, clock, ids).execute(
        "tracelab.jsonl.gz", FIXTURE.read_bytes()
    )
    assert info.record_count == 4770 and info.already_imported == ()

    preview = PreviewImport(uow_factory, store, reader).execute(info.upload_id, "map_tracelab", 100)
    assert preview.records["sampled"] == 100 and preview.records["accepted"] == 100

    report = CommitImport(uow_factory, store, reader, clock, ids).execute(
        "tracelab", [FileBinding(info.upload_id, "map_tracelab")]
    )
    assert report.status == "committed", report.error
    assert report.records == {
        "accepted": 4770,
        "partial": 0,
        "duplicate": 0,
        "rejected": 0,
        "ignored": 0,
    }
    assert report.entities == {"session": 80, "model_call": 4770, "tool_call": 5723}
    assert report.reject_count == 0

    with uow_factory() as uow:
        assert uow.imports.get(report.import_id) == report
        assert [r.import_id for r in uow.imports.list(10, 0)] == [report.import_id]
        assert uow.imports.rejects(report.import_id, None, None, None, 10, 0) == []
        assert uow.traces.raw_record(info.sha256, "line:1")["provider"] in ("claude", "codex")

    sessions = ListSessions(uow_factory).execute(
        scope=TraceScope(source="tracelab"), limit=100, offset=0
    )
    assert len(sessions) == 80 and {s.agent for s in sessions} == {"claude-code", "codex"}
    assert sum(s.model_call_count for s in sessions) == 4770
    biggest = max(sessions, key=lambda s: s.tool_call_count)
    detail = GetSession(uow_factory).execute(biggest.id)
    assert detail.summary.id == biggest.id and len(detail.tool_calls) == biggest.tool_call_count
    assert len(detail.model_calls) == biggest.model_call_count
    assert all(t.model_call_id is not None for t in detail.tool_calls)
    assert detail.model_calls[0].raw_record.file_sha256 == info.sha256
    assert detail.summary.input_tokens.coverage is not None
    assert detail.summary.input_tokens.coverage.known == biggest.model_call_count

    metrics = MetricsSummary(uow_factory).execute(source="tracelab", agent=None)
    assert metrics.sessions.value == 80 and metrics.model_calls.value == 4770
    assert metrics.tool_calls.value == 5723
    assert metrics.input_tokens.value is not None and metrics.input_tokens.coverage is not None
    assert metrics.input_tokens.coverage.total == 4770
    assert set(metrics.input_tokens.by_semantics) == {"tracelab-claude", "tracelab-codex"}
    assert sum(metrics.input_tokens.by_semantics.values()) == metrics.input_tokens.value
    assert metrics.input_tokens.comparability == "mixed"
    assert metrics.input_tokens.value_text is None
    assert metrics.input_tokens.recorded_sum_text == str(metrics.input_tokens.value)
    assert {p.semantics for p in metrics.input_tokens.semantics_partitions} == {
        "tracelab-claude",
        "tracelab-codex",
    }
    empty = MetricsSummary(uow_factory).execute(source="nothing", agent=None)
    assert empty.sessions.value == 0 and empty.input_tokens.value is None

    again = StoreUpload(uow_factory, store, reader, clock, ids).execute(
        "copy.jsonl.gz", FIXTURE.read_bytes()
    )
    assert [r.import_id for r in again.already_imported] == [report.import_id]
    second = CommitImport(uow_factory, store, reader, clock, ids).execute(
        "tracelab", [FileBinding(again.upload_id, "map_tracelab")]
    )
    assert second.status == "duplicate" and second.records["duplicate"] == 4770
    after = MetricsSummary(uow_factory).execute(source="tracelab", agent=None)
    assert after.model_calls.value == 4770 and after.sessions.value == 80  # nothing doubled
    with uow_factory() as uow:
        assert [r.status for r in uow.imports.list(10, 0)] == ["duplicate", "committed"]


def _pipeline(engine: Any, tmp_path: Path) -> tuple[Any, Any, Any, Any, Any]:
    uow_factory = make_uow_factory(engine)
    with uow_factory() as uow:
        uow.mappings.add(mapping_record())
        uow.commit()
    store = FilesystemRawFileStore(tmp_path / "raw")
    reader = JsonlRecordReader()
    clock, ids = UtcClock(), UuidIdGenerator()
    return (
        uow_factory,
        StoreUpload(uow_factory, store, reader, clock, ids),
        CommitImport(uow_factory, store, reader, clock, ids),
        store,
        reader,
    )


def _tracelab_line(session: str, extra: str = "") -> bytes:
    return (
        f'{{"provider": "claude", "session_id": "claude:{session}", "round_index": 0, "model": "m",'
        f' "input_tokens_total": 10, "output_tokens": 1, "timing_events": [{{"timestamp":'
        f' "2026-05-11T06:40:00Z"}}], "tools": [], "user": "u",'
        f' "trace_key": "k-{session}"{extra}}}\n'
    ).encode()


def test_decimal_payloads_round_trip_through_json_columns(engine: Any, tmp_path: Path) -> None:
    uow_factory, upload, commit, _, _ = _pipeline(engine, tmp_path)
    lines = b"".join(_tracelab_line(f"s{i}") for i in range(25))  # past the 20-record preview
    lines += _tracelab_line("s25", ', "extra": 1.00000000000000001, "big": 9007199254740993')
    info = upload.execute("dec.jsonl", lines)
    report = commit.execute("tracelab", [FileBinding(info.upload_id, "map_tracelab")])
    assert report.status == "committed", report.error
    with uow_factory() as uow:
        payload = uow.traces.raw_record(info.sha256, "line:26")
    from decimal import Decimal

    assert payload["extra"] == Decimal("1.00000000000000001") and payload["big"] == 9007199254740993


def test_committed_uniqueness_is_a_database_guarantee(engine: Any) -> None:
    uow_factory = make_uow_factory(engine)
    with uow_factory() as uow:
        uow.mappings.add(mapping_record())
        uow.commit()
    from dataclasses import replace

    from agentscope_app.application.dto import FileInfo
    from agentscope_app.application.errors import ConflictError

    file_info = FileInfo("a.jsonl", "a" * 64, 1, "jsonl", 1)
    first = replace(_report("imp_a", "tracelab"), files=(file_info,))
    pending = replace(file_info, status="pending")
    second = replace(_report("imp_b", "tracelab"), files=(pending,), status="running")
    with uow_factory() as uow:
        uow.imports.add_report(first)
        uow.commit()
    with uow_factory() as uow:
        uow.imports.add_report(second)  # pending file rows never claim the bytes
        committed_files = (replace(file_info, status="committed"),)
        with pytest.raises(ConflictError):
            uow.imports.update_report(replace(second, status="committed", files=committed_files))
        uow.rollback()
    with uow_factory() as uow:  # nor does inserting a row that claims them outright
        with pytest.raises(ConflictError):
            uow.imports.add_report(replace(_report("imp_b2", "tracelab"), files=(file_info,)))
        uow.rollback()
    with uow_factory() as uow:  # a different source is fine
        other = replace(_report("imp_c", "other"), files=(file_info,))
        uow.imports.add_report(other)
        uow.commit()
        assert [r.import_id for r in uow.imports.find_committed_any("a" * 64)] == ["imp_a", "imp_c"]


def test_results_insert_in_bounded_batches_at_the_record_cap(engine: Any) -> None:
    uow_factory = make_uow_factory(engine)
    from dataclasses import replace

    from agentscope_app.application.dto import FileInfo, RecordOutcome

    with uow_factory() as uow:
        uow.mappings.add(mapping_record())
        uow.commit()
    outcomes = [
        RecordOutcome(f"line:{i}", "accepted", {"session": 1}, {}, {"i": i}, file_sha256="b" * 64)
        for i in range(1, 100_001)
    ]
    with uow_factory() as uow:
        uow.imports.add_report(
            replace(
                _report("imp_big", "tracelab"),
                files=(FileInfo("b", "b" * 64, 1, "jsonl", 100_000),),
            )
        )
        uow.imports.add_results("imp_big", outcomes, [])
        uow.commit()
    with uow_factory() as uow:
        assert uow.traces.raw_record("b" * 64, "line:100000") == {"i": 100000}


def test_cross_file_session_merge_keeps_reducer_rules(engine: Any) -> None:
    uow_factory = make_uow_factory(engine)
    with uow_factory() as uow:
        uow.mappings.add(mapping_record())
        uow.commit()
    from datetime import datetime as dt

    def session_emission(line: int, **fields: Any) -> Emission:
        return Emission(
            "session",
            "session",
            SourceOccurrence("f" * 64, f"line:{line}", "session"),
            {"external_id": "s", **fields},
            ("s",),
        )

    noon = dt(2026, 1, 1, 12, tzinfo=UTC)
    ten = dt(2026, 1, 1, 10, tzinfo=UTC)
    with uow_factory() as uow:
        uow.imports.add_report(_report("imp_1", "tracelab"))
        e = [session_emission(1, repo="repo-a", started_at=noon)]
        uow.traces.store(
            import_id="imp_1",
            source="tracelab",
            bindings={"f" * 64: "map_tracelab"},
            emissions=e,
            sessions=reduce_sessions(e),
        )
        uow.commit()
    with uow_factory() as uow:
        uow.imports.add_report(_report("imp_2", "tracelab"))
        e = [session_emission(1, repo="repo-b", ended_at=ten)]
        seeds = uow.traces.existing_sessions("tracelab", ["s"])
        uow.traces.store(
            import_id="imp_2",
            source="tracelab",
            bindings={"f" * 64: "map_tracelab", "g" * 64: "map_tracelab"},
            emissions=e,
            sessions=reduce_sessions(e, seeds),
        )
        uow.commit()
    sessions = ListSessions(uow_factory).execute(
        scope=TraceScope(source="tracelab"), limit=10, offset=0
    )
    detail = GetSession(uow_factory).execute(sessions[0].id)
    assert detail.repo == "repo-a" and detail.declared_started_at == noon
    assert detail.declared_ended_at is None
    assert sorted((d.code, d.field) for d in detail.diagnostics) == [
        ("conflicting_value", "repo"),
        ("reversed_interval", "ended_at"),
    ]


def test_cross_file_reduction_keeps_valid_timestamps_via_seeds(engine: Any) -> None:
    uow_factory = make_uow_factory(engine)
    with uow_factory() as uow:
        uow.mappings.add(mapping_record())
        uow.commit()
    from datetime import datetime as dt

    def emission(sha: str, line: int, **fields: Any) -> Emission:
        occ = SourceOccurrence(sha * 64, f"line:{line}", "session")
        return Emission("session", "session", occ, {"external_id": "s", **fields}, ("s",))

    t = lambda h: dt(2026, 1, 1, h, tzinfo=UTC)  # noqa: E731
    with uow_factory() as uow:
        uow.imports.add_report(_report("imp_1", "tracelab"))
        e = [emission("f", 1, started_at=t(12))]
        uow.traces.store(
            import_id="imp_1",
            source="tracelab",
            bindings={"f" * 64: "map_tracelab"},
            emissions=e,
            sessions=reduce_sessions(e),
        )
        uow.commit()
    with uow_factory() as uow:
        uow.imports.add_report(_report("imp_2", "tracelab"))
        e = [emission("g", 1, started_at=t(14)), emission("g", 2, ended_at=t(13))]
        seeds = uow.traces.existing_sessions("tracelab", ["s"])
        assert seeds["s"].declared_started_at == t(12)
        uow.traces.store(
            import_id="imp_2",
            source="tracelab",
            bindings={"g" * 64: "map_tracelab"},
            emissions=e,
            sessions=reduce_sessions(e, seeds),
        )
        uow.commit()
    sessions = ListSessions(uow_factory).execute(
        scope=TraceScope(source="tracelab"), limit=10, offset=0
    )
    detail = GetSession(uow_factory).execute(sessions[0].id)
    assert (detail.declared_started_at, detail.declared_ended_at) == (t(12), t(13))
    assert [d.code for d in detail.diagnostics] == ["conflicting_value"]
