"""Save a mapping document as an immutable revision."""

from __future__ import annotations

from dataclasses import asdict, dataclass

from agentscope_app.application.dto import MappingRecord
from agentscope_app.application.errors import ConflictError, InvalidInputError
from agentscope_app.application.ports import Clock, UnitOfWorkFactory
from agentscope_app.domain.jsonx import content_hash
from agentscope_app.domain.mapping.contract import MappingSpec
from agentscope_app.domain.mapping.parser import parse_mapping


@dataclass(frozen=True)
class SavedMapping:
    record: MappingRecord
    created: bool  # False when the same document (by content hash) already existed


class SaveMappingRevision:
    """Idempotent by content hash; a changed document under a known name is a new revision.

    Only executable documents are stored: saved mappings replay without any
    assistant call, so a draft that fails the contract is refused with its issues.
    Revisions are immutable and imports keep their ``mapping_id`` bindings.

    Two concurrent saves can race on the unique content hash or on the next
    revision number; the repository reports either as ``ConflictError``. A hash
    race is resolved by returning the winner; a revision race is retried a
    bounded number of times (each retry re-reads the revisions) before the
    conflict is surfaced.
    """

    RETRIES = 5

    def __init__(self, uow_factory: UnitOfWorkFactory, clock: Clock) -> None:
        self._uow_factory = uow_factory
        self._clock = clock

    def execute(self, document: dict[str, object], *, created_by: str) -> SavedMapping:
        digest = content_hash(document)
        parsed = parse_mapping(document)
        if not parsed.is_executable or parsed.spec is None:
            raise InvalidInputError(
                "Mapping document is not executable",
                [asdict(issue) for issue in parsed.errors],
            )
        for attempt in range(self.RETRIES + 1):
            try:
                return self._save(document, digest, parsed.spec, created_by)
            except ConflictError:
                with self._uow_factory() as uow:
                    winner = uow.mappings.find_by_hash(digest)
                if winner is not None:
                    return SavedMapping(winner, created=False)
                if attempt == self.RETRIES:
                    raise
        raise AssertionError("unreachable")

    def _save(
        self, document: dict[str, object], digest: str, spec: MappingSpec, created_by: str
    ) -> SavedMapping:
        name = spec.name
        with self._uow_factory() as uow:
            existing = uow.mappings.find_by_hash(digest)
            if existing is not None:
                return SavedMapping(existing, created=False)
            same_name = [m for m in uow.mappings.list() if m.name == name]
            record = MappingRecord(
                id=f"map_{digest[:20]}",
                name=name,
                source=spec.source,
                revision=1 + max((m.revision for m in same_name), default=0),
                created_by=created_by,
                input_format=spec.input_format,
                document=document,
                content_hash=digest,
                created_at=self._clock.now(),
            )
            uow.mappings.add(record)
            uow.commit()
        return SavedMapping(record, created=True)
