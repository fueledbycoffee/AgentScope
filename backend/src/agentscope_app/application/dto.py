"""Data transfer objects exchanged between use cases, ports and interfaces.

They mirror the shapes in ``docs/api/v0.1.md``. Frozen dataclasses so they
are safe to share and trivially serialisable with ``dataclasses.asdict``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

from agentscope_app.domain.claims import ClaimCondition

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_RECORDS_PER_FILE = 100_000
MAX_FILES_PER_IMPORT = 20
MAX_BATCH_BYTES = 4 * MAX_UPLOAD_BYTES  # bytes read by one import attempt (duplicates excluded)
MAX_DECODED_BYTES = 256 * 1024 * 1024  # Parquet: sum of uncompressed row groups
PREVIEW_RECORDS = 20
MAX_PREVIEW_SAMPLE = 1_000
# assistant context (ADR-005): what may leave the server, and how much
CONTEXT_BUDGET_BYTES = 64 * 1024
MAX_MESSAGE_CHARS = 4_000
MAX_HISTORY_TURNS = 20
MAX_MAPPING_BYTES = 64 * 1024
MAX_REPAIR_CANDIDATE_BYTES = 16 * 1024
MAX_REPAIR_ISSUES_BYTES = 4 * 1024
MAX_RAW_TEXT_BYTES = 32 * 1024


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
class CachedProfile:
    """A sanitised field profile stored on the upload row, tagged with the profiler version."""

    version: int
    profile: dict[str, Any]


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
    file_sha256: str = ""


@dataclass(frozen=True)
class RecordRow:
    """One source record's outcome in one import, for browsing (no payload)."""

    file_sha256: str
    locator: str
    outcome: str
    entity_counts: dict[str, int]
    warning_counts: dict[str, int]


@dataclass(frozen=True)
class RejectSummary:
    """How the rejects of one import distribute, for filters with counts."""

    codes: dict[str, int]
    rules: dict[str, int]
    files: dict[str, int]
    outcomes: dict[str, int]


@dataclass(frozen=True)
class RejectRow:
    locator: str
    rule_id: str
    path: str
    code: str
    field: str | None
    message: str
    payload: Any = None
    file_sha256: str = ""


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
class MappingRef:
    id: str
    name: str
    revision: int


@dataclass(frozen=True)
class FileBinding:
    """One file of an import attempt and the mapping revision it runs under."""

    upload_id: str
    mapping_id: str


@dataclass(frozen=True)
class FileInfo:
    filename: str
    sha256: str
    size_bytes: int
    format: str
    record_count: int
    mapping: MappingRef | None = None
    status: str = "committed"  # pending | committed | duplicate | failed
    records: dict[str, int] = field(default_factory=dict)
    duplicate_of: str | None = None  # the committed import these bytes were skipped in favour of
    warnings: dict[str, int] = field(default_factory=dict)
    claim_conditions: tuple[ClaimCondition, ...] = ()


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
    duplicate_detection_version: int | None = None


@dataclass(frozen=True)
class Coverage:
    known: int
    total: int


@dataclass(frozen=True, init=False)
class TokenCoverage(Coverage):
    """Token-weighted counts with authoritative text for lossless JSON transport."""

    known_text: str
    total_text: str

    def __init__(self, known: int, total: int) -> None:
        super().__init__(known, total)
        object.__setattr__(self, "known_text", str(known))
        object.__setattr__(self, "total_text", str(total))


@dataclass(frozen=True)
class SemanticsPartition:
    semantics: str
    value_text: str | None
    coverage: Coverage


@dataclass(frozen=True)
class Metric:
    value: int | float | None
    definition: str
    unit: str | None = None
    coverage: Coverage | None = None
    by_semantics: dict[str, int] = field(default_factory=dict)
    metric_id: str | None = None
    version: int | None = None
    value_text: str | None = None
    recorded_sum_text: str | None = None
    comparability: str = "not_applicable"
    reason: str = ""
    semantics_partitions: tuple[SemanticsPartition, ...] = ()


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
    output_tokens: Metric


# --- mapping assistant (ADR-005) ---------------------------------------------------------


@dataclass(frozen=True)
class Turn:
    role: str  # "user" | "assistant"
    content: str


@dataclass(frozen=True)
class MappingIdentity:
    name: str
    source: str


@dataclass(frozen=True)
class AssistantRequest:
    """What the client asks for; the server derives everything else from the upload."""

    kind: str  # "propose" | "revise"
    upload_id: str
    identity: MappingIdentity
    include_sample: bool = False
    current_mapping: dict[str, Any] | None = None
    message: str | None = None
    history: tuple[Turn, ...] = ()


@dataclass(frozen=True)
class PreparedContext:
    """The exact data context the model will see, frozen; ``sha256`` is over ``text``."""

    kind: str
    text: str
    bytes: int
    sha256: str
    document: dict[str, Any]
    redactions: dict[str, int]
    truncated: dict[str, int]
    sample_included: bool
    sample_count: int


@dataclass(frozen=True)
class RepairRequest:
    """The model's own previous reply and the validation issues, sanitised and bounded."""

    candidate_text: str
    issues_text: str


@dataclass(frozen=True)
class AssistantReply:
    text: str
    model: str
    finish: str  # "stop" | "length" | "refusal"
    notes: tuple[str, ...] = ()  # adapter events worth showing (e.g. JSON mode negotiated off)


@dataclass(frozen=True)
class FieldExplanation:
    target: str
    path: str
    why: str
    confidence: float


@dataclass(frozen=True)
class Ambiguity:
    target: str
    options: tuple[str, ...]
    what_settles_it: str


@dataclass(frozen=True)
class MappingProposal:
    mapping: dict[str, Any]
    explanations: tuple[FieldExplanation, ...]
    ambiguities: tuple[Ambiguity, ...]
    questions: tuple[str, ...]
    model: str
    executable: bool


@dataclass(frozen=True)
class AssistantOutcome:
    proposal: MappingProposal | None
    issues: tuple[dict[str, Any], ...]
    attempts: int
    diagnostics: dict[str, Any]


@dataclass(frozen=True)
class ProfileReport:
    upload_id: str
    profile: dict[str, Any]
    cached: bool


DiagnosticCode = Literal["suspected_duplicate", "matching_claim_equal_projection"]
DIAGNOSTIC_MESSAGES: dict[str, str] = {
    "suspected_duplicate": "Another file holds this scoped native claim, but no peer file "
    "holds equal canonical values. All observations were retained.",
    "matching_claim_equal_projection": "Another file holds this scoped native claim with "
    "equal canonical values. All observations were retained.",
}


@dataclass(frozen=True)
class DiagnosticPeer:
    import_id: str
    file_sha256: str
    locator: str
    emission_path: str
    entity: str


@dataclass(frozen=True)
class ImportDiagnostic:
    file_sha256: str
    locator: str
    emission_path: str
    rule_id: str
    entity: str
    code: DiagnosticCode
    message: str
    peer: DiagnosticPeer


@dataclass(frozen=True)
class ImportDiagnosticsPage:
    items: tuple[ImportDiagnostic, ...]
    total: int
    conditions: tuple[ClaimCondition, ...] = ()


@dataclass(frozen=True)
class TraceStoreResult:
    entity_counts: dict[str, int]
    diagnostics: tuple[ImportDiagnostic, ...] = ()
