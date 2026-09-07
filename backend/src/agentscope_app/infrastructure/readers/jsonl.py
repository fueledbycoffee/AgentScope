"""JSONL (optionally gzip-compressed) record reader with ``line:N`` locators.

Numbers are decoded with ``Decimal`` for fractions so the domain's strict
coercion sees exact values. A line that is not a JSON object becomes a record
with ``payload=None`` and an ``error``; the import turns it into an explained
reject instead of stopping.
"""

from __future__ import annotations

import gzip
import io
import json
from collections.abc import Iterator
from decimal import Decimal
from typing import BinaryIO, Final

from agentscope_app.application.dto import MAX_UPLOAD_BYTES, RawRecord
from agentscope_app.application.errors import InvalidInputError, LimitExceededError

GZIP_MAGIC: Final = b"\x1f\x8b"
PARQUET_MAGIC: Final = b"PAR1"
DEFAULT_MAX_LINE_BYTES: Final = 4 * 1024 * 1024
DEFAULT_MAX_DECOMPRESSED_BYTES: Final = 8 * MAX_UPLOAD_BYTES  # gzip bombs stop here


class JsonlRecordReader:
    def __init__(
        self,
        *,
        max_line_bytes: int = DEFAULT_MAX_LINE_BYTES,
        max_decompressed_bytes: int = DEFAULT_MAX_DECOMPRESSED_BYTES,
    ) -> None:
        self._max_line_bytes = max_line_bytes
        self._max_decompressed_bytes = max_decompressed_bytes

    def sniff(self, filename: str, head: bytes) -> str:
        name = filename.lower()
        if head.startswith(PARQUET_MAGIC) or name.endswith(".parquet"):
            return "parquet"
        if name.endswith((".jsonl", ".jsonl.gz", ".ndjson", ".ndjson.gz", ".json.gz")):
            return "jsonl"
        if head.startswith(GZIP_MAGIC):
            return "jsonl"
        if head.lstrip()[:1] in (b"{", b"["):
            return "jsonl"
        raise InvalidInputError(
            f"Cannot tell the format of {filename!r}: expected JSONL (optionally gzip) or Parquet"
        )

    def read(self, stream: BinaryIO, fmt: str) -> Iterator[RawRecord]:
        if fmt != "jsonl":
            raise InvalidInputError(f"This reader only handles jsonl, not {fmt!r}")
        head = stream.read(2)
        rest = stream.read()
        data = head + rest
        if data.startswith(GZIP_MAGIC):
            data = self._decompress(data)
        text_stream = io.BytesIO(data)
        for number, raw_line in enumerate(text_stream, 1):
            if len(raw_line) > self._max_line_bytes:
                raise LimitExceededError(
                    f"Line {number} exceeds {self._max_line_bytes} bytes; the file is not JSONL"
                )
            line = raw_line.strip()
            if not line:
                continue
            locator = f"line:{number}"
            try:
                payload = json.loads(line, parse_float=Decimal)
            except (ValueError, ArithmeticError) as exc:
                yield RawRecord(locator, None, f"invalid JSON on line {number}: {exc}")
                continue
            except RecursionError:
                yield RawRecord(locator, None, f"JSON on line {number} is nested too deeply")
                continue
            if not isinstance(payload, dict):
                yield RawRecord(locator, None, f"line {number} is not a JSON object")
                continue
            yield RawRecord(locator, payload)

    def _decompress(self, data: bytes) -> bytes:
        out = io.BytesIO()
        total = 0
        try:
            with gzip.GzipFile(fileobj=io.BytesIO(data)) as gz:
                while True:
                    chunk = gz.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > self._max_decompressed_bytes:
                        raise LimitExceededError(
                            f"Decompressed size exceeds {self._max_decompressed_bytes} bytes"
                        )
                    out.write(chunk)
        except (OSError, EOFError) as exc:
            raise InvalidInputError(f"Corrupt gzip stream: {exc}") from exc
        return out.getvalue()
