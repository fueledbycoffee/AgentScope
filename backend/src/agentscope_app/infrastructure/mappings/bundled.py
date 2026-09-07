"""Load the mappings shipped with the application into the mapping repository.

Idempotent by content hash: the same document is never stored twice, and an
edited bundled document becomes a new revision of the same name. The saving
itself is the application's ``SaveMappingRevision``; this module only reads
the files.
"""

from __future__ import annotations

import json
from pathlib import Path

from agentscope_app.application.dto import MappingRecord
from agentscope_app.application.errors import InvalidInputError
from agentscope_app.application.ports import Clock, UnitOfWorkFactory
from agentscope_app.application.use_cases.mappings import SaveMappingRevision


def load_bundled_mappings(
    uow_factory: UnitOfWorkFactory, directory: Path, clock: Clock
) -> list[MappingRecord]:
    """Returns the records that were added (empty when everything was already known)."""
    save = SaveMappingRevision(uow_factory, clock)
    added: list[MappingRecord] = []
    for path in sorted(Path(directory).glob("*.json")):
        document = json.loads(path.read_text(encoding="utf-8"))
        try:
            saved = save.execute(document, created_by="bundled")
        except InvalidInputError as exc:
            raise InvalidInputError(
                f"Bundled mapping {path.name} is not executable", exc.details
            ) from exc
        if saved.created:
            added.append(saved.record)
    return added
