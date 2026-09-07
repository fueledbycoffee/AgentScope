"""Load the mappings shipped with the application into the mapping repository.

Idempotent by content hash: the same document is never stored twice, and an
edited bundled document becomes a new revision of the same name.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict
from pathlib import Path

from agentscope_app.application.dto import MappingRecord
from agentscope_app.application.errors import InvalidInputError
from agentscope_app.application.ports import Clock, UnitOfWorkFactory
from agentscope_app.domain.mapping.parser import parse_mapping


def content_hash(document: dict[str, object]) -> str:
    canonical = json.dumps(document, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def load_bundled_mappings(
    uow_factory: UnitOfWorkFactory, directory: Path, clock: Clock
) -> list[MappingRecord]:
    """Returns the records that were added (empty when everything was already known)."""
    added: list[MappingRecord] = []
    with uow_factory() as uow:
        for path in sorted(Path(directory).glob("*.json")):
            document = json.loads(path.read_text(encoding="utf-8"))
            digest = content_hash(document)
            if uow.mappings.find_by_hash(digest) is not None:
                continue
            parsed = parse_mapping(document)
            if not parsed.is_executable or parsed.spec is None:
                raise InvalidInputError(
                    f"Bundled mapping {path.name} is not executable",
                    [asdict(issue) for issue in parsed.errors],
                )
            same_name = [m for m in uow.mappings.list() if m.name == parsed.spec.name]
            record = MappingRecord(
                id=f"map_{digest[:20]}",
                name=parsed.spec.name,
                source=parsed.spec.source,
                revision=1 + max((m.revision for m in same_name), default=0),
                created_by="bundled",
                input_format=parsed.spec.input_format,
                document=document,
                content_hash=digest,
                created_at=clock.now(),
            )
            uow.mappings.add(record)
            added.append(record)
        uow.commit()
    return added
