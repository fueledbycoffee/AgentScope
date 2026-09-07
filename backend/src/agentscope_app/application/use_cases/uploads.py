"""Store an uploaded file immutably and describe it."""

from __future__ import annotations

from agentscope_app.application.dto import (
    MAX_RECORDS_PER_FILE,
    MAX_UPLOAD_BYTES,
    PREVIEW_RECORDS,
    RawRecord,
    UploadInfo,
)
from agentscope_app.application.errors import LimitExceededError
from agentscope_app.application.ports import (
    Clock,
    IdGenerator,
    RawFileStore,
    RecordReader,
    UnitOfWork,
    UnitOfWorkFactory,
)


class StoreUpload:
    def __init__(
        self,
        uow_factory: UnitOfWorkFactory,
        store: RawFileStore,
        reader: RecordReader,
        clock: Clock,
        ids: IdGenerator,
        *,
        max_bytes: int = MAX_UPLOAD_BYTES,
        max_records: int = MAX_RECORDS_PER_FILE,
        preview_records: int = PREVIEW_RECORDS,
    ) -> None:
        self._uow_factory = uow_factory
        self._store = store
        self._reader = reader
        self._clock = clock
        self._ids = ids
        self._max_bytes = max_bytes
        self._max_records = max_records
        self._preview_records = preview_records

    def execute(self, filename: str, data: bytes) -> UploadInfo:
        if len(data) > self._max_bytes:
            raise LimitExceededError(
                f"File is {len(data)} bytes; the limit is {self._max_bytes} bytes (25 MiB)"
            )
        fmt = self._reader.sniff(filename, data[:64])
        stored = self._store.put(data)
        preview: list[RawRecord] = []
        count = 0
        with self._store.open(stored.sha256) as stream:
            for record in self._reader.read(stream, fmt):
                count += 1
                if count > self._max_records:
                    raise LimitExceededError(
                        f"File has more than {self._max_records} records; split it first"
                    )
                if len(preview) < self._preview_records:
                    preview.append(record)
        with self._uow_factory() as uow:
            already = tuple(
                ref
                for source in _known_sources(uow)
                for ref in uow.imports.find_committed(stored.sha256, source)
            )
            info = UploadInfo(
                upload_id=self._ids.new_id("upl"),
                filename=filename,
                sha256=stored.sha256,
                size_bytes=stored.size_bytes,
                format=fmt,
                record_count=count,
                preview=tuple(preview),
                already_imported=already,
            )
            uow.uploads.add(info)
            uow.commit()
        return info


def _known_sources(uow: UnitOfWork) -> list[str]:
    """Sources are whatever the saved mappings target; imports are scoped by source."""
    return sorted({m.source for m in uow.mappings.list()})
