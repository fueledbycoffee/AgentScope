"""Read-side use cases, including registry-backed metric queries."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import asdict
from typing import Any

from agentscope_app.application.dto import (
    DIAGNOSTIC_MESSAGES,
    ImportDiagnosticsPage,
    ImportReport,
    MappingRecord,
    RecordRow,
    RejectRow,
    RejectSummary,
    SessionDetail,
    SessionSummary,
)
from agentscope_app.application.dto import (
    MetricsSummary as MetricsSummaryDTO,
)
from agentscope_app.application.errors import InvalidInputError, NotFoundError
from agentscope_app.application.metric_queries import (
    MetricQueryResult,
    MetricQuerySpec,
    TraceScope,
    assemble_metric,
    assemble_query,
    invalid,
)
from agentscope_app.application.ports import UnitOfWork, UnitOfWorkFactory
from agentscope_app.domain.metrics import REGISTRY, Dimension, MetricRegistry
from agentscope_app.domain.pricing import PriceSchedule

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
        self,
        import_id: str,
        code: str | None = None,
        file_sha256: str | None = None,
        rule_id: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Sequence[RejectRow]:
        limit, offset = _page(limit, offset)
        with self._uow_factory() as uow:
            _require_import(uow, import_id)
            return list(uow.imports.rejects(import_id, code, file_sha256, rule_id, limit, offset))


class RejectSummaryQuery:
    def __init__(self, uow_factory: UnitOfWorkFactory) -> None:
        self._uow_factory = uow_factory

    def execute(self, import_id: str) -> RejectSummary:
        with self._uow_factory() as uow:
            _require_import(uow, import_id)
            return uow.imports.reject_summary(import_id)


class ListRecordOutcomes:
    OUTCOMES = frozenset({"accepted", "partial", "duplicate", "rejected", "ignored"})

    def __init__(self, uow_factory: UnitOfWorkFactory) -> None:
        self._uow_factory = uow_factory

    def execute(
        self,
        import_id: str,
        outcome: str | None = None,
        file_sha256: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Sequence[RecordRow]:
        if outcome is not None and outcome not in self.OUTCOMES:
            raise InvalidInputError(f"Unknown outcome {outcome!r}", [sorted(self.OUTCOMES)])
        limit, offset = _page(limit, offset)
        with self._uow_factory() as uow:
            _require_import(uow, import_id)
            return list(uow.imports.records(import_id, outcome, file_sha256, limit, offset))


def _require_import(uow: UnitOfWork, import_id: str) -> None:
    if uow.imports.get(import_id) is None:
        raise NotFoundError(f"Import {import_id!r} does not exist")


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


class MetricsSummary:
    def __init__(self, uow_factory: UnitOfWorkFactory) -> None:
        self._uow_factory = uow_factory

    def execute(
        self,
        *,
        source: str | None = None,
        agent: str | None = None,
        scope: TraceScope | None = None,
    ) -> MetricsSummaryDTO:
        effective = scope if scope is not None else TraceScope(source=source, agent=agent)
        metrics = {}
        with self._uow_factory() as uow:
            for metric_id in (
                "sessions",
                "model_calls",
                "tool_calls",
                "input_tokens",
                "output_tokens",
            ):
                definition = REGISTRY.get(metric_id)
                rows = uow.trace_query.aggregate(MetricQuerySpec(definition, effective))
                metrics[metric_id] = assemble_metric(definition, rows)
        return MetricsSummaryDTO(**metrics)


class ListMetricDefinitions:
    def __init__(
        self,
        registry: MetricRegistry = REGISTRY,
        price_schedule_loader: Callable[[], PriceSchedule | None] | None = None,
    ) -> None:
        self._registry = registry
        self._price_schedule_loader = price_schedule_loader

    def execute(self) -> list[dict[str, Any]]:
        definitions = [
            dict(asdict(d), supported_dimensions=d.supported_dimensions)
            for d in self._registry.definitions.values()
        ]
        schedule = self._price_schedule_loader() if self._price_schedule_loader else None
        for definition in definitions:
            if definition["id"] != "scheduled_cost_usd":
                continue
            definition["price_schedule"] = (
                {
                    "schedule_version": schedule.version,
                    "alias_version": schedule.alias_version,
                    "aliases": dict(schedule.aliases),
                    "resolution": "Exact schedule key, then exact reviewed alias; "
                    "otherwise unpriced.",
                }
                if schedule
                else None
            )
            if schedule and schedule.aliases:
                aliases = "; ".join(f"{a} → {t}" for a, t in sorted(schedule.aliases.items()))
                definition["caveat"] += f" Aliases in force ({schedule.version}): {aliases}."
        return definitions


class QueryMetric:
    def __init__(self, uow_factory: UnitOfWorkFactory, registry: MetricRegistry = REGISTRY) -> None:
        self._uow_factory, self._registry = uow_factory, registry

    def execute(
        self, metric_id: str, scope: TraceScope | None = None, group_by: tuple[Dimension, ...] = ()
    ) -> MetricQueryResult:
        try:
            definition = self._registry.get(metric_id)
        except ValueError as exc:
            raise invalid("metric_id", str(exc)) from None
        if Dimension.SESSION_ID in group_by:
            raise invalid("group_by", "session_id is an internal batching dimension")
        spec = MetricQuerySpec(definition, scope or TraceScope(), group_by)
        with self._uow_factory() as uow:
            rows = uow.trace_query.aggregate(spec)
        return assemble_query(spec, rows)


class ListImportDiagnostics:
    def __init__(self, uow_factory: UnitOfWorkFactory) -> None:
        self._uow_factory = uow_factory

    def execute(
        self,
        import_id: str,
        code: str | None = None,
        file_sha256: str | None = None,
        locator: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> ImportDiagnosticsPage:
        if code is not None and code not in DIAGNOSTIC_MESSAGES:
            raise InvalidInputError(
                f"Unknown diagnostic code {code!r}", [sorted(DIAGNOSTIC_MESSAGES)]
            )
        limit, offset = _page(limit, offset)
        with self._uow_factory() as uow:
            _require_import(uow, import_id)
            return uow.imports.diagnostics(import_id, code, file_sha256, locator, limit, offset)
