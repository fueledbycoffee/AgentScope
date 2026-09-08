"""HTTP routes implementing docs/api/v0.1.md. Thin: parse, call a use case, serialise."""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, File, Query, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool

from agentscope_app.application.dto import (
    MAX_UPLOAD_BYTES,
    AssistantOutcome,
    FileBinding,
    ImportDiagnosticsPage,
    ImportReport,
    MappingRecord,
    MetricsSummary,
    PreviewReport,
    ProfileReport,
    RecordRow,
    RejectRow,
    RejectSummary,
    SessionSummary,
    UploadInfo,
)
from agentscope_app.application.errors import LimitExceededError
from agentscope_app.application.metric_queries import MetricQueryResult, TraceScope, invalid
from agentscope_app.domain.jsonx import dumps_exact
from agentscope_app.domain.mapping.parser import parse_mapping
from agentscope_app.domain.metrics import Dimension, EntityGrain
from agentscope_app.interfaces.api.container import Container
from agentscope_app.interfaces.api.schemas import (
    AssistantRequestBody,
    AssistantRunBody,
    ImportRequest,
    PreviewRequest,
    SaveMappingBody,
)

router = APIRouter(prefix="/api")
SCHEMA_PATH = (
    Path(__file__).resolve().parents[2] / "domain" / "mapping" / "mapping-dsl-v1.schema.json"
)

Limit = Annotated[int, Query(ge=1, le=500)]
Offset = Annotated[int, Query(ge=0)]


def _c(request: Request) -> Container:
    container: Container = request.app.state.container
    return container


@router.post("/uploads", status_code=201)
async def create_upload(request: Request, file: Annotated[UploadFile, File()]) -> UploadInfo:
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise LimitExceededError(f"File exceeds {MAX_UPLOAD_BYTES} bytes (25 MiB)")
    # Hashing, decoding and counting are CPU work: keep them off the event loop.
    return await run_in_threadpool(
        _c(request).store_upload.execute, file.filename or "upload", data
    )


@router.post("/uploads/{upload_id}/profile")
async def profile_upload(request: Request, upload_id: str) -> ProfileReport:
    return await run_in_threadpool(_c(request).profile_file.execute, upload_id)


@router.post("/assistant/prepare")
async def prepare_assistant_context(request: Request, body: AssistantRequestBody) -> dict[str, Any]:
    prepared = await run_in_threadpool(_c(request).prepare_context.execute, body.to_request())
    return {
        "kind": prepared.kind,
        "context_sha256": prepared.sha256,
        "bytes": prepared.bytes,
        "payload_text": prepared.text,
        "payload": prepared.document,
        "redactions": prepared.redactions,
        "truncated": prepared.truncated,
        "sample_included": prepared.sample_included,
        "sample_count": prepared.sample_count,
    }


@router.post("/assistant/run")
async def run_assistant(request: Request, body: AssistantRunBody) -> AssistantOutcome:
    return await run_in_threadpool(
        _c(request).run_assistant.execute, body.to_request(), body.context_sha256
    )


@router.get("/mappings/schema")
def mapping_schema() -> dict[str, Any]:
    """The DSL v1 JSON Schema, for client-side shape checks in the assistant UI."""
    schema: dict[str, Any] = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    return schema


@router.post("/mappings/validate")
def validate_mapping(body: SaveMappingBody) -> dict[str, Any]:
    """Validation issues of a document without saving it (the same stages as a save)."""
    parsed = parse_mapping(body.document)
    return {
        "issues": [asdict(issue) for issue in parsed.issues],
        "executable": parsed.is_executable,
    }


@router.post("/mappings")
def save_mapping(request: Request, body: SaveMappingBody, response: Response) -> dict[str, Any]:
    saved = _c(request).save_mapping.execute(body.document, created_by="user")
    response.status_code = 201 if saved.created else 200
    return {**_mapping_summary(saved.record), "created": saved.created}


@router.get("/mappings")
def list_mappings(request: Request) -> list[dict[str, Any]]:
    return [_mapping_summary(m) for m in _c(request).list_mappings.execute()]


@router.get("/mappings/{mapping_id}")
def get_mapping(request: Request, mapping_id: str) -> dict[str, Any]:
    record = _c(request).get_mapping.execute(mapping_id)
    parsed = parse_mapping(record.document)
    return {
        **_mapping_summary(record),
        "document": record.document,
        "issues": [asdict(issue) for issue in parsed.issues],
    }


def _mapping_summary(m: MappingRecord) -> dict[str, Any]:
    return {
        "id": m.id,
        "name": m.name,
        "source": m.source,
        "revision": m.revision,
        "created_by": m.created_by,
        "input_format": m.input_format,
        "created_at": m.created_at,
    }


@router.post("/imports/preview")
def preview_import(request: Request, body: PreviewRequest) -> PreviewReport:
    return _c(request).preview_import.execute(body.upload_id, body.mapping_id, body.sample)


@router.post("/imports", status_code=201)
def create_import(request: Request, body: ImportRequest) -> ImportReport:
    bindings = [FileBinding(b.upload_id, b.mapping_id) for b in body.bindings()]
    return _c(request).commit_import.execute(body.source, bindings)


@router.get("/imports")
def list_imports(request: Request, limit: Limit = 50, offset: Offset = 0) -> list[ImportReport]:
    return list(_c(request).list_imports.execute(limit, offset))


@router.get("/imports/{import_id}")
def get_import(request: Request, import_id: str) -> ImportReport:
    return _c(request).get_import.execute(import_id)


@router.get("/imports/{import_id}/rejects")
def list_rejects(
    request: Request,
    import_id: str,
    code: str | None = None,
    file_sha256: str | None = None,
    rule_id: str | None = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> list[RejectRow]:
    return list(
        _c(request).list_rejects.execute(import_id, code, file_sha256, rule_id, limit, offset)
    )


@router.get("/imports/{import_id}/rejects/summary")
def reject_summary(request: Request, import_id: str) -> RejectSummary:
    return _c(request).reject_summary.execute(import_id)


@router.get("/imports/{import_id}/records")
def list_records(
    request: Request,
    import_id: str,
    outcome: str | None = None,
    file_sha256: str | None = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> list[RecordRow]:
    return list(_c(request).list_records.execute(import_id, outcome, file_sha256, limit, offset))


@router.get("/sessions")
def list_sessions(
    request: Request,
    source: str | None = None,
    agent: str | None = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> list[SessionSummary]:
    return list(
        _c(request).list_sessions.execute(source=source, agent=agent, limit=limit, offset=offset)
    )


@router.get("/sessions/{session_id}")
def get_session(request: Request, session_id: str) -> dict[str, Any]:
    detail = _c(request).get_session.execute(session_id)
    body = asdict(detail)
    summary = body.pop("summary")
    return {**summary, **body}  # the contract flattens the summary into the detail


@router.get("/raw-records")
def get_raw_record(request: Request, file_sha256: str, locator: str) -> dict[str, Any]:
    payload = _c(request).get_raw_record.execute(file_sha256, locator)
    return {
        "file_sha256": file_sha256,
        "locator": locator,
        "payload": payload,
        "payload_text": dumps_exact(payload, indent=2),
        # Parquet rows are decoded values, not source bytes; the UI labels them so.
        "derived": "parquet-row" if locator.startswith("row:") else None,
    }


@router.get("/metrics/summary")
def metrics_summary(
    request: Request, source: str | None = None, agent: str | None = None
) -> MetricsSummary:
    return _c(request).metrics_summary.execute(source=source, agent=agent)


@router.get("/imports/{import_id}/diagnostics")
def list_import_diagnostics(
    request: Request,
    import_id: str,
    code: str | None = None,
    file_sha256: str | None = None,
    locator: str | None = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> ImportDiagnosticsPage:
    return _c(request).list_import_diagnostics.execute(
        import_id, code, file_sha256, locator, limit, offset
    )


@router.get("/metrics/definitions")
def metric_definitions(request: Request) -> list[dict[str, Any]]:
    return _c(request).list_metric_definitions.execute()


@router.get("/metrics/query")
def query_metric(
    request: Request,
    metric_id: str,
    group_by: Annotated[list[Dimension] | None, Query()] = None,
    source: str | None = None,
    agent: str | None = None,
    model: str | None = None,
    tool: str | None = None,
    started_from: datetime | None = None,
    started_before: datetime | None = None,
    started_through: datetime | None = None,
    import_id: str | None = None,
    activity_grain: EntityGrain | None = None,
    token_semantics: str | None = None,
    model_is_unknown: bool = False,
    agent_is_unknown: bool = False,
    timestamp_missing: bool = False,
    tool_is_unlinked: bool = False,
    usage_missing: bool = False,
    tool_is_linked: bool = False,
    witness_time_override: bool = False,
    witness_required: bool = False,
    witness_started_from: datetime | None = None,
    witness_started_before: datetime | None = None,
    witness_started_through: datetime | None = None,
    witness_timestamp_missing: bool = False,
) -> MetricQueryResult:
    allowed = {
        "metric_id",
        "group_by",
        "source",
        "agent",
        "model",
        "tool",
        "started_from",
        "started_before",
        "started_through",
        "import_id",
        "activity_grain",
        "token_semantics",
        "model_is_unknown",
        "agent_is_unknown",
        "timestamp_missing",
        "tool_is_unlinked",
        "usage_missing",
        "tool_is_linked",
        "witness_time_override",
        "witness_required",
        "witness_started_from",
        "witness_started_before",
        "witness_started_through",
        "witness_timestamp_missing",
    }
    for name in request.query_params:
        if name not in allowed:
            raise invalid(f"query.{name}", "Unknown metric query parameter")
        if name != "group_by" and len(request.query_params.getlist(name)) > 1:
            raise invalid(f"query.{name}", "Only group_by can be repeated")
    scope = TraceScope(
        source=source,
        agent=agent,
        model=model,
        tool=tool,
        started_from=started_from,
        started_before=started_before,
        started_through=started_through,
        import_id=import_id,
        activity_grain=activity_grain,
        token_semantics=token_semantics,
        model_is_unknown=model_is_unknown,
        agent_is_unknown=agent_is_unknown,
        timestamp_missing=timestamp_missing,
        tool_is_unlinked=tool_is_unlinked,
        usage_missing=usage_missing,
        tool_is_linked=tool_is_linked,
        witness_time_override=witness_time_override,
        witness_required=witness_required,
        witness_started_from=witness_started_from,
        witness_started_before=witness_started_before,
        witness_started_through=witness_started_through,
        witness_timestamp_missing=witness_timestamp_missing,
    )
    return _c(request).query_metric.execute(metric_id, scope, tuple(group_by or ()))
