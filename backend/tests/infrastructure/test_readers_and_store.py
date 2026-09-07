import gzip
import hashlib
import io
import json
from pathlib import Path

import pytest

from agentscope_app.application.errors import InvalidInputError, LimitExceededError
from agentscope_app.infrastructure.files.raw_store import FilesystemRawFileStore
from agentscope_app.infrastructure.readers.jsonl import JsonlRecordReader

FIXTURE = Path(__file__).resolve().parents[3] / "fixtures" / "tracelab" / "tracelab-sample.jsonl.gz"


def test_raw_store_is_content_addressed_and_immutable(tmp_path: Path) -> None:
    store = FilesystemRawFileStore(tmp_path / "raw")
    stored = store.put(b"hello\n")
    assert stored.sha256 == hashlib.sha256(b"hello\n").hexdigest() and stored.size_bytes == 6
    assert store.get(stored.sha256) == stored
    assert store.put(b"hello\n") == stored  # same bytes, same file
    with store.open(stored.sha256) as stream:
        assert stream.read() == b"hello\n"
    assert store.get("0" * 64) is None
    with pytest.raises(FileNotFoundError):
        store.open("0" * 64)
    assert (tmp_path / "raw" / stored.sha256[:2] / stored.sha256).exists()


def test_jsonl_reader_sniffs_and_reads_plain_and_gzip() -> None:
    reader = JsonlRecordReader()
    assert reader.sniff("a.jsonl", b'{"a": 1}') == "jsonl"
    assert reader.sniff("a.JSONL.GZ", b"\x1f\x8b") == "jsonl"
    assert reader.sniff("a.ndjson", b"") == "jsonl"
    assert reader.sniff("a.parquet", b"PAR1") == "parquet"
    assert reader.sniff("weird.bin", b'{"a": 1}\n') == "jsonl"  # content beats extension
    with pytest.raises(InvalidInputError):
        reader.sniff("notes.txt", b"hello world")
    data = b'{"a": 1}\n\n  {"b": [1, 2]}\r\n{bad\n{"c": 1.5}'
    records = list(reader.read(io.BytesIO(data), "jsonl"))
    assert [(r.locator, r.payload) for r in records if r.error is None] == [
        ("line:1", {"a": 1}),
        ("line:3", {"b": [1, 2]}),
        ("line:5", {"c": 1.5}),
    ]
    bad = [r for r in records if r.error is not None]
    assert [(r.locator, r.payload) for r in bad] == [("line:4", None)]
    assert "line 4" in bad[0].error or "JSON" in bad[0].error
    gz = list(reader.read(io.BytesIO(gzip.compress(data)), "jsonl"))
    assert [r.locator for r in gz] == [r.locator for r in records]


def test_jsonl_reader_handles_the_real_fixture_and_limits() -> None:
    reader = JsonlRecordReader()
    with FIXTURE.open("rb") as stream:
        records = list(reader.read(stream, "jsonl"))
    assert len(records) == 4770 and all(r.error is None for r in records)
    assert records[0].locator == "line:1" and records[-1].locator == "line:4770"
    limited = JsonlRecordReader(max_line_bytes=100)
    with pytest.raises(LimitExceededError):
        list(limited.read(io.BytesIO(b'{"x": "' + b"a" * 200 + b'"}\n'), "jsonl"))
    huge = JsonlRecordReader(max_decompressed_bytes=50)
    with pytest.raises(LimitExceededError):
        list(huge.read(io.BytesIO(gzip.compress(b'{"a": 1}\n' * 20)), "jsonl"))


def test_jsonl_reader_keeps_numbers_exact_and_rejects_non_objects() -> None:
    reader = JsonlRecordReader()
    records = list(reader.read(io.BytesIO(b'{"n": 1.00000000000000001}\n[1, 2]\n"str"\n'), "jsonl"))
    from decimal import Decimal

    assert records[0].payload == {"n": Decimal("1.00000000000000001")}
    assert [r.error is not None for r in records[1:]] == [True, True]
    assert json.dumps({"ok": True})  # sanity: stdlib json still available for callers
