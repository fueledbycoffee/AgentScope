"""Data transfer objects exchanged between use cases, ports and interfaces.

They mirror the shapes in ``docs/api/v0.1.md``. Frozen dataclasses so they
are safe to share and trivially serialisable with ``dataclasses.asdict``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_RECORDS_PER_FILE = 100_000
PREVIEW_RECORDS = 20
MAX_PREVIEW_SAMPLE = 1_000


@dataclass(frozen=True)
class StoredFile:
    sha256: str
    size_bytes: int
    storage_key: str


@dataclass(frozen=True)
class RawRecord:
    """One decoded source record. ``payload`` is None when decoding failed."""

    locator: str
    payload: Any
    error: str | None = None


@dataclass(frozen=True)
class ImportRef:
    import_id: str
    imported_at: datetime


@dataclass(frozen=True)
class UploadInfo:
    upload_id: str
    filename: str
    sha256: str
    size_bytes: int
    format: str
    record_count: int
    preview: tuple[RawRecord, ...]
    already_imported: tuple[ImportRef, ...]


@dataclass(frozen=True)
class MappingRecord:
    id: str
    name: str
    source: str
    revision: int
    created_by: str
    input_format: str
    document: dict[str, Any]
    content_hash: str
    created_at: datetime


@dataclass(frozen=True)
class RecordOutcome:
    """One source record's outcome in one import, with its payload for provenance."""

    locator: str
    outcome: str  # accepted | partial | rejected | ignored | duplicate
    entity_counts: dict[str, int]
    warning_counts: dict[str, int]
    payload: Any = None


@dataclass(frozen=True)
class RejectRow:
    locator: str
    rule_id: str
    path: str
    code: str
    field: str | None
    message: str
    payload: Any = None


@dataclass(frozen=True)
class EmissionSample:
    entity: str
    path: str
    locator: str
    fields: dict[str, Any]


@dataclass(frozen=True)
class PreviewReport:
    records: dict[str, int]  # accepted, partial, rejected, ignored, sampled
    entities: dict[str, int]
    rejects: tuple[RejectRow, ...]
    warnings: dict[str, int]
    emissions: tuple[EmissionSample, ...]


@dataclass(frozen=True)
class FileInfo:
    filename: str
    sha256: str
    size_bytes: int
    format: str
    record_count: int


@dataclass(frozen=True)
class MappingRef:
    id: str
    name: str
    revision: int


@dataclass(frozen=True)
class ImportReport:
    import_id: str
    status: str  # committed | duplicate | failed
    source: str
    mapping: MappingRef
    started_at: datetime
    finished_at: datetime | None
    files: tuple[FileInfo, ...]
    records: dict[str, int]  # accepted, partial, duplicate, rejected, ignored
    entities: dict[str, int]
    warnings: dict[str, int]
    reject_count: int
    error: str | None = None


@dataclass(frozen=True)
class Coverage:
    known: int
    total: int


@dataclass(frozen=True)
class Metric:
    value: int | float | None
    definition: str
    unit: str | None = None
    coverage: Coverage | None = None
    by_semantics: dict[str, int] = field(default_factory=dict)


@dataclass(frozen=True)
class RawRecordRef:
    file_sha256: str
    locator: str


@dataclass(frozen=True)
class SessionSummary:
    id: str
    source: str
    external_id: str
    agent: str | None
    observed_start_at: datetime | None
    observed_end_at: datetime | None
    model_call_count: int
    tool_call_count: int
    input_tokens: Metric


@dataclass(frozen=True)
class ModelCallRow:
    id: str
    sequence: int | None
    provider: str | None
    model: str | None
    started_at: datetime | None
    ended_at: datetime | None
    input_tokens: int | None
    output_tokens: int | None
    cache_read_tokens: int | None
    cache_creation_tokens: int | None
    reasoning_tokens: int | None
    token_semantics: str | None
    is_error: bool | None
    raw_record: RawRecordRef


@dataclass(frozen=True)
class ToolCallRow:
    id: str
    model_call_id: str | None
    sequence: int | None
    tool_name: str
    started_at: datetime | None
    ended_at: datetime | None
    wall_latency_ms: int | None
    internal_latency_ms: int | None
    is_error: bool | None
    exit_code: int | None
    status: str | None
    raw_record: RawRecordRef


@dataclass(frozen=True)
class DiagnosticRow:
    code: str
    field: str | None
    message: str


@dataclass(frozen=True)
class SessionDetail:
    summary: SessionSummary
    declared_started_at: datetime | None
    declared_ended_at: datetime | None
    repo: str | None
    user: str | None
    model_calls: tuple[ModelCallRow, ...]
    tool_calls: tuple[ToolCallRow, ...]
    diagnostics: tuple[DiagnosticRow, ...]


@dataclass(frozen=True)
class MetricsSummary:
    sessions: Metric
    model_calls: Metric
    tool_calls: Metric
    input_tokens: Metric
