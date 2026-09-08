"""Unit of work over a SQLAlchemy session: one transaction per use-case step."""

from __future__ import annotations

from collections.abc import Callable

from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from agentscope_app.application.ports import (
    ImportRepository,
    MappingRepository,
    TraceQuery,
    TraceRepository,
    UnitOfWorkFactory,
    UploadRepository,
)
from agentscope_app.infrastructure.db.repositories import (
    SqlAlchemyImports,
    SqlAlchemyMappings,
    SqlAlchemyTraces,
    SqlAlchemyUploads,
)
from agentscope_app.infrastructure.db.trace_query import SqlAlchemyTraceQuery


class SqlAlchemyUnitOfWork:
    uploads: UploadRepository
    mappings: MappingRepository
    imports: ImportRepository
    traces: TraceRepository
    trace_query: TraceQuery

    def __init__(self, session_factory: Callable[[], Session]) -> None:
        self._session_factory = session_factory
        self._committed = False

    def __enter__(self) -> SqlAlchemyUnitOfWork:
        self.session = self._session_factory()
        self._committed = False
        self.uploads = SqlAlchemyUploads(self.session)
        self.mappings = SqlAlchemyMappings(self.session)
        self.imports = SqlAlchemyImports(self.session)
        self.traces = SqlAlchemyTraces(self.session)
        self.trace_query = SqlAlchemyTraceQuery(self.session)
        return self

    def __exit__(self, exc_type: object, exc: object, tb: object) -> None:
        try:
            if not self._committed:
                self.session.rollback()
        finally:
            self.session.close()

    def commit(self) -> None:
        self.session.commit()
        self._committed = True

    def rollback(self) -> None:
        self.session.rollback()


def make_uow_factory(engine: Engine) -> UnitOfWorkFactory:
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    return lambda: SqlAlchemyUnitOfWork(factory)
