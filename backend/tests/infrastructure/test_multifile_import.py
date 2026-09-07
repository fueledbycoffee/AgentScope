"""Multi-file import attempts against real SQLite: per-file bindings and statuses,
record identity per file, grouping by bytes, rollback and race audits, and the
0003 migration on a populated 0002 database."""

from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from sqlalchemy import text

from agentscope_app.application.dto import FileBinding, ImportReport, RecordOutcome, RejectRow
from agentscope_app.application.errors import ConflictError, InvalidInputError, LimitExceededError
from agentscope_app.application.use_cases import imports as imports_module
from agentscope_app.application.use_cases.imports import CommitImport
from agentscope_app.application.use_cases.uploads import StoreUpload
from agentscope_app.infrastructure.db.engine import (
    alembic_config,
    create_engine_for,
    run_migrations,
)
from agentscope_app.infrastructure.db.unit_of_work import make_uow_factory
from agentscope_app.infrastructure.files.raw_store import FilesystemRawFileStore
from agentscope_app.infrastructure.ids import UtcClock, UuidIdGenerator
from agentscope_app.infrastructure.readers.router import FormatRouter
from tests.infrastructure.test_database import _tracelab_line, mapping_record
from tests.parquet_support import parquet_file, parquet_mapping_record, parquet_rows


@dataclass
class Env:
    engine: Any
    uow_factory: Any
    upload: StoreUpload
    commit: CommitImport
    tmp_path: Path

    def commit_with(self, uow_factory: Any) -> CommitImport:
        store = FilesystemRawFileStore(self.tmp_path / "raw")
        return CommitImport(uow_factory, store, FormatRouter(), UtcClock(), UuidIdGenerator())

    def sql(self, query: str, **params: Any) -> list[tuple[Any, ...]]:
        with self.engine.connect() as connection:
            return [tuple(r) for r in connection.execute(text(query), params)]


@pytest.fixture
def env(tmp_path: Path) -> Env:
    engine = create_engine_for(f"sqlite:///{tmp_path / 'db.sqlite3'}")
    run_migrations(engine)
    uow_factory = make_uow_factory(engine)
    with uow_factory() as uow:
        uow.mappings.add(mapping_record())
        uow.mappings.add(
            replace(
                mapping_record(),
                id="map_tracelab_copy",
                name="tracelab-v1-copy",
                content_hash="c" * 64,
            )
        )
        uow.mappings.add(parquet_mapping_record())
        uow.commit()
    store = FilesystemRawFileStore(tmp_path / "raw")
    clock, ids = UtcClock(), UuidIdGenerator()
    return Env(
        engine,
        uow_factory,
        StoreUpload(uow_factory, store, FormatRouter(), clock, ids),
        CommitImport(uow_factory, store, FormatRouter(), clock, ids),
        tmp_path,
    )


def jsonl(*sessions: str) -> bytes:
    return b"".join(_tracelab_line(s) for s in sessions)


def by_sha(report: ImportReport) -> dict[str, Any]:
    return {f.sha256: f for f in report.files}


def test_mixed_batch_commits_each_file_under_its_own_mapping(env: Env) -> None:
    a = env.upload.execute("a.jsonl", jsonl("s1", "s2", "s3"))
    b = env.upload.execute("b.parquet", parquet_file(parquet_rows("p", 2)))
    report = env.commit.execute(
        "tracelab",
        [FileBinding(a.upload_id, "map_tracelab"), FileBinding(b.upload_id, "map_parquet")],
    )
    assert report.status == "committed", report.error
    files = by_sha(report)
    assert files[a.sha256].status == "committed" and files[a.sha256].mapping.id == "map_tracelab"
    assert files[b.sha256].status == "committed" and files[b.sha256].mapping.id == "map_parquet"
    assert files[a.sha256].records["accepted"] == 3 and files[b.sha256].records["accepted"] == 2
    assert report.records["accepted"] == 5 and report.reject_count == 0
    assert report.entities == {"session": 4, "model_call": 5, "tool_call": 2}
    # every contribution carries the mapping of its own file
    rows = env.sql(
        "SELECT file_sha256, mapping_id, COUNT(*) FROM entity_contributions "
        "GROUP BY file_sha256, mapping_id ORDER BY file_sha256"
    )
    assert sorted(rows) == sorted([(a.sha256, "map_tracelab", 6), (b.sha256, "map_parquet", 6)])
    # the duration wrapper converted exactly and the timestamp wrapper parsed
    assert env.sql("SELECT wall_latency_ms FROM tool_calls ORDER BY wall_latency_ms") == [
        (1500,),
        (1501,),
    ]
    assert env.sql("SELECT COUNT(*) FROM model_calls WHERE started_at IS NOT NULL") == [(5,)]
    with env.uow_factory() as uow:
        payload = uow.traces.raw_record(b.sha256, "row:0")
        assert payload["ts"]["iso"] == "2026-06-01T12:00:00.000000000Z"
        assert str(payload["tools"][0]["latency"]["seconds"]) == "1.500"
        assert uow.imports.get(report.import_id) == report  # GET reconstructs the same shape
    # a later batch: the same JSONL bytes are a duplicate, a new Parquet file commits
    c = env.upload.execute("c.parquet", parquet_file(parquet_rows("q", 1)))
    again = env.upload.execute("a-again.jsonl", jsonl("s1", "s2", "s3"))
    second = env.commit.execute(
        "tracelab",
        [FileBinding(again.upload_id, "map_tracelab"), FileBinding(c.upload_id, "map_parquet")],
    )
    assert second.status == "committed"
    assert by_sha(second)[a.sha256].status == "duplicate"
    assert by_sha(second)[a.sha256].records == {
        "accepted": 0,
        "partial": 0,
        "duplicate": 3,
        "rejected": 0,
        "ignored": 0,
    }
    assert by_sha(second)[c.sha256].status == "committed"
    assert second.records["duplicate"] == 3 and second.records["accepted"] == 1
    assert second.entities == {"session": 1, "model_call": 1, "tool_call": 1}
    assert env.sql("SELECT COUNT(*) FROM model_calls") == [(6,)]


def test_two_files_sharing_locators_keep_distinct_records(env: Env) -> None:
    a = env.upload.execute("a.jsonl", jsonl("x1"))
    b = env.upload.execute("b.jsonl", jsonl("y1"))
    report = env.commit.execute(
        "tracelab",
        [FileBinding(a.upload_id, "map_tracelab"), FileBinding(b.upload_id, "map_tracelab")],
    )
    assert report.status == "committed", report.error
    rows = env.sql(
        "SELECT file_sha256, locator, outcome FROM record_results WHERE import_id = :i ORDER BY 1",
        i=report.import_id,
    )
    assert rows == sorted([(a.sha256, "line:1", "accepted"), (b.sha256, "line:1", "accepted")])
    with env.uow_factory() as uow:
        assert uow.traces.raw_record(a.sha256, "line:1")["session_id"] == "claude:x1"
        assert uow.traces.raw_record(b.sha256, "line:1")["session_id"] == "claude:y1"


def test_same_bytes_twice_in_one_batch(env: Env) -> None:
    a = env.upload.execute("a.jsonl", jsonl("z1"))
    b = env.upload.execute("copy.jsonl", jsonl("z1"))
    assert a.sha256 == b.sha256 and a.upload_id != b.upload_id
    with pytest.raises(InvalidInputError, match="two different mappings"):
        env.commit.execute(
            "tracelab",
            [
                FileBinding(a.upload_id, "map_tracelab"),
                FileBinding(b.upload_id, "map_tracelab_copy"),
            ],
        )
    report = env.commit.execute(
        "tracelab",
        [FileBinding(a.upload_id, "map_tracelab"), FileBinding(b.upload_id, "map_tracelab")],
    )
    assert report.status == "committed" and len(report.files) == 1
    assert report.records["accepted"] == 1 and report.entities == {"session": 1, "model_call": 1}


def test_bytes_committed_under_another_source_are_importable(env: Env) -> None:
    a = env.upload.execute("a.jsonl", jsonl("w1"))
    assert (
        env.commit.execute("tracelab", [FileBinding(a.upload_id, "map_tracelab")]).status
        == "committed"
    )
    other = env.commit.execute("other", [FileBinding(a.upload_id, "map_tracelab")])
    assert other.status == "committed" and other.entities == {"session": 1, "model_call": 1}
    duplicate = env.commit.execute("tracelab", [FileBinding(a.upload_id, "map_tracelab")])
    assert duplicate.status == "duplicate" and duplicate.entities == {}
    with env.uow_factory() as uow:
        assert len(uow.imports.list(10, 0)) == 3  # the duplicate attempt stays in the ledger
        assert uow.imports.get(duplicate.import_id) is not None
        assert by_sha(uow.imports.get(duplicate.import_id))[a.sha256].status == "duplicate"


def test_validation_and_limits(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    p = env.upload.execute("p.parquet", parquet_file(parquet_rows("v", 1)))
    with pytest.raises(InvalidInputError, match="reads jsonl"):
        env.commit.execute("tracelab", [FileBinding(p.upload_id, "map_tracelab")])
    with pytest.raises(InvalidInputError, match="at least one file"):
        env.commit.execute("tracelab", [])
    a = env.upload.execute("a.jsonl", jsonl("l1", "l2", "l3"))
    monkeypatch.setattr(imports_module, "MAX_RECORDS_PER_FILE", 2)
    with pytest.raises(LimitExceededError, match="3 records"):
        env.commit.execute("tracelab", [FileBinding(a.upload_id, "map_tracelab")])
    monkeypatch.setattr(imports_module, "MAX_RECORDS_PER_FILE", 100_000)
    monkeypatch.setattr(imports_module, "MAX_BATCH_BYTES", 10)
    with pytest.raises(LimitExceededError, match="bytes to read"):
        env.commit.execute("tracelab", [FileBinding(a.upload_id, "map_tracelab")])
    monkeypatch.setattr(imports_module, "MAX_BATCH_BYTES", 10**9)
    with pytest.raises(LimitExceededError, match="at most 20 files"):
        env.commit.execute("tracelab", [FileBinding(a.upload_id, "map_tracelab")] * 21)


class _Wrapped:
    """Enter the real unit of work, then make one import-repository method raise."""

    def __init__(self, inner: Any, method: str, exc: Exception) -> None:
        self._inner, self._method, self._exc = inner, method, exc

    def __enter__(self) -> Any:
        uow = self._inner.__enter__()
        original = getattr(uow.imports, self._method)
        method, exc = self._method, self._exc

        def boom(*args: Any, **kwargs: Any) -> Any:
            # only the commit itself explodes: the audit writes of the failed attempt pass
            if method == "update_report" and args[0].status != "committed":
                return original(*args, **kwargs)
            if method == "add_results" and not args[1]:
                return original(*args, **kwargs)
            raise exc

        setattr(uow.imports, method, boom)
        return uow

    def __exit__(self, *args: Any) -> None:
        self._inner.__exit__(*args)


def _failing_factory(env: Env, method: str, exc: Exception) -> Callable[[], Any]:
    return lambda: _Wrapped(env.uow_factory(), method, exc)


@pytest.mark.parametrize("method", ["update_report", "add_results"])
def test_failure_after_store_rolls_back_everything_and_records_failed(
    env: Env, method: str
) -> None:
    a = env.upload.execute("a.jsonl", jsonl("f1", "f2"))
    b = env.upload.execute("b.parquet", parquet_file(parquet_rows("f", 1)))
    bindings = [FileBinding(a.upload_id, "map_tracelab"), FileBinding(b.upload_id, "map_parquet")]
    failing = env.commit_with(_failing_factory(env, method, RuntimeError("disk on fire")))
    report = failing.execute("tracelab", bindings)
    assert report.status == "failed" and "disk on fire" in (report.error or "")
    assert {f.status for f in report.files} == {"failed"}
    assert env.sql("SELECT COUNT(*) FROM sessions") == [(0,)]
    assert env.sql("SELECT COUNT(*) FROM model_calls") == [(0,)]
    assert env.sql("SELECT COUNT(*) FROM record_results") == [(0,)]
    assert env.sql("SELECT status, committed FROM import_files") == [("failed", 0), ("failed", 0)]
    # nothing was claimed: the same batch commits cleanly afterwards
    retry = env.commit.execute("tracelab", bindings)
    assert retry.status == "committed" and retry.entities == {
        "session": 3,
        "model_call": 3,
        "tool_call": 1,
    }


def test_race_loser_is_recorded_as_duplicate_then_conflicts(env: Env) -> None:
    a = env.upload.execute("a.jsonl", jsonl("r1"))
    racing = env.commit_with(_failing_factory(env, "update_report", ConflictError("lost the race")))
    with pytest.raises(ConflictError):
        racing.execute("tracelab", [FileBinding(a.upload_id, "map_tracelab")])
    with env.uow_factory() as uow:
        attempts = uow.imports.list(10, 0)
    assert [r.status for r in attempts] == ["duplicate"]
    assert "race" in (attempts[0].error or "") and attempts[0].files[0].status == "duplicate"
    assert env.sql("SELECT COUNT(*) FROM sessions") == [(0,)]


TWO = '{"accepted": 2, "partial": 0, "duplicate": 0, "rejected": 0, "ignored": 0}'
ZERO = '{"accepted": 0, "partial": 0, "duplicate": 0, "rejected": 0, "ignored": 0}'


def test_migration_0003_backfills_a_populated_0002_database(tmp_path: Path) -> None:
    engine = create_engine_for(f"sqlite:///{tmp_path / 'old.sqlite3'}")
    config = alembic_config(engine)
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "0002")
    sha = "a" * 64
    with engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO mappings (id, name, source, revision, created_by, input_format, "
                "document, content_hash, created_at) VALUES ('map_1', 'm', 'tracelab', 1, 't', "
                "'jsonl', '{}', 'h', '2026-09-07 10:00:00.000000')"
            )
        )
        c.execute(
            text(
                "INSERT INTO raw_files (sha256, size_bytes, storage_key, created_at) "
                "VALUES (:s, 1, '', '2026-09-07 10:00:00.000000')"
            ),
            {"s": sha},
        )
        for import_id, status, started, records in (
            (
                "imp_a",
                "committed",
                "2026-09-07 10:00:00.000000",
                '{"accepted": 2, "partial": 0, "duplicate": 0, "rejected": 0, "ignored": 0}',
            ),
            (
                "imp_b",
                "committed",
                "2026-09-07 11:00:00.000000",
                '{"accepted": 2, "partial": 0, "duplicate": 0, "rejected": 0, "ignored": 0}',
            ),
            (
                "imp_c",
                "failed",
                "2026-09-07 12:00:00.000000",
                '{"accepted": 0, "partial": 0, "duplicate": 0, "rejected": 0, "ignored": 0}',
            ),
        ):
            c.execute(
                text(
                    "INSERT INTO imports (id, status, source, mapping_id, mapping_name, "
                    "mapping_revision, started_at, finished_at, records, entities, warnings, "
                    "reject_count, error) VALUES (:i, :st, 'tracelab', 'map_1', 'm', 1, :t, :t, "
                    ":r, '{}', '{}', 0, NULL)"
                ),
                {"i": import_id, "st": status, "t": started, "r": records},
            )
            # rows as 0001 wrote them: no source, never marked committed
            c.execute(
                text(
                    "INSERT INTO import_files (id, import_id, sha256, filename, size_bytes, "
                    "format, record_count) VALUES (:f, :i, :s, 'a.jsonl', 1, 'jsonl', 2)"
                ),
                {"f": f"if_{import_id}", "i": import_id, "s": sha},
            )
        c.execute(
            text(
                "INSERT INTO record_results (import_id, locator, file_sha256, outcome, "
                "entity_counts, warning_counts) "
                "VALUES ('imp_a', 'line:1', :s, 'accepted', '{}', '{}')"
            ),
            {"s": sha},
        )
        c.execute(
            text(
                "INSERT INTO rejects (import_id, locator, rule_id, path, code, field, message, "
                "payload) VALUES ('imp_c', 'line:2', 'r', 'p', 'bad', NULL, 'm', NULL)"
            )
        )
    run_migrations(engine)
    with engine.connect() as c:
        files = {
            r[0]: tuple(r[1:])
            for r in c.execute(
                text(
                    "SELECT import_id, source, committed, mapping_id, status, records "
                    "FROM import_files"
                )
            )
        }
    # the earliest committed attempt keeps the claim; the later one becomes a duplicate
    assert files["imp_a"][:4] == ("tracelab", 1, "map_1", "committed")
    assert json.loads(files["imp_a"][4]) == json.loads(TWO)
    assert files["imp_b"][:4] == ("tracelab", 0, "map_1", "duplicate")
    assert files["imp_c"][:4] == ("tracelab", 0, "map_1", "failed")
    with engine.connect() as c:
        assert c.execute(text("SELECT file_sha256 FROM rejects")).scalar_one() == sha
        # the rebuilt primary key admits the same locator from another file of one attempt
        c.execute(
            text(
                "INSERT INTO raw_files (sha256, size_bytes, storage_key, created_at) "
                "VALUES (:s, 1, '', '2026-09-07 10:00:00.000000')"
            ),
            {"s": "b" * 64},
        )
        c.execute(
            text(
                "INSERT INTO record_results (import_id, file_sha256, locator, outcome, "
                "entity_counts, warning_counts) "
                "VALUES ('imp_a', :s, 'line:1', 'accepted', '{}', '{}')"
            ),
            {"s": "b" * 64},
        )
        c.commit()
    uow_factory = make_uow_factory(engine)
    with uow_factory() as uow:
        assert [r.import_id for r in uow.imports.find_committed(sha, "tracelab")] == ["imp_a"]
        report = uow.imports.get("imp_b")
        assert report is not None and report.files[0].status == "duplicate"
        assert report.files[0].mapping is not None and report.files[0].mapping.name == "m"
        rejects: Sequence[RejectRow] = uow.imports.rejects("imp_c", None, sha, 10, 0)
        assert [r.locator for r in rejects] == ["line:2"]
        outcomes: list[RecordOutcome] = []
        assert outcomes == []


def test_migration_0003_clears_a_newer_legacy_claim_before_promoting_the_older_attempt(
    tmp_path: Path,
) -> None:
    """A 0002 database where the newer attempt already holds committed=1 and the older one
    (written by 0001) holds committed=0: the repair must not trip the partial index."""
    engine = create_engine_for(f"sqlite:///{tmp_path / 'old.sqlite3'}")
    config = alembic_config(engine)
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "0002")
    sha = "c" * 64
    with engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO mappings (id, name, source, revision, created_by, input_format, "
                "document, content_hash, created_at) VALUES ('map_1', 'm', 'tracelab', 1, 't', "
                "'jsonl', '{}', 'h', '2026-09-07 10:00:00.000000')"
            )
        )
        c.execute(
            text(
                "INSERT INTO raw_files (sha256, size_bytes, storage_key, created_at) "
                "VALUES (:s, 1, '', '2026-09-07 10:00:00.000000')"
            ),
            {"s": sha},
        )
        for import_id, started, committed in (
            ("imp_old", "2026-09-07 10:00:00.000000", 0),
            ("imp_new", "2026-09-07 11:00:00.000000", 1),
        ):
            c.execute(
                text(
                    "INSERT INTO imports (id, status, source, mapping_id, mapping_name, "
                    "mapping_revision, started_at, finished_at, records, entities, warnings, "
                    "reject_count, error) VALUES (:i, 'committed', 'tracelab', 'map_1', 'm', 1, "
                    ":t, :t, :r, '{}', '{}', 0, NULL)"
                ),
                {"i": import_id, "t": started, "r": TWO},
            )
            c.execute(
                text(
                    "INSERT INTO import_files (id, import_id, sha256, filename, size_bytes, "
                    "format, record_count, source, committed) "
                    "VALUES (:f, :i, :s, 'a.jsonl', 1, 'jsonl', 2, 'tracelab', :c)"
                ),
                {"f": f"if_{import_id}", "i": import_id, "s": sha, "c": committed},
            )
    run_migrations(engine)
    with engine.connect() as c:
        rows = {
            r[0]: (r[1], r[2])
            for r in c.execute(text("SELECT import_id, status, committed FROM import_files"))
        }
    assert rows == {"imp_old": ("committed", 1), "imp_new": ("duplicate", 0)}
