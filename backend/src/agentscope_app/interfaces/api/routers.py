"""HTTP routes implementing docs/api/v0.1.md. Thin: parse, call a use case, serialise."""

from __future__ import annotations

from dataclasses import asdict
from typing import Annotated, Any

from fastapi import APIRouter, File, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool

from agentscope_app.application.dto import (
    MAX_UPLOAD_BYTES,
    FileBinding,
    ImportReport,
    MappingRecord,
    MetricsSummary,
    PreviewReport,
    RejectRow,
    SessionSummary,
    UploadInfo,
)
from agentscope_app.application.errors import LimitExceededError
from agentscope_app.domain.mapping.parser import parse_mapping
from agentscope_app.infrastructure.jsonx import dumps_exact
from agentscope_app.interfaces.api.container import Container
from agentscope_app.interfaces.api.schemas import ImportRequest, PreviewRequest

router = APIRouter(prefix="/api")

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
    limit: Limit = 50,
    offset: Offset = 0,
) -> list[RejectRow]:
    return list(_c(request).list_rejects.execute(import_id, code, file_sha256, limit, offset))


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
