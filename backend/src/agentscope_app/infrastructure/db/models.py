"""SQLAlchemy models for the relational store (see docs/planning §3 and ADR-002).

One row means: ``sources`` a dataset namespace; ``raw_files`` an immutable
uploaded byte sequence; ``uploads`` one upload of a file; ``mappings`` one
immutable mapping revision; ``imports`` one import attempt; ``import_files``
one file's participation in an attempt; ``raw_records`` one decoded record;
``record_results`` one record's outcome in one import; ``rejects`` one
explained failure; ``sessions`` one reconciled session; ``model_calls`` one
recorded model-call observation; ``tool_calls`` one recorded tool-call
observation; ``entity_contributions`` one raw record's contribution to one
entity; ``session_diagnostics`` one reducer diagnostic on a session.

Deliberate 3NF departures: JSON payloads and mapping documents (immutable
documents), summary counts on ``imports`` (audit snapshot) and cached
observed bounds and counts on ``sessions`` (derived from children, documented).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import TypeDecorator


class UtcDateTime(TypeDecorator[datetime]):
    """Timezone-aware UTC datetimes; SQLite stores naive text, so we re-attach UTC."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Any) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("naive datetimes are not allowed; use UTC-aware values")
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect: Any) -> datetime | None:
        return None if value is None else value.replace(tzinfo=UTC)


class Base(DeclarativeBase):
    type_annotation_map = {datetime: UtcDateTime, dict[str, Any]: JSON, list[Any]: JSON}


class Source(Base):
    __tablename__ = "sources"
    namespace: Mapped[str] = mapped_column(String(100), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime]


class RawFile(Base):
    __tablename__ = "raw_files"
    sha256: Mapped[str] = mapped_column(String(64), primary_key=True)
    size_bytes: Mapped[int]
    storage_key: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime]


class Upload(Base):
    __tablename__ = "uploads"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    sha256: Mapped[str] = mapped_column(ForeignKey("raw_files.sha256"))
    filename: Mapped[str] = mapped_column(Text)
    format: Mapped[str] = mapped_column(String(20))
    record_count: Mapped[int]
    preview: Mapped[list[Any]]
    created_at: Mapped[datetime]


class Mapping(Base):
    __tablename__ = "mappings"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    source: Mapped[str] = mapped_column(String(100))
    revision: Mapped[int]
    created_by: Mapped[str] = mapped_column(String(200))
    input_format: Mapped[str] = mapped_column(String(20))
    document: Mapped[dict[str, Any]]
    content_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime]
    __table_args__ = (UniqueConstraint("name", "revision", name="uq_mappings_name_revision"),)


class Import(Base):
    __tablename__ = "imports"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    status: Mapped[str] = mapped_column(String(20))
    source: Mapped[str] = mapped_column(String(100))
    mapping_id: Mapped[str] = mapped_column(ForeignKey("mappings.id"))
    mapping_name: Mapped[str] = mapped_column(String(200))
    mapping_revision: Mapped[int]
    started_at: Mapped[datetime]
    finished_at: Mapped[datetime | None]
    records: Mapped[dict[str, Any]]
    entities: Mapped[dict[str, Any]]
    warnings: Mapped[dict[str, Any]]
    reject_count: Mapped[int]
    error: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (Index("ix_imports_started_at", "started_at"),)


class ImportFile(Base):
    __tablename__ = "import_files"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    import_id: Mapped[str] = mapped_column(ForeignKey("imports.id"))
    sha256: Mapped[str] = mapped_column(ForeignKey("raw_files.sha256"))
    filename: Mapped[str] = mapped_column(Text)
    size_bytes: Mapped[int]
    format: Mapped[str] = mapped_column(String(20))
    record_count: Mapped[int]
    __table_args__ = (Index("ix_import_files_sha256", "sha256"),)


class RawRecord(Base):
    __tablename__ = "raw_records"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    file_sha256: Mapped[str] = mapped_column(ForeignKey("raw_files.sha256"))
    locator: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict[str, Any] | None]
    __table_args__ = (UniqueConstraint("file_sha256", "locator", name="uq_raw_records_locator"),)


class RecordResult(Base):
    __tablename__ = "record_results"
    import_id: Mapped[str] = mapped_column(ForeignKey("imports.id"), primary_key=True)
    locator: Mapped[str] = mapped_column(String(64), primary_key=True)
    file_sha256: Mapped[str] = mapped_column(ForeignKey("raw_files.sha256"))
    outcome: Mapped[str] = mapped_column(String(20))
    entity_counts: Mapped[dict[str, Any]]
    warning_counts: Mapped[dict[str, Any]]


class Reject(Base):
    __tablename__ = "rejects"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    import_id: Mapped[str] = mapped_column(ForeignKey("imports.id"))
    locator: Mapped[str] = mapped_column(String(64))
    rule_id: Mapped[str] = mapped_column(String(100))
    path: Mapped[str] = mapped_column(String(200))
    code: Mapped[str] = mapped_column(String(60))
    field: Mapped[str | None] = mapped_column(String(100))
    message: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict[str, Any] | None]
    __table_args__ = (Index("ix_rejects_import_code", "import_id", "code"),)


class Session(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    source: Mapped[str] = mapped_column(String(100))
    external_id: Mapped[str] = mapped_column(String(300))
    agent: Mapped[str | None] = mapped_column(String(100))
    repo: Mapped[str | None] = mapped_column(String(300))
    user: Mapped[str | None] = mapped_column(String(300))
    declared_started_at: Mapped[datetime | None]
    declared_ended_at: Mapped[datetime | None]
    observed_start_at: Mapped[datetime | None]
    observed_end_at: Mapped[datetime | None]
    model_call_count: Mapped[int] = mapped_column(default=0)
    tool_call_count: Mapped[int] = mapped_column(default=0)
    __table_args__ = (
        UniqueConstraint("source", "external_id", name="uq_sessions_source_external_id"),
        Index("ix_sessions_agent", "agent"),
    )


class ModelCall(Base):
    __tablename__ = "model_calls"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"))
    import_id: Mapped[str] = mapped_column(ForeignKey("imports.id"))
    source: Mapped[str] = mapped_column(String(100))
    occurrence_key: Mapped[str] = mapped_column(String(400))
    file_sha256: Mapped[str] = mapped_column(String(64))
    locator: Mapped[str] = mapped_column(String(64))
    emission_path: Mapped[str] = mapped_column(String(200))
    native_key: Mapped[list[Any] | None]
    sequence: Mapped[int | None]
    provider: Mapped[str | None] = mapped_column(String(100))
    model: Mapped[str | None] = mapped_column(String(200))
    token_semantics: Mapped[str | None] = mapped_column(String(100))
    started_at: Mapped[datetime | None]
    ended_at: Mapped[datetime | None]
    input_tokens: Mapped[int | None]
    output_tokens: Mapped[int | None]
    cache_read_tokens: Mapped[int | None]
    cache_creation_tokens: Mapped[int | None]
    reasoning_tokens: Mapped[int | None]
    is_error: Mapped[bool | None] = mapped_column(Boolean)
    error_message: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (
        UniqueConstraint("source", "occurrence_key", name="uq_model_calls_occurrence"),
        Index("ix_model_calls_session", "session_id"),
    )


class ToolCall(Base):
    __tablename__ = "tool_calls"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"))
    model_call_id: Mapped[str | None] = mapped_column(ForeignKey("model_calls.id"))
    import_id: Mapped[str] = mapped_column(ForeignKey("imports.id"))
    source: Mapped[str] = mapped_column(String(100))
    occurrence_key: Mapped[str] = mapped_column(String(400))
    file_sha256: Mapped[str] = mapped_column(String(64))
    locator: Mapped[str] = mapped_column(String(64))
    emission_path: Mapped[str] = mapped_column(String(200))
    native_key: Mapped[list[Any] | None]
    sequence: Mapped[int | None]
    tool_name: Mapped[str] = mapped_column(String(200))
    started_at: Mapped[datetime | None]
    ended_at: Mapped[datetime | None]
    wall_latency_ms: Mapped[int | None]
    internal_latency_ms: Mapped[int | None]
    is_error: Mapped[bool | None] = mapped_column(Boolean)
    exit_code: Mapped[int | None]
    status: Mapped[str | None] = mapped_column(String(100))
    __table_args__ = (
        UniqueConstraint("source", "occurrence_key", name="uq_tool_calls_occurrence"),
        Index("ix_tool_calls_session", "session_id"),
        Index("ix_tool_calls_model_call", "model_call_id"),
    )


class EntityContribution(Base):
    __tablename__ = "entity_contributions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    import_id: Mapped[str] = mapped_column(ForeignKey("imports.id"))
    mapping_id: Mapped[str] = mapped_column(ForeignKey("mappings.id"))
    file_sha256: Mapped[str] = mapped_column(String(64))
    locator: Mapped[str] = mapped_column(String(64))
    emission_path: Mapped[str] = mapped_column(String(200))
    rule_id: Mapped[str] = mapped_column(String(100))
    session_id: Mapped[str | None] = mapped_column(ForeignKey("sessions.id"))
    model_call_id: Mapped[str | None] = mapped_column(ForeignKey("model_calls.id"))
    tool_call_id: Mapped[str | None] = mapped_column(ForeignKey("tool_calls.id"))
    __table_args__ = (
        CheckConstraint(
            "(session_id IS NOT NULL) + (model_call_id IS NOT NULL)"
            " + (tool_call_id IS NOT NULL) = 1",
            name="ck_contribution_exactly_one_entity",
        ),
        Index("ix_contributions_session", "session_id"),
    )


class SessionDiagnostic(Base):
    __tablename__ = "session_diagnostics"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"))
    import_id: Mapped[str] = mapped_column(ForeignKey("imports.id"))
    code: Mapped[str] = mapped_column(String(60))
    field: Mapped[str | None] = mapped_column(String(100))
    message: Mapped[str] = mapped_column(Text)
    locator: Mapped[str] = mapped_column(String(64))
