"""One ``RecordReader`` that picks the right decoder by format.

Magic bytes decide before the extension does: a ``PAR1`` file named
``.jsonl`` is Parquet, and a ``.parquet`` file without the magic is handed to
the Parquet reader, which refuses it with a clear message.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import BinaryIO

from agentscope_app.application.dto import RawRecord
from agentscope_app.application.errors import InvalidInputError
from agentscope_app.infrastructure.readers.jsonl import JsonlRecordReader
from agentscope_app.infrastructure.readers.parquet import PARQUET_MAGIC, ParquetRecordReader


class FormatRouter:
    def __init__(
        self,
        jsonl: JsonlRecordReader | None = None,
        parquet: ParquetRecordReader | None = None,
    ) -> None:
        self._jsonl = jsonl or JsonlRecordReader()
        self._parquet = parquet or ParquetRecordReader()

    def sniff(self, filename: str, head: bytes) -> str:
        if head.startswith(PARQUET_MAGIC) or filename.lower().endswith(".parquet"):
            return "parquet"
        return self._jsonl.sniff(filename, head)

    def read(self, stream: BinaryIO, fmt: str) -> Iterator[RawRecord]:
        if fmt == "jsonl":
            return self._jsonl.read(stream, fmt)
        if fmt == "parquet":
            return self._parquet.read(stream, fmt)
        raise InvalidInputError(f"Unknown format {fmt!r}")
