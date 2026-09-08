"""SQLAlchemy implementations of the application ports."""

from __future__ import annotations

import uuid
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any
from typing import cast as typing_cast

from sqlalchemy import Integer, cast, func, insert, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from agentscope_app.application.dto import (
    DIAGNOSTIC_MESSAGES,
    CachedProfile,
    DiagnosticCode,
    DiagnosticPeer,
    DiagnosticRow,
    FileInfo,
    ImportDiagnostic,
    ImportDiagnosticsPage,
    ImportRef,
    ImportReport,
    MappingRecord,
    MappingRef,
    Metric,
    ModelCallRow,
    RawRecordRef,
    RecordOutcome,
    RecordRow,
    RejectRow,
    RejectSummary,
    SessionDetail,
    SessionSummary,
    ToolCallRow,
    TraceStoreResult,
    UploadInfo,
)
from agentscope_app.application.dto import (
    RawRecord as RawRecordDTO,
)
from agentscope_app.application.errors import ConflictError, NotFoundError
from agentscope_app.domain.claims import ClaimCandidate, ClaimCondition, ConditionCode
from agentscope_app.application.metric_queries import AggregateRows, TraceScope, assemble_metric
from agentscope_app.domain.mapping.interpreter import Emission
from agentscope_app.domain.metrics import REGISTRY
from agentscope_app.domain.reducer import SessionAggregate
from agentscope_app.infrastructure.db import models as m
from agentscope_app.infrastructure.db.claims import ClaimIndex
from agentscope_app.infrastructure.db.trace_query import SqlAlchemyTraceQuery


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:20]}"


def _now() -> datetime:
    return datetime.now(UTC)


class SqlAlchemyUploads:
    def __init__(self, session: Session) -> None:
        self._s = session

    def add(self, info: UploadInfo) -> None:
        if self._s.get(m.RawFile, info.sha256) is None:
            self._s.add(
                m.RawFile(
                    sha256=info.sha256,
                    size_bytes=info.size_bytes,
                    storage_key="",
                    created_at=_now(),
                )
            )
        self._s.add(
            m.Upload(
                id=info.upload_id,
                sha256=info.sha256,
                filename=info.filename,
                format=info.format,
                record_count=info.record_count,
                preview=[
                    {"locator": r.locator, "payload": r.payload, "error": r.error}
                    for r in info.preview
                ],
                created_at=_now(),
            )
        )

    def get_profile(self, upload_id: str) -> CachedProfile | None:
        row = self._s.get(m.Upload, upload_id)
        if row is None or row.profile is None or row.profile_version is None:
            return None
        return CachedProfile(version=row.profile_version, profile=row.profile)

    def set_profile(self, upload_id: str, cached: CachedProfile) -> None:
        row = self._s.get(m.Upload, upload_id)
        if row is None:
            raise NotFoundError(f"Unknown upload {upload_id}")
        row.profile = cached.profile
        row.profile_version = cached.version

    def get(self, upload_id: str) -> UploadInfo | None:
        row = self._s.get(m.Upload, upload_id)
        if row is None:
            return None
        raw_file = self._s.get(m.RawFile, row.sha256)
        already = SqlAlchemyImports(self._s).find_committed_any(row.sha256)
        return UploadInfo(
            upload_id=row.id,
            filename=row.filename,
            sha256=row.sha256,
            size_bytes=raw_file.size_bytes if raw_file else 0,
            format=row.format,
            record_count=row.record_count,
            preview=tuple(
                RawRecordDTO(p["locator"], p.get("payload"), p.get("error")) for p in row.preview
            ),
            already_imported=tuple(already),
        )


class SqlAlchemyMappings:
    def __init__(self, session: Session) -> None:
        self._s = session

    @staticmethod
    def _to_dto(row: m.Mapping) -> MappingRecord:
        return MappingRecord(
            id=row.id,
            name=row.name,
            source=row.source,
            revision=row.revision,
            created_by=row.created_by,
            input_format=row.input_format,
            document=dict(row.document),
            content_hash=row.content_hash,
            created_at=row.created_at,
        )

    def list(self) -> Sequence[MappingRecord]:
        rows = self._s.scalars(select(m.Mapping).order_by(m.Mapping.name, m.Mapping.revision))
        return [self._to_dto(r) for r in rows]

    def get(self, mapping_id: str) -> MappingRecord | None:
        row = self._s.get(m.Mapping, mapping_id)
        return None if row is None else self._to_dto(row)

    def find_by_hash(self, content_hash: str) -> MappingRecord | None:
        row = self._s.scalar(select(m.Mapping).where(m.Mapping.content_hash == content_hash))
        return None if row is None else self._to_dto(row)

    def add(self, record: MappingRecord) -> None:
        self._s.add(
            m.Mapping(
                id=record.id,
                name=record.name,
                source=record.source,
                revision=record.revision,
                created_by=record.created_by,
                input_format=record.input_format,
                document=dict(record.document),
                content_hash=record.content_hash,
                created_at=record.created_at,
            )
        )
        try:
            self._s.flush()
        except IntegrityError as exc:
            raise ConflictError(
                "A mapping with the same content, or the same name and revision, "
                "was saved concurrently"
            ) from exc


class SqlAlchemyImports:
    def __init__(self, session: Session) -> None:
        self._s = session

    def find_committed(self, file_sha256: str, source: str) -> Sequence[ImportRef]:
        # The file row's own flag decides: an attempt can commit one file and skip
        # another as a duplicate.
        stmt = (
            select(m.Import)
            .join(m.ImportFile, m.ImportFile.import_id == m.Import.id)
            .where(
                m.ImportFile.sha256 == file_sha256,
                m.ImportFile.source == source,
                m.ImportFile.committed.is_(True),
            )
            .order_by(m.Import.started_at)
        )
        return [ImportRef(r.id, r.started_at) for r in self._s.scalars(stmt)]

    def find_committed_any(self, file_sha256: str) -> Sequence[ImportRef]:
        stmt = (
            select(m.Import)
            .join(m.ImportFile, m.ImportFile.import_id == m.Import.id)
            .where(m.ImportFile.sha256 == file_sha256, m.ImportFile.committed.is_(True))
            .order_by(m.Import.started_at)
        )
        return [ImportRef(r.id, r.started_at) for r in self._s.scalars(stmt)]

    def add_report(self, report: ImportReport) -> None:
        self._s.add(
            m.Import(
                id=report.import_id,
                status=report.status,
                source=report.source,
                mapping_id=report.mapping.id,
                mapping_name=report.mapping.name,
                mapping_revision=report.mapping.revision,
                started_at=report.started_at,
                finished_at=report.finished_at,
                records=dict(report.records),
                entities=dict(report.entities),
                warnings=dict(report.warnings),
                reject_count=report.reject_count,
                error=report.error,
                duplicate_detection_version=report.duplicate_detection_version,
            )
        )
        self._s.flush()  # parents before children: no relationships declare the order
        for f in report.files:
            if self._s.get(m.RawFile, f.sha256) is None:
                self._s.add(
                    m.RawFile(
                        sha256=f.sha256, size_bytes=f.size_bytes, storage_key="", created_at=_now()
                    )
                )
                self._s.flush()
            self._s.add(
                m.ImportFile(
                    id=_new_id("if"),
                    import_id=report.import_id,
                    sha256=f.sha256,
                    source=report.source,
                    committed=f.status == "committed",
                    filename=f.filename,
                    size_bytes=f.size_bytes,
                    format=f.format,
                    record_count=f.record_count,
                    mapping_id=f.mapping.id if f.mapping else report.mapping.id,
                    status=f.status,
                    records=dict(f.records),
                    warnings=dict(f.warnings),
                )
            )
        try:
            self._s.flush()
        except IntegrityError as exc:
            raise ConflictError(
                "Another import of the same bytes for this source was committed concurrently"
            ) from exc

    def update_report(self, report: ImportReport) -> None:
        row = self._s.get(m.Import, report.import_id)
        if row is None:
            raise KeyError(report.import_id)
        row.status = report.status
        row.finished_at = report.finished_at
        row.records = dict(report.records)
        row.entities = dict(report.entities)
        row.warnings = dict(report.warnings)
        row.reject_count = report.reject_count
        row.error = report.error
        row.duplicate_detection_version = report.duplicate_detection_version
        by_sha = {f.sha256: f for f in report.files}
        for f in self._s.scalars(
            select(m.ImportFile).where(m.ImportFile.import_id == report.import_id)
        ):
            info = by_sha.get(f.sha256)
            if info is None:
                continue
            f.status = info.status
            f.committed = info.status == "committed"
            f.records = dict(info.records)
            f.warnings = dict(info.warnings)
        try:
            self._s.flush()
        except IntegrityError as exc:
            raise ConflictError(
                "Another import of the same bytes for this source was committed concurrently"
            ) from exc

    def add_results(
        self, import_id: str, outcomes: Sequence[RecordOutcome], rejects: Sequence[RejectRow]
    ) -> None:
        raw_stmt = sqlite_insert(m.RawRecord).on_conflict_do_nothing(
            index_elements=["file_sha256", "locator"]
        )
        for chunk in _chunks(outcomes):
            self._s.execute(
                raw_stmt,
                [
                    {"file_sha256": o.file_sha256, "locator": o.locator, "payload": o.payload}
                    for o in chunk
                ],
            )
            self._s.execute(
                insert(m.RecordResult),
                [
                    {
                        "import_id": import_id,
                        "locator": o.locator,
                        "file_sha256": o.file_sha256,
                        "outcome": o.outcome,
                        "entity_counts": o.entity_counts,
                        "warning_counts": o.warning_counts,
                    }
                    for o in chunk
                ],
            )
        for chunk in _chunks(rejects):
            self._s.execute(
                insert(m.Reject),
                [
                    {
                        "import_id": import_id,
                        "file_sha256": r.file_sha256,
                        "locator": r.locator,
                        "rule_id": r.rule_id,
                        "path": r.path,
                        "code": r.code,
                        "field": r.field,
                        "message": r.message,
                        "payload": r.payload if isinstance(r.payload, dict) else None,
                    }
                    for r in chunk
                ],
            )

    def _to_dto(self, row: m.Import) -> ImportReport:
        files = self._s.scalars(select(m.ImportFile).where(m.ImportFile.import_id == row.id))
        conditions = self._conditions(row.id)
        return ImportReport(
            import_id=row.id,
            status=row.status,
            source=row.source,
            mapping=MappingRef(row.mapping_id, row.mapping_name, row.mapping_revision),
            started_at=row.started_at,
            finished_at=row.finished_at,
            files=tuple(
                FileInfo(
                    f.filename,
                    f.sha256,
                    f.size_bytes,
                    f.format,
                    f.record_count,
                    mapping=self._mapping_ref(f.mapping_id or row.mapping_id),
                    status=f.status,
                    records={k: int(v) for k, v in (f.records or {}).items()},
                    duplicate_of=self._original_of(f) if f.status == "duplicate" else None,
                    warnings=dict(f.warnings),
                    claim_conditions=tuple(c for c in conditions if c.file_sha256 == f.sha256),
                )
                for f in files
            ),
            records={k: int(v) for k, v in row.records.items()},
            entities={k: int(v) for k, v in row.entities.items()},
            warnings={k: int(v) for k, v in row.warnings.items()},
            reject_count=row.reject_count,
            error=row.error,
            duplicate_detection_version=row.duplicate_detection_version,
        )

    def add_claim_conditions(self, import_id: str, conditions: Sequence[ClaimCondition]) -> None:
        ClaimIndex(self._s.connection(), m.Base.metadata.tables).conditions(import_id, conditions)

    def _conditions(self, import_id: str) -> tuple[ClaimCondition, ...]:
        return tuple(
            ClaimCondition(
                r.file_sha256,
                r.rule_id,
                typing_cast(ConditionCode, r.code),
                r.affected_emissions,
                r.message,
            )
            for r in self._s.scalars(
                select(m.ImportClaimCondition)
                .where(m.ImportClaimCondition.import_id == import_id)
                .order_by(
                    m.ImportClaimCondition.file_sha256,
                    m.ImportClaimCondition.rule_id,
                    m.ImportClaimCondition.code,
                )
            )
        )

    def diagnostics(
        self,
        import_id: str,
        code: str | None,
        file_sha256: str | None,
        locator: str | None,
        limit: int,
        offset: int,
    ) -> ImportDiagnosticsPage:
        claim, peer, diagnostic = (
            m.EntityClaim.__table__,
            m.EntityClaim.__table__.alias("peer"),
            m.ImportDiagnostic.__table__,
        )
        joined = diagnostic.join(claim, claim.c.id == diagnostic.c.claim_id).join(
            peer, peer.c.id == diagnostic.c.peer_claim_id
        )
        filters = [diagnostic.c.import_id == import_id]
        if code is not None:
            filters.append(diagnostic.c.code == code)
        if file_sha256 is not None:
            filters.append(claim.c.file_sha256 == file_sha256)
        if locator is not None:
            filters.append(claim.c.locator == locator)
        total = self._s.scalar(select(func.count()).select_from(joined).where(*filters)) or 0
        stmt = (
            select(
                claim,
                diagnostic.c.code,
                *[
                    peer.c[key].label("peer_" + key)
                    for key in ("import_id", "file_sha256", "locator", "emission_path", "entity")
                ],
            )
            .select_from(joined)
            .where(*filters)
            .order_by(
                claim.c.file_sha256,
                claim.c.locator_position,
                claim.c.locator,
                claim.c.emission_path,
                claim.c.entity,
                diagnostic.c.code,
            )
            .limit(limit)
            .offset(offset)
        )
        return ImportDiagnosticsPage(
            tuple(_claim_diagnostic(dict(r)) for r in self._s.execute(stmt).mappings()),
            total,
            tuple(
                c
                for c in self._conditions(import_id)
                if file_sha256 is None or c.file_sha256 == file_sha256
            ),
        )

    def _original_of(self, f: m.ImportFile) -> str | None:
        """The earliest committed import of these bytes for this source, other than this one."""
        for ref in self.find_committed(f.sha256, f.source):
            if ref.import_id != f.import_id:
                return ref.import_id
        return None

    def _mapping_ref(self, mapping_id: str) -> MappingRef:
        row = self._s.get(m.Mapping, mapping_id)
        if row is None:
            return MappingRef(mapping_id, mapping_id, 0)
        return MappingRef(row.id, row.name, row.revision)

    def get(self, import_id: str) -> ImportReport | None:
        row = self._s.get(m.Import, import_id)
        return None if row is None else self._to_dto(row)

    def list(self, limit: int, offset: int) -> Sequence[ImportReport]:
        stmt = select(m.Import).order_by(m.Import.started_at.desc()).limit(limit).offset(offset)
        return [self._to_dto(r) for r in self._s.scalars(stmt)]

    def rejects(
        self,
        import_id: str,
        code: str | None,
        file_sha256: str | None,
        rule_id: str | None,
        limit: int,
        offset: int,
    ) -> Sequence[RejectRow]:
        stmt = select(m.Reject).where(m.Reject.import_id == import_id)
        if code:
            stmt = stmt.where(m.Reject.code == code)
        if file_sha256:
            stmt = stmt.where(m.Reject.file_sha256 == file_sha256)
        if rule_id:
            stmt = stmt.where(m.Reject.rule_id == rule_id)
        stmt = stmt.order_by(m.Reject.id).limit(limit).offset(offset)
        return [
            RejectRow(
                r.locator,
                r.rule_id,
                r.path,
                r.code,
                r.field,
                r.message,
                r.payload,
                file_sha256=r.file_sha256,
            )
            for r in self._s.scalars(stmt)
        ]

    def reject_summary(self, import_id: str) -> RejectSummary:
        def counts(column: Any) -> dict[str, int]:
            stmt = (
                select(column, func.count())
                .where(m.Reject.import_id == import_id)
                .group_by(column)
                .order_by(func.count().desc(), column)
            )
            return {str(key): int(n) for key, n in self._s.execute(stmt)}

        outcomes_stmt = (
            select(m.RecordResult.outcome, func.count())
            .where(m.RecordResult.import_id == import_id)
            .group_by(m.RecordResult.outcome)
        )
        outcomes = {str(k): int(n) for k, n in self._s.execute(outcomes_stmt)}
        return RejectSummary(
            codes=counts(m.Reject.code),
            rules=counts(m.Reject.rule_id),
            files=counts(m.Reject.file_sha256),
            outcomes=outcomes,
        )

    def records(
        self,
        import_id: str,
        outcome: str | None,
        file_sha256: str | None,
        limit: int,
        offset: int,
    ) -> Sequence[RecordRow]:
        stmt = select(m.RecordResult).where(m.RecordResult.import_id == import_id)
        if outcome:
            stmt = stmt.where(m.RecordResult.outcome == outcome)
        if file_sha256:
            stmt = stmt.where(m.RecordResult.file_sha256 == file_sha256)
        # Locators are ``line:N`` / ``row:N``: order by the number, not the text.
        position = cast(
            func.substr(m.RecordResult.locator, func.instr(m.RecordResult.locator, ":") + 1),
            Integer,
        )
        stmt = (
            stmt.order_by(m.RecordResult.file_sha256, position, m.RecordResult.locator)
            .limit(limit)
            .offset(offset)
        )
        return [
            RecordRow(
                r.file_sha256,
                r.locator,
                r.outcome,
                {k: int(v) for k, v in r.entity_counts.items()},
                {k: int(v) for k, v in r.warning_counts.items()},
            )
            for r in self._s.scalars(stmt)
        ]


class SqlAlchemyTraces:
    def __init__(self, session: Session) -> None:
        self._s = session

    def existing_sessions(
        self, source: str, external_ids: Sequence[str]
    ) -> dict[str, SessionAggregate]:
        if not external_ids:
            return {}
        rows = self._s.scalars(
            select(m.Session).where(
                m.Session.source == source, m.Session.external_id.in_(list(external_ids))
            )
        )
        return {
            row.external_id: SessionAggregate(
                external_id=row.external_id,
                agent=row.agent,
                repo=row.repo,
                user=row.user,
                declared_started_at=row.declared_started_at,
                declared_ended_at=row.declared_ended_at,
                observed_start_at=row.observed_start_at,
                observed_end_at=row.observed_end_at,
                model_call_count=row.model_call_count,
                tool_call_count=row.tool_call_count,
            )
            for row in rows
        }

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
        try:
            counts = self._store(import_id, source, bindings, emissions, sessions)
        except IntegrityError as exc:
            message = str(exc.orig)
            occurrence_constraints = (
                "UNIQUE constraint failed: model_calls.source, model_calls.occurrence_key",
                "UNIQUE constraint failed: tool_calls.source, tool_calls.occurrence_key",
            )
            if not any(message == constraint for constraint in occurrence_constraints):
                raise
            raise ConflictError(
                "Another import of the same bytes for this source is already committed"
            ) from exc
        index = ClaimIndex(self._s.connection(), m.Base.metadata.tables)
        index.stage(import_id, bindings, claims)
        diagnostics = tuple(_claim_diagnostic(r) for r in index.detect(import_id)) if claims else ()
        return TraceStoreResult(counts, diagnostics)

    def _store(
        self,
        import_id: str,
        source: str,
        bindings: Mapping[str, str],
        emissions: Sequence[Emission],
        sessions: dict[str, SessionAggregate],
    ) -> dict[str, int]:
        counts = {"session": 0, "model_call": 0, "tool_call": 0}
        session_ids = self._upsert_sessions(source, sessions, import_id, counts)
        contributions: list[dict[str, Any]] = []
        model_call_ids: dict[str, str] = {}  # occurrence key -> id
        model_rows: list[dict[str, Any]] = []
        tool_rows: list[dict[str, Any]] = []
        for e in emissions:
            f = e.fields
            if e.entity == "session":
                sid = session_ids.get(str(f.get("external_id")))
                if sid is not None:
                    contributions.append(
                        self._contribution(
                            e, import_id, bindings[e.occurrence.file_sha256], session_id=sid
                        )
                    )
                continue
            sid = session_ids.get(str(f.get("session_external_id")))
            if sid is None:
                continue
            if e.entity == "model_call":
                row_id = _new_id("mc")
                model_call_ids[e.occurrence.key] = row_id
                model_rows.append(
                    {
                        "id": row_id,
                        "session_id": sid,
                        "import_id": import_id,
                        "source": source,
                        "occurrence_key": e.occurrence.key,
                        "file_sha256": e.occurrence.file_sha256,
                        "locator": e.occurrence.locator,
                        "emission_path": e.occurrence.emission_path,
                        "native_key": list(e.native_key) if e.native_key else None,
                        "sequence": f.get("sequence"),
                        "provider": f.get("provider"),
                        "model": f.get("model"),
                        "token_semantics": f.get("token_semantics"),
                        "started_at": _bind_dt(f.get("started_at")),
                        "ended_at": _bind_dt(f.get("ended_at")),
                        "input_tokens": f.get("input_tokens"),
                        "output_tokens": f.get("output_tokens"),
                        "cache_read_tokens": f.get("cache_read_tokens"),
                        "cache_creation_tokens": f.get("cache_creation_tokens"),
                        "reasoning_tokens": f.get("reasoning_tokens"),
                        "is_error": f.get("is_error"),
                        "error_message": f.get("error_message"),
                    }
                )
                contributions.append(
                    self._contribution(
                        e, import_id, bindings[e.occurrence.file_sha256], model_call_id=row_id
                    )
                )
            elif e.entity == "tool_call":
                row_id = _new_id("tc")
                parent = e.parent_occurrence.key if e.parent_occurrence else None
                tool_rows.append(
                    {
                        "id": row_id,
                        "session_id": sid,
                        "model_call_id": model_call_ids.get(parent) if parent else None,
                        "import_id": import_id,
                        "source": source,
                        "occurrence_key": e.occurrence.key,
                        "file_sha256": e.occurrence.file_sha256,
                        "locator": e.occurrence.locator,
                        "emission_path": e.occurrence.emission_path,
                        "native_key": list(e.native_key) if e.native_key else None,
                        "sequence": f.get("sequence"),
                        "tool_name": f.get("tool_name"),
                        "started_at": _bind_dt(f.get("started_at")),
                        "ended_at": _bind_dt(f.get("ended_at")),
                        "wall_latency_ms": f.get("wall_latency_ms"),
                        "internal_latency_ms": f.get("internal_latency_ms"),
                        "is_error": f.get("is_error"),
                        "exit_code": f.get("exit_code"),
                        "status": f.get("status"),
                    }
                )
                contributions.append(
                    self._contribution(
                        e, import_id, bindings[e.occurrence.file_sha256], tool_call_id=row_id
                    )
                )
        for chunk in _chunks(model_rows):
            self._s.execute(insert(m.ModelCall), chunk)
        counts["model_call"] = len(model_rows)
        for chunk in _chunks(tool_rows):
            self._s.execute(insert(m.ToolCall), chunk)
        counts["tool_call"] = len(tool_rows)
        for chunk in _chunks(contributions):
            self._s.execute(insert(m.EntityContribution), chunk)
        self._s.flush()
        return {k: v for k, v in counts.items() if v}

    @staticmethod
    def _contribution(
        e: Emission,
        import_id: str,
        mapping_id: str,
        *,
        session_id: str | None = None,
        model_call_id: str | None = None,
        tool_call_id: str | None = None,
    ) -> dict[str, Any]:
        return {
            "import_id": import_id,
            "mapping_id": mapping_id,
            "file_sha256": e.occurrence.file_sha256,
            "locator": e.occurrence.locator,
            "emission_path": e.occurrence.emission_path,
            "rule_id": e.rule_id,
            "session_id": session_id,
            "model_call_id": model_call_id,
            "tool_call_id": tool_call_id,
        }

    def _upsert_sessions(
        self,
        source: str,
        sessions: dict[str, SessionAggregate],
        import_id: str,
        counts: dict[str, int],
    ) -> dict[str, str]:
        ids: dict[str, str] = {}
        if not sessions:
            return ids
        existing = {
            row.external_id: row
            for row in self._s.scalars(
                select(m.Session).where(
                    m.Session.source == source, m.Session.external_id.in_(list(sessions))
                )
            )
        }
        for external_id, agg in sessions.items():
            row = existing.get(external_id)
            if row is None:
                row = m.Session(
                    id=_new_id("ses"),
                    source=source,
                    external_id=external_id,
                    agent=agg.agent,
                    repo=agg.repo,
                    user=agg.user,
                    declared_started_at=agg.declared_started_at,
                    declared_ended_at=agg.declared_ended_at,
                    observed_start_at=agg.observed_start_at,
                    observed_end_at=agg.observed_end_at,
                    model_call_count=agg.model_call_count,
                    tool_call_count=agg.tool_call_count,
                )
                self._s.add(row)
                counts["session"] += 1
            else:
                # The aggregate is the full new state (the reducer was seeded with
                # this row), so the columns are simply replaced.
                row.agent = agg.agent
                row.repo = agg.repo
                row.user = agg.user
                row.declared_started_at = agg.declared_started_at
                row.declared_ended_at = agg.declared_ended_at
                row.observed_start_at = agg.observed_start_at
                row.observed_end_at = agg.observed_end_at
                row.model_call_count = agg.model_call_count
                row.tool_call_count = agg.tool_call_count
            ids[external_id] = row.id
            for d in agg.conflicts:
                self._s.add(
                    m.SessionDiagnostic(
                        session_id=row.id,
                        import_id=import_id,
                        code=d.code,
                        field=d.field,
                        message=d.message,
                        locator=d.occurrence.locator,
                    )
                )
        self._s.flush()
        return ids

    def _summary(self, row: m.Session, metrics: dict[str, AggregateRows]) -> SessionSummary:
        def metric(metric_id: str) -> Metric:
            return assemble_metric(REGISTRY.get(metric_id), metrics.get(metric_id, AggregateRows()))

        return SessionSummary(
            id=row.id,
            source=row.source,
            external_id=row.external_id,
            agent=row.agent,
            observed_start_at=row.observed_start_at,
            observed_end_at=row.observed_end_at,
            model_call_count=int(metric("model_calls").value or 0),
            tool_call_count=int(metric("tool_calls").value or 0),
            input_tokens=metric("input_tokens"),
        )

    def list_sessions(
        self, *, source: str | None, agent: str | None, limit: int, offset: int
    ) -> Sequence[SessionSummary]:
        stmt = select(m.Session)
        if source is not None:
            stmt = stmt.where(m.Session.source == source)
        if agent is not None:
            stmt = stmt.where(m.Session.agent == agent)
        stmt = (
            stmt.order_by(m.Session.observed_start_at.desc().nulls_last(), m.Session.id)
            .limit(limit)
            .offset(offset)
        )
        rows = list(self._s.scalars(stmt))
        metrics = SqlAlchemyTraceQuery(self._s).session_metrics(
            TraceScope(source=source, agent=agent, session_ids=tuple(r.id for r in rows))
        )
        return [self._summary(r, metrics.get(r.id, {})) for r in rows]

    def get_session(self, session_id: str) -> SessionDetail | None:
        row = self._s.get(m.Session, session_id)
        if row is None:
            return None
        calls = self._s.scalars(
            select(m.ModelCall)
            .where(m.ModelCall.session_id == session_id)
            .order_by(m.ModelCall.started_at.nulls_last(), m.ModelCall.sequence, m.ModelCall.id)
        ).all()
        tools = self._s.scalars(
            select(m.ToolCall)
            .where(m.ToolCall.session_id == session_id)
            .order_by(m.ToolCall.started_at.nulls_last(), m.ToolCall.sequence, m.ToolCall.id)
        ).all()
        diagnostics = self._s.scalars(
            select(m.SessionDiagnostic).where(m.SessionDiagnostic.session_id == session_id)
        ).all()
        return SessionDetail(
            summary=self._summary(
                row,
                SqlAlchemyTraceQuery(self._s)
                .session_metrics(TraceScope(session_ids=(row.id,)))
                .get(row.id, {}),
            ),
            declared_started_at=row.declared_started_at,
            declared_ended_at=row.declared_ended_at,
            repo=row.repo,
            user=row.user,
            model_calls=tuple(
                ModelCallRow(
                    id=c.id,
                    sequence=c.sequence,
                    provider=c.provider,
                    model=c.model,
                    started_at=c.started_at,
                    ended_at=c.ended_at,
                    input_tokens=c.input_tokens,
                    output_tokens=c.output_tokens,
                    cache_read_tokens=c.cache_read_tokens,
                    cache_creation_tokens=c.cache_creation_tokens,
                    reasoning_tokens=c.reasoning_tokens,
                    token_semantics=c.token_semantics,
                    is_error=c.is_error,
                    raw_record=RawRecordRef(c.file_sha256, c.locator),
                )
                for c in calls
            ),
            tool_calls=tuple(
                ToolCallRow(
                    id=t.id,
                    model_call_id=t.model_call_id,
                    sequence=t.sequence,
                    tool_name=t.tool_name,
                    started_at=t.started_at,
                    ended_at=t.ended_at,
                    wall_latency_ms=t.wall_latency_ms,
                    internal_latency_ms=t.internal_latency_ms,
                    is_error=t.is_error,
                    exit_code=t.exit_code,
                    status=t.status,
                    raw_record=RawRecordRef(t.file_sha256, t.locator),
                )
                for t in tools
            ),
            diagnostics=tuple(DiagnosticRow(d.code, d.field, d.message) for d in diagnostics),
        )

    def raw_record(self, file_sha256: str, locator: str) -> Any:
        row = self._s.scalar(
            select(m.RawRecord).where(
                m.RawRecord.file_sha256 == file_sha256, m.RawRecord.locator == locator
            )
        )
        return None if row is None else row.payload


INSERT_CHUNK = 500  # rows per executemany batch, well under SQLite's bound-parameter limit


def _chunks(rows: Sequence[Any]) -> list[Sequence[Any]]:
    return [rows[i : i + INSERT_CHUNK] for i in range(0, len(rows), INSERT_CHUNK)]


def _bind_dt(value: Any) -> datetime | None:
    return value if isinstance(value, datetime) else None


def _claim_diagnostic(row: Mapping[str, Any]) -> ImportDiagnostic:
    return ImportDiagnostic(
        row["file_sha256"],
        row["locator"],
        row["emission_path"],
        row["rule_id"],
        row["entity"],
        typing_cast(DiagnosticCode, row["code"]),
        DIAGNOSTIC_MESSAGES[row["code"]],
        DiagnosticPeer(
            row["peer_import_id"],
            row["peer_file_sha256"],
            row["peer_locator"],
            row["peer_emission_path"],
            row["peer_entity"],
        ),
    )
