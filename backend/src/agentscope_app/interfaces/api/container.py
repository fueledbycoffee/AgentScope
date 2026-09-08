"""Composition root: builds adapters from settings and wires the use cases."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from agentscope_app.application.dto import CONTEXT_BUDGET_BYTES
from agentscope_app.application.ports import MappingAssistant, UnitOfWorkFactory
from agentscope_app.application.use_cases.assistant import (
    PrepareContext,
    ProfileFile,
    RunAssistant,
)
from agentscope_app.application.use_cases.imports import CommitImport, PreviewImport
from agentscope_app.application.use_cases.mappings import SaveMappingRevision
from agentscope_app.application.use_cases.queries import (
    GetImport,
    GetMapping,
    GetRawRecord,
    GetSession,
    ListImportDiagnostics,
    ListImports,
    ListMappings,
    ListMetricDefinitions,
    ListRecordOutcomes,
    ListRejects,
    ListSessions,
    MetricsSummary,
    QueryMetric,
    RejectSummaryQuery,
)
from agentscope_app.application.use_cases.uploads import StoreUpload
from agentscope_app.infrastructure.db.engine import create_engine_for, run_migrations
from agentscope_app.infrastructure.db.unit_of_work import make_uow_factory
from agentscope_app.infrastructure.files.raw_store import FilesystemRawFileStore
from agentscope_app.infrastructure.ids import UtcClock, UuidIdGenerator
from agentscope_app.infrastructure.llm.fake import FakeMappingAssistant
from agentscope_app.infrastructure.llm.openai_compatible import OpenAICompatibleAssistant
from agentscope_app.infrastructure.llm.unavailable import UnavailableMappingAssistant
from agentscope_app.infrastructure.mappings.bundled import load_bundled_mappings
from agentscope_app.infrastructure.prices import load_price_schedule
from agentscope_app.infrastructure.readers.router import FormatRouter
from agentscope_app.infrastructure.settings import Settings


@dataclass
class Container:
    settings: Settings
    uow_factory: UnitOfWorkFactory
    store_upload: StoreUpload
    preview_import: PreviewImport
    commit_import: CommitImport
    list_mappings: ListMappings
    get_mapping: GetMapping
    list_import_diagnostics: ListImportDiagnostics
    list_imports: ListImports
    get_import: GetImport
    list_rejects: ListRejects
    reject_summary: RejectSummaryQuery
    list_records: ListRecordOutcomes
    list_sessions: ListSessions
    get_session: GetSession
    get_raw_record: GetRawRecord
    metrics_summary: MetricsSummary
    list_metric_definitions: ListMetricDefinitions
    query_metric: QueryMetric
    profile_file: ProfileFile
    prepare_context: PrepareContext
    run_assistant: RunAssistant
    save_mapping: SaveMappingRevision
    assistant: MappingAssistant

    def close(self) -> None:
        close = getattr(self.assistant, "close", None)
        if callable(close):
            close()


def build_assistant(settings: Settings) -> MappingAssistant:
    """``fake`` is the deterministic offline assistant; ``openai_compatible`` talks to any
    chat-completions endpoint and needs a model id; anything else is unavailable.

    Nothing else depends on this choice: uploads, saved-mapping replay and the
    dashboards work without an assistant (ADR-005).
    """
    if settings.llm_provider == "fake":
        return FakeMappingAssistant(settings.bundled_mappings_dir)
    if settings.llm_provider == "openai_compatible":
        try:
            return OpenAICompatibleAssistant(
                base_url=settings.llm_base_url,
                model=settings.llm_model,
                api_key=settings.llm_api_key.get_secret_value(),
                timeout_s=_number(settings.llm_timeout_s, "AGENTSCOPE_LLM_TIMEOUT_S"),
                json_mode=settings.llm_json_mode,
                max_tokens=_integer(settings.llm_max_tokens, "AGENTSCOPE_LLM_MAX_TOKENS"),
            )
        except ValueError as exc:
            # an invalid assistant configuration never takes the application down
            return UnavailableMappingAssistant(settings.llm_provider, reason=str(exc))
    return UnavailableMappingAssistant(settings.llm_provider)


def _number(text: str, variable: str) -> float:
    try:
        return float(text.strip())
    except (ValueError, AttributeError):
        raise ValueError(f"{variable} must be a number, got {text!r}") from None


def _context_budget(settings: Settings) -> tuple[int, str | None]:
    """The prepared-context budget, or the default plus the reason the setting was refused."""
    try:
        budget = _integer(settings.llm_context_bytes, "AGENTSCOPE_LLM_CONTEXT_BYTES")
        if budget < 4_096:
            raise ValueError(f"AGENTSCOPE_LLM_CONTEXT_BYTES must be at least 4096, got {budget}")
    except ValueError as exc:
        return CONTEXT_BUDGET_BYTES, str(exc)
    return budget, None


def _integer(text: str, variable: str) -> int:
    try:
        return int(text.strip())
    except (ValueError, AttributeError):
        raise ValueError(f"{variable} must be an integer, got {text!r}") from None


def build_container(settings: Settings) -> Container:
    """Create the database if needed, migrate it, load bundled mappings, wire everything."""
    url = settings.database_url
    if url.startswith("sqlite:///") and not url.startswith("sqlite:///:memory:"):
        Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine_for(url)
    run_migrations(engine)
    uow_factory = make_uow_factory(engine)
    clock, ids = UtcClock(), UuidIdGenerator()
    load_bundled_mappings(uow_factory, settings.bundled_mappings_dir, clock)
    store = FilesystemRawFileStore(settings.raw_file_dir)
    reader = FormatRouter()
    profile_file = ProfileFile(uow_factory, store, reader)
    # an invalid assistant setting disables the assistant, never the application
    budget, budget_problem = _context_budget(settings)
    prepare_context = PrepareContext(uow_factory, store, reader, profile_file, budget_bytes=budget)
    assistant = (
        build_assistant(settings)
        if budget_problem is None
        else UnavailableMappingAssistant(settings.llm_provider, reason=budget_problem)
    )
    return Container(
        settings=settings,
        uow_factory=uow_factory,
        store_upload=StoreUpload(uow_factory, store, reader, clock, ids),
        preview_import=PreviewImport(uow_factory, store, reader),
        commit_import=CommitImport(uow_factory, store, reader, clock, ids),
        list_mappings=ListMappings(uow_factory),
        get_mapping=GetMapping(uow_factory),
        list_import_diagnostics=ListImportDiagnostics(uow_factory),
        list_imports=ListImports(uow_factory),
        get_import=GetImport(uow_factory),
        list_rejects=ListRejects(uow_factory),
        reject_summary=RejectSummaryQuery(uow_factory),
        list_records=ListRecordOutcomes(uow_factory),
        list_sessions=ListSessions(uow_factory),
        get_session=GetSession(uow_factory),
        get_raw_record=GetRawRecord(uow_factory),
        metrics_summary=MetricsSummary(uow_factory),
        list_metric_definitions=ListMetricDefinitions(price_schedule_loader=load_price_schedule),
        query_metric=QueryMetric(uow_factory),
        profile_file=profile_file,
        prepare_context=prepare_context,
        run_assistant=RunAssistant(prepare_context, assistant),
        save_mapping=SaveMappingRevision(uow_factory, clock),
        assistant=assistant,
    )
