"""Ports: the interfaces the use cases need, implemented by infrastructure.

Narrow and task-oriented on purpose; nothing here knows about SQL, files on
disk or HTTP.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping, Sequence
from datetime import datetime
from typing import Any, BinaryIO, Protocol

from agentscope_app.application.dto import (
    AssistantReply,
    CachedProfile,
    ImportDiagnosticsPage,
    ImportRef,
    ImportReport,
    MappingRecord,
    PreparedContext,
    RawRecord,
    RecordOutcome,
    RecordRow,
    RejectRow,
    RejectSummary,
    RepairRequest,
    SessionDetail,
    SessionSummary,
    StoredFile,
    TraceStoreResult,
    UploadInfo,
)
from agentscope_app.application.metric_queries import AggregateRows, MetricQuerySpec, TraceScope
from agentscope_app.domain.claims import ClaimCandidate, ClaimCondition
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

    def get_profile(self, upload_id: str) -> CachedProfile | None:
        """The cached sanitised profile, or None when never computed."""
        ...

    def set_profile(self, upload_id: str, cached: CachedProfile) -> None: ...


class MappingRepository(Protocol):
    def list(self) -> Sequence[MappingRecord]: ...

    def get(self, mapping_id: str) -> MappingRecord | None: ...

    def find_by_hash(self, content_hash: str) -> MappingRecord | None: ...

    def add(self, record: MappingRecord) -> None: ...


class ImportRepository(Protocol):
    def find_committed(self, file_sha256: str, source: str) -> Sequence[ImportRef]: ...

    def find_committed_any(self, file_sha256: str) -> Sequence[ImportRef]:
        """Committed imports of these bytes under any source."""
        ...

    def add_report(self, report: ImportReport) -> None: ...

    def update_report(self, report: ImportReport) -> None:
        """Replace a previously added report (status, counts, finished_at)."""
        ...

    def add_results(
        self, import_id: str, outcomes: Sequence[RecordOutcome], rejects: Sequence[RejectRow]
    ) -> None:
        """Persist per-record outcomes (and their raw payloads) and rejects; rows carry
        their file hash, so one call covers every file of the attempt."""
        ...

    def add_claim_conditions(
        self, import_id: str, conditions: Sequence[ClaimCondition]
    ) -> None: ...

    def diagnostics(
        self,
        import_id: str,
        code: str | None,
        file_sha256: str | None,
        locator: str | None,
        limit: int,
        offset: int,
    ) -> ImportDiagnosticsPage: ...

    def get(self, import_id: str) -> ImportReport | None: ...

    def list(self, limit: int, offset: int) -> Sequence[ImportReport]: ...

    def rejects(
        self,
        import_id: str,
        code: str | None,
        file_sha256: str | None,
        rule_id: str | None,
        limit: int,
        offset: int,
    ) -> Sequence[RejectRow]: ...

    def reject_summary(self, import_id: str) -> RejectSummary:
        """Reject counts by code, rule and file, plus record counts by outcome."""
        ...

    def records(
        self,
        import_id: str,
        outcome: str | None,
        file_sha256: str | None,
        limit: int,
        offset: int,
    ) -> Sequence[RecordRow]:
        """Per-record outcomes ordered by file, then by locator position."""
        ...


class TraceRepository(Protocol):
    """Canonical entities with provenance."""

    def existing_sessions(
        self, source: str, external_ids: Sequence[str]
    ) -> dict[str, SessionAggregate]:
        """Known state of these sessions, as seeds for the domain reducer."""
        ...

    def store(
        self,
        *,
        import_id: str,
        source: str,
        bindings: Mapping[str, str],
        emissions: Sequence[Emission],
        sessions: dict[str, SessionAggregate],
        claims: Sequence[ClaimCandidate] = (),
    ) -> TraceStoreResult:
        """Persist accepted emissions; ``bindings`` maps each file hash of the attempt
        to the mapping id it ran under (every contribution records its own);
        ``sessions`` is the full new state of each session (seeded from
        ``existing_sessions``). Returns counts per entity actually inserted; raises
        ConflictError on an occurrence-key collision."""
        ...

    def list_sessions(
        self, *, scope: TraceScope, limit: int, offset: int
    ) -> Sequence[SessionSummary]: ...

    def get_session(self, session_id: str) -> SessionDetail | None: ...

    def raw_record(self, file_sha256: str, locator: str) -> Any: ...


class TraceQuery(Protocol):
    """Grain-preserving aggregates and consistent session drills."""

    def aggregate(self, spec: MetricQuerySpec) -> AggregateRows: ...

    def session_ids(self, scope: TraceScope, *, limit: int, offset: int) -> Sequence[str]: ...

    def session_metrics(self, scope: TraceScope) -> dict[str, dict[str, AggregateRows]]: ...


class MappingAssistant(Protocol):
    """ADR-005 port. Adapters own transport and the fixed instruction preamble only.

    ``prepared.text`` must reach the model verbatim as data; ``repair`` adds the
    sanitised previous candidate and issues, also as data. Failures are
    ``AssistantError``; the reply is raw text the application parses and validates.
    """

    def complete(
        self, prepared: PreparedContext, *, repair: RepairRequest | None = None
    ) -> AssistantReply: ...


class UnitOfWork(Protocol):
    uploads: UploadRepository
    mappings: MappingRepository
    imports: ImportRepository
    traces: TraceRepository
    trace_query: TraceQuery

    def __enter__(self) -> UnitOfWork: ...

    def __exit__(self, exc_type: object, exc: object, tb: object) -> None: ...

    def commit(self) -> None: ...

    def rollback(self) -> None: ...


class UnitOfWorkFactory(Protocol):
    def __call__(self) -> UnitOfWork: ...
