"""Ports: the interfaces the use cases need, implemented by infrastructure.

Narrow and task-oriented on purpose; nothing here knows about SQL, files on
disk or HTTP.
"""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from datetime import datetime
from typing import Any, BinaryIO, Protocol

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
from agentscope_app.domain.mapping.interpreter import Emission
from agentscope_app.domain.reducer import SessionAggregate


class Clock(Protocol):
    def now(self) -> datetime: ...


class IdGenerator(Protocol):
    def new_id(self, prefix: str) -> str: ...


class RawFileStore(Protocol):
    """Immutable byte storage keyed by content hash."""

    def put(self, data: bytes) -> StoredFile: ...

    def get(self, sha256: str) -> StoredFile | None: ...

    def open(self, sha256: str) -> BinaryIO: ...


class RecordReader(Protocol):
    """Decodes a stored file into records with stable locators."""

    def sniff(self, filename: str, head: bytes) -> str:
        """Return ``jsonl`` or ``parquet``; raise InvalidInputError otherwise."""
        ...

    def read(self, stream: BinaryIO, fmt: str) -> Iterator[RawRecord]: ...


class UploadRepository(Protocol):
    def add(self, info: UploadInfo) -> None: ...

    def get(self, upload_id: str) -> UploadInfo | None: ...


class MappingRepository(Protocol):
    def list(self) -> Sequence[MappingRecord]: ...

    def get(self, mapping_id: str) -> MappingRecord | None: ...

    def find_by_hash(self, content_hash: str) -> MappingRecord | None: ...

    def add(self, record: MappingRecord) -> None: ...


class ImportRepository(Protocol):
    def find_committed(self, file_sha256: str, source: str) -> Sequence[ImportRef]: ...

    def add_report(self, report: ImportReport) -> None: ...

    def update_report(self, report: ImportReport) -> None:
        """Replace a previously added report (status, counts, finished_at)."""
        ...

    def add_results(
        self,
        import_id: str,
        file_sha256: str,
        outcomes: Sequence[RecordOutcome],
        rejects: Sequence[RejectRow],
    ) -> None:
        """Persist per-record outcomes (and their raw payloads) and rejects."""
        ...

    def get(self, import_id: str) -> ImportReport | None: ...

    def list(self, limit: int, offset: int) -> Sequence[ImportReport]: ...

    def rejects(
        self, import_id: str, code: str | None, limit: int, offset: int
    ) -> Sequence[RejectRow]: ...


class TraceRepository(Protocol):
    """Canonical entities with provenance."""

    def store(
        self,
        *,
        import_id: str,
        file_sha256: str,
        source: str,
        mapping_id: str,
        emissions: Sequence[Emission],
        sessions: dict[str, SessionAggregate],
    ) -> dict[str, int]:
        """Persist accepted emissions; return counts per entity actually inserted."""
        ...

    def list_sessions(
        self, *, source: str | None, agent: str | None, limit: int, offset: int
    ) -> Sequence[SessionSummary]: ...

    def get_session(self, session_id: str) -> SessionDetail | None: ...

    def raw_record(self, file_sha256: str, locator: str) -> Any: ...

    def metrics_summary(self, *, source: str | None, agent: str | None) -> dict[str, Any]:
        """Aggregates for MetricsSummary: counts, token sums, coverage, by_semantics."""
        ...


class UnitOfWork(Protocol):
    uploads: UploadRepository
    mappings: MappingRepository
    imports: ImportRepository
    traces: TraceRepository

    def __enter__(self) -> UnitOfWork: ...

    def __exit__(self, exc_type: object, exc: object, tb: object) -> None: ...

    def commit(self) -> None: ...

    def rollback(self) -> None: ...


class UnitOfWorkFactory(Protocol):
    def __call__(self) -> UnitOfWork: ...
