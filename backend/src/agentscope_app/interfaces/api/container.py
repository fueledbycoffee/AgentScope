"""Composition root: builds adapters from settings and wires the use cases."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

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
    ListImports,
    ListMappings,
    ListRecordOutcomes,
    ListRejects,
    ListSessions,
    MetricsSummary,
    RejectSummaryQuery,
)
from agentscope_app.application.use_cases.uploads import StoreUpload
from agentscope_app.infrastructure.db.engine import create_engine_for, run_migrations
from agentscope_app.infrastructure.db.unit_of_work import make_uow_factory
from agentscope_app.infrastructure.files.raw_store import FilesystemRawFileStore
from agentscope_app.infrastructure.ids import UtcClock, UuidIdGenerator
from agentscope_app.infrastructure.llm.fake import FakeMappingAssistant
from agentscope_app.infrastructure.llm.unavailable import UnavailableMappingAssistant
from agentscope_app.infrastructure.mappings.bundled import load_bundled_mappings
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
    list_imports: ListImports
    get_import: GetImport
    list_rejects: ListRejects
    reject_summary: RejectSummaryQuery
    list_records: ListRecordOutcomes
    list_sessions: ListSessions
    get_session: GetSession
    get_raw_record: GetRawRecord
    metrics_summary: MetricsSummary
    profile_file: ProfileFile
    prepare_context: PrepareContext
    run_assistant: RunAssistant
    save_mapping: SaveMappingRevision


def build_assistant(settings: Settings) -> MappingAssistant:
    """Only ``fake`` is explicit; any other provider is unavailable until its adapter exists (#14).

    Nothing else depends on this choice: uploads, saved-mapping replay and the
    dashboards work without an assistant (ADR-005).
    """
    if settings.llm_provider == "fake":
        return FakeMappingAssistant(settings.bundled_mappings_dir)
    return UnavailableMappingAssistant(settings.llm_provider)


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
    prepare_context = PrepareContext(uow_factory, store, reader, profile_file)
    return Container(
        settings=settings,
        uow_factory=uow_factory,
        store_upload=StoreUpload(uow_factory, store, reader, clock, ids),
        preview_import=PreviewImport(uow_factory, store, reader),
        commit_import=CommitImport(uow_factory, store, reader, clock, ids),
        list_mappings=ListMappings(uow_factory),
        get_mapping=GetMapping(uow_factory),
        list_imports=ListImports(uow_factory),
        get_import=GetImport(uow_factory),
        list_rejects=ListRejects(uow_factory),
        reject_summary=RejectSummaryQuery(uow_factory),
        list_records=ListRecordOutcomes(uow_factory),
        list_sessions=ListSessions(uow_factory),
        get_session=GetSession(uow_factory),
        get_raw_record=GetRawRecord(uow_factory),
        metrics_summary=MetricsSummary(uow_factory),
        profile_file=profile_file,
        prepare_context=prepare_context,
        run_assistant=RunAssistant(prepare_context, build_assistant(settings)),
        save_mapping=SaveMappingRevision(uow_factory, clock),
    )
