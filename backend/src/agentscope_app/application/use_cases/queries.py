"""Read-side use cases: thin, but they own the metric definitions' wording."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from agentscope_app.application.dto import (
    Coverage,
    ImportReport,
    MappingRecord,
    Metric,
    RejectRow,
    SessionDetail,
    SessionSummary,
)
from agentscope_app.application.dto import (
    MetricsSummary as MetricsSummaryDTO,
)
from agentscope_app.application.errors import NotFoundError
from agentscope_app.application.ports import UnitOfWorkFactory

MAX_PAGE = 500


def _page(limit: int, offset: int) -> tuple[int, int]:
    return max(1, min(limit, MAX_PAGE)), max(0, offset)


class ListMappings:
    def __init__(self, uow_factory: UnitOfWorkFactory) -> None:
        self._uow_factory = uow_factory

    def execute(self) -> Sequence[MappingRecord]:
        with self._uow_factory() as uow:
            return list(uow.mappings.list())


class GetMapping:
    def __init__(self, uow_factory: UnitOfWorkFactory) -> None:
        self._uow_factory = uow_factory

    def execute(self, mapping_id: str) -> MappingRecord:
        with self._uow_factory() as uow:
            record = uow.mappings.get(mapping_id)
        if record is None:
            raise NotFoundError(f"Mapping {mapping_id!r} does not exist")
        return record


class ListImports:
    def __init__(self, uow_factory: UnitOfWorkFactory) -> None:
        self._uow_factory = uow_factory

    def execute(self, limit: int = 50, offset: int = 0) -> Sequence[ImportReport]:
        limit, offset = _page(limit, offset)
        with self._uow_factory() as uow:
            return list(uow.imports.list(limit, offset))


class GetImport:
    def __init__(self, uow_factory: UnitOfWorkFactory) -> None:
        self._uow_factory = uow_factory

    def execute(self, import_id: str) -> ImportReport:
        with self._uow_factory() as uow:
            report = uow.imports.get(import_id)
        if report is None:
            raise NotFoundError(f"Import {import_id!r} does not exist")
        return report


class ListRejects:
    def __init__(self, uow_factory: UnitOfWorkFactory) -> None:
        self._uow_factory = uow_factory

    def execute(
        self, import_id: str, code: str | None = None, limit: int = 50, offset: int = 0
    ) -> Sequence[RejectRow]:
        limit, offset = _page(limit, offset)
        with self._uow_factory() as uow:
            if uow.imports.get(import_id) is None:
                raise NotFoundError(f"Import {import_id!r} does not exist")
            return list(uow.imports.rejects(import_id, code, limit, offset))


class ListSessions:
    def __init__(self, uow_factory: UnitOfWorkFactory) -> None:
        self._uow_factory = uow_factory

    def execute(
        self, *, source: str | None, agent: str | None, limit: int = 50, offset: int = 0
    ) -> Sequence[SessionSummary]:
        limit, offset = _page(limit, offset)
        with self._uow_factory() as uow:
            return list(
                uow.traces.list_sessions(source=source, agent=agent, limit=limit, offset=offset)
            )


class GetSession:
    def __init__(self, uow_factory: UnitOfWorkFactory) -> None:
        self._uow_factory = uow_factory

    def execute(self, session_id: str) -> SessionDetail:
        with self._uow_factory() as uow:
            detail = uow.traces.get_session(session_id)
        if detail is None:
            raise NotFoundError(f"Session {session_id!r} does not exist")
        return detail


class GetRawRecord:
    def __init__(self, uow_factory: UnitOfWorkFactory) -> None:
        self._uow_factory = uow_factory

    def execute(self, file_sha256: str, locator: str) -> Any:
        with self._uow_factory() as uow:
            payload = uow.traces.raw_record(file_sha256, locator)
        if payload is None:
            raise NotFoundError(f"No raw record {locator!r} in file {file_sha256[:12]}…")
        return payload


DEFINITIONS = {
    "sessions": "Distinct sessions in scope (reconciled by source and external_id).",
    "model_calls": (
        "Recorded model-call observations in scope; one source row can be one observation."
    ),
    "tool_calls": "Recorded tool-call observations in scope.",
    "input_tokens": (
        "Sum of input_tokens over model calls that have a known value, in scope. Coverage is the"
        " number of calls with a known value over all calls in scope. Values are only comparable"
        " within one token_semantics tag; by_semantics splits the sum accordingly."
    ),
}


class MetricsSummary:
    """Day-1 subset of the metric layer; the full definitions module is issue #10."""

    def __init__(self, uow_factory: UnitOfWorkFactory) -> None:
        self._uow_factory = uow_factory

    def execute(self, *, source: str | None, agent: str | None) -> MetricsSummaryDTO:
        with self._uow_factory() as uow:
            raw = uow.traces.metrics_summary(source=source, agent=agent)
        total_calls = int(raw.get("model_calls", 0))
        known = int(raw.get("input_tokens_known", 0))
        return MetricsSummaryDTO(
            sessions=Metric(int(raw.get("sessions", 0)), DEFINITIONS["sessions"]),
            model_calls=Metric(total_calls, DEFINITIONS["model_calls"]),
            tool_calls=Metric(int(raw.get("tool_calls", 0)), DEFINITIONS["tool_calls"]),
            input_tokens=Metric(
                value=raw.get("input_tokens_sum") if known else None,
                definition=DEFINITIONS["input_tokens"],
                unit="tokens",
                coverage=Coverage(known=known, total=total_calls),
                by_semantics=dict(raw.get("by_semantics", {})),
            ),
        )
