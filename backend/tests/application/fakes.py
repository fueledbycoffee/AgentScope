"""In-memory implementations of the ports, for use-case tests."""

from __future__ import annotations

import gzip
import hashlib
import io
import json
from collections.abc import Iterator, Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any, BinaryIO

from agentscope_app.application.dto import (
    ImportRef,
    ImportReport,
    MappingRecord,
    RawRecord,
    RecordOutcome,
    RejectRow,
    SessionDetail,
    SessionSummary,
    StoredFile,
    UploadInfo,
)
from agentscope_app.application.errors import ConflictError, InvalidInputError
from agentscope_app.domain.mapping.interpreter import Emission
from agentscope_app.domain.reducer import SessionAggregate


class FakeClock:
    def __init__(self) -> None:
        self.current = datetime(2026, 9, 7, 12, 0, tzinfo=UTC)

    def now(self) -> datetime:
        self.current += timedelta(seconds=1)
        return self.current


class FakeIds:
    def __init__(self) -> None:
        self.counter = 0

    def new_id(self, prefix: str) -> str:
        self.counter += 1
        return f"{prefix}_{self.counter:04d}"


class FakeStore:
    def __init__(self) -> None:
        self.blobs: dict[str, bytes] = {}

    def put(self, data: bytes) -> StoredFile:
        sha = hashlib.sha256(data).hexdigest()
        self.blobs[sha] = data
        return StoredFile(sha, len(data), f"mem://{sha}")

    def get(self, sha256: str) -> StoredFile | None:
        data = self.blobs.get(sha256)
        return None if data is None else StoredFile(sha256, len(data), f"mem://{sha256}")

    def open(self, sha256: str) -> BinaryIO:
        return io.BytesIO(self.blobs[sha256])


class FakeReader:
    def sniff(self, filename: str, head: bytes) -> str:
        name = filename.lower()
        if name.endswith((".jsonl", ".jsonl.gz", ".ndjson")):
            return "jsonl"
        if name.endswith(".parquet"):
            return "parquet"
        raise InvalidInputError(f"Unsupported file type: {filename}")

    def read(self, stream: BinaryIO, fmt: str) -> Iterator[RawRecord]:
        data = stream.read()
        if data[:2] == b"\x1f\x8b":
            data = gzip.decompress(data)
        for number, line in enumerate(data.splitlines(), 1):
            if not line.strip():
                continue
            try:
                yield RawRecord(f"line:{number}", json.loads(line))
            except ValueError as exc:
                yield RawRecord(f"line:{number}", None, f"invalid JSON: {exc}")


class FakeUploads:
    def __init__(self) -> None:
        self.items: dict[str, UploadInfo] = {}

    def add(self, info: UploadInfo) -> None:
        self.items[info.upload_id] = info

    def get(self, upload_id: str) -> UploadInfo | None:
        return self.items.get(upload_id)


class FakeMappings:
    def __init__(self) -> None:
        self.items: dict[str, MappingRecord] = {}

    def list(self) -> Sequence[MappingRecord]:
        return list(self.items.values())

    def get(self, mapping_id: str) -> MappingRecord | None:
        return self.items.get(mapping_id)

    def find_by_hash(self, content_hash: str) -> MappingRecord | None:
        return next((m for m in self.items.values() if m.content_hash == content_hash), None)

    def add(self, record: MappingRecord) -> None:
        self.items[record.id] = record


class FakeImports:
    def __init__(self) -> None:
        self.conflict_on_commit = False
        self.reports: dict[str, ImportReport] = {}
        self.results: dict[str, list[RecordOutcome]] = {}
        self.reject_rows: dict[str, list[RejectRow]] = {}

    def find_committed(self, file_sha256: str, source: str) -> Sequence[ImportRef]:
        return [
            ImportRef(r.import_id, r.started_at)
            for r in self.reports.values()
            if r.source == source
            and any(f.sha256 == file_sha256 and f.status == "committed" for f in r.files)
        ]

    def find_committed_any(self, file_sha256: str) -> Sequence[ImportRef]:
        return [
            ImportRef(r.import_id, r.started_at)
            for r in self.reports.values()
            if any(f.sha256 == file_sha256 and f.status == "committed" for f in r.files)
        ]

    def add_report(self, report: ImportReport) -> None:
        self.reports[report.import_id] = report

    def update_report(self, report: ImportReport) -> None:
        assert report.import_id in self.reports
        if report.status == "committed" and self.conflict_on_commit:
            raise ConflictError("another import of the same bytes was committed concurrently")
        self.reports[report.import_id] = report

    def add_results(
        self, import_id: str, outcomes: Sequence[RecordOutcome], rejects: Sequence[RejectRow]
    ) -> None:
        self.results[import_id] = list(outcomes)
        self.reject_rows[import_id] = list(rejects)

    def get(self, import_id: str) -> ImportReport | None:
        return self.reports.get(import_id)

    def list(self, limit: int, offset: int) -> Sequence[ImportReport]:
        ordered = sorted(self.reports.values(), key=lambda r: r.started_at, reverse=True)
        return ordered[offset : offset + limit]

    def rejects(
        self,
        import_id: str,
        code: str | None,
        file_sha256: str | None,
        limit: int,
        offset: int,
    ) -> Sequence[RejectRow]:
        rows = [
            r
            for r in self.reject_rows.get(import_id, [])
            if (code is None or r.code == code)
            and (file_sha256 is None or r.file_sha256 == file_sha256)
        ]
        return rows[offset : offset + limit]


class FakeTraces:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.stored: list[dict[str, Any]] = []

    def existing_sessions(
        self, source: str, external_ids: Sequence[str]
    ) -> dict[str, SessionAggregate]:
        return {}

    def store(
        self,
        *,
        import_id: str,
        source: str,
        bindings: Mapping[str, str],
        emissions: Sequence[Emission],
        sessions: dict[str, SessionAggregate],
    ) -> dict[str, int]:
        if self.fail:
            raise RuntimeError("database exploded")
        self.stored.append(
            {
                "import_id": import_id,
                "bindings": dict(bindings),
                "source": source,
                "emissions": list(emissions),
                "sessions": dict(sessions),
            }
        )
        counts: dict[str, int] = {"session": len(sessions)}
        for emission in emissions:
            if emission.entity != "session":
                counts[emission.entity] = counts.get(emission.entity, 0) + 1
        return counts

    def list_sessions(
        self, *, source: str | None, agent: str | None, limit: int, offset: int
    ) -> Sequence[SessionSummary]:
        return []

    def get_session(self, session_id: str) -> SessionDetail | None:
        return None

    def raw_record(self, file_sha256: str, locator: str) -> Any:
        return None

    def metrics_summary(self, *, source: str | None, agent: str | None) -> dict[str, Any]:
        return {}


class FakeUnitOfWork:
    def __init__(self, traces: FakeTraces | None = None) -> None:
        self.uploads = FakeUploads()
        self.mappings = FakeMappings()
        self.imports = FakeImports()
        self.traces = traces or FakeTraces()
        self.commits = 0
        self.rollbacks = 0
        self._entered = 0

    def __enter__(self) -> FakeUnitOfWork:
        self._entered += 1
        return self

    def __exit__(self, exc_type: object, exc: object, tb: object) -> None:
        if exc_type is not None:
            self.rollback()

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1

    def factory(self) -> FakeUnitOfWork:
        """A UnitOfWorkFactory that always hands out this same instance."""
        return self
