"""Batch imports over HTTP: both request bodies, a Parquet file in the batch,
per-file shapes on POST and GET, and the rejects file filter."""

from __future__ import annotations

import json
import shutil
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from agentscope_app.infrastructure.settings import Settings
from agentscope_app.interfaces.api.main import create_app
from tests.parquet_support import PARQUET_MAPPING, parquet_file, parquet_rows

BACKEND = Path(__file__).resolve().parents[2]
JSONL = (
    b'{"provider": "claude", "session_id": "claude:h1", "round_index": 0, "model": "m",'
    b' "input_tokens_total": 10, "output_tokens": 1, "timing_events": [{"timestamp":'
    b' "2026-05-11T06:40:00Z"}], "tools": [], "user": "u", "trace_key": "k-h1"}\n'
    b'{"provider": "claude", "round_index": 1, "model": "m",'
    b' "input_tokens_total": 10, "output_tokens": 1, "timing_events": [{"timestamp":'
    b' "2026-05-11T06:41:00Z"}], "tools": [], "user": "u", "trace_key": "k-h2"}\n'
)


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    bundle = tmp_path / "mappings"
    bundle.mkdir()
    shutil.copy(BACKEND / "mappings" / "tracelab-v1.json", bundle / "tracelab-v1.json")
    (bundle / "parquet-test-v1.json").write_text(json.dumps(PARQUET_MAPPING))
    settings = Settings(
        _env_file=None,
        database_url=f"sqlite:///{tmp_path / 'db' / 'agentscope.sqlite3'}",
        raw_file_dir=tmp_path / "raw",
        bundled_mappings_dir=bundle,
    )
    with TestClient(create_app(settings)) as client:
        yield client


def upload(client: TestClient, name: str, data: bytes) -> dict:
    response = client.post("/api/uploads", files={"file": (name, data)})
    assert response.status_code == 201, response.text
    return response.json()


def test_batch_import_with_parquet_and_jsonl(client: TestClient) -> None:
    mappings = {m["name"]: m["id"] for m in client.get("/api/mappings").json()}
    a = upload(client, "a.jsonl", JSONL)
    b = upload(client, "b.parquet", parquet_file(parquet_rows("api", 3)))
    assert b["format"] == "parquet" and b["record_count"] == 3
    assert b["preview"][0]["locator"] == "row:0"
    preview = client.post(
        "/api/imports/preview",
        json={"upload_id": b["upload_id"], "mapping_id": mappings["parquet-test-v1"], "sample": 10},
    ).json()
    assert preview["entities"] == {"session": 3, "model_call": 3, "tool_call": 3}
    response = client.post(
        "/api/imports",
        json={
            "source": "tracelab",
            "files": [
                {"upload_id": a["upload_id"], "mapping_id": mappings["tracelab-v1"]},
                {"upload_id": b["upload_id"], "mapping_id": mappings["parquet-test-v1"]},
            ],
        },
    )
    assert response.status_code == 201, response.text
    report = response.json()
    assert report["status"] == "committed"
    files = {f["sha256"]: f for f in report["files"]}
    assert files[a["sha256"]]["mapping"]["name"] == "tracelab-v1"
    assert files[a["sha256"]]["status"] == "committed"
    assert files[a["sha256"]]["records"]["accepted"] == 1
    assert files[a["sha256"]]["records"]["rejected"] == 1  # no session_id: rejected
    assert files[b["sha256"]]["mapping"]["name"] == "parquet-test-v1"
    assert files[b["sha256"]]["records"]["accepted"] == 3
    assert report["records"]["accepted"] == 4 and report["records"]["rejected"] == 1
    assert report["reject_count"] == 2  # both rules of the record rejected it
    assert client.get(f"/api/imports/{report['import_id']}").json() == report
    rejects = client.get(f"/api/imports/{report['import_id']}/rejects").json()
    assert {r["file_sha256"] for r in rejects} == {a["sha256"]} and len(rejects) == 2
    assert (
        client.get(
            f"/api/imports/{report['import_id']}/rejects", params={"file_sha256": b["sha256"]}
        ).json()
        == []
    )
    raw = client.get(
        "/api/raw-records", params={"file_sha256": b["sha256"], "locator": "row:1"}
    ).json()
    assert raw["derived"] == "parquet-row" and '"_arrow": "timestamp"' in raw["payload_text"]
    # the single-file body still works and reports the batch of one
    again = client.post(
        "/api/imports",
        json={
            "upload_id": a["upload_id"],
            "mapping_id": mappings["tracelab-v1"],
            "source": "tracelab",
        },
    )
    assert again.status_code == 201 and again.json()["status"] == "duplicate"
    assert again.json()["files"][0]["status"] == "duplicate"
    assert again.json()["files"][0]["duplicate_of"] == report["import_id"]
    read_back = client.get(f"/api/imports/{again.json()['import_id']}").json()
    assert read_back["files"][0]["duplicate_of"] == report["import_id"]
    # both forms at once, or neither, is a validation error in the envelope
    both = client.post(
        "/api/imports",
        json={
            "source": "s",
            "upload_id": "x",
            "mapping_id": "y",
            "files": [{"upload_id": "x", "mapping_id": "y"}],
        },
    )
    assert both.status_code == 400 and both.json()["error"]["code"] == "invalid_input"
    neither = client.post("/api/imports", json={"source": "s"})
    assert neither.status_code == 400
    unknown = client.post(
        "/api/imports", json={"source": "s", "files": [{"upload_id": "nope", "mapping_id": "y"}]}
    )
    assert unknown.status_code == 404


def test_records_and_reject_summary_endpoints(client: TestClient) -> None:
    mappings = {m["name"]: m["id"] for m in client.get("/api/mappings").json()}
    a = upload(client, "a.jsonl", JSONL)
    report = client.post(
        "/api/imports",
        json={
            "upload_id": a["upload_id"],
            "mapping_id": mappings["tracelab-v1"],
            "source": "tracelab",
        },
    ).json()
    base = f"/api/imports/{report['import_id']}"
    records = client.get(f"{base}/records").json()
    assert [(r["locator"], r["outcome"]) for r in records] == [
        ("line:1", "accepted"),
        ("line:2", "rejected"),
    ]
    assert records[0]["file_sha256"] == a["sha256"] and records[0]["entity_counts"] == {
        "session": 1,
        "model_call": 1,
    }
    assert [
        r["locator"] for r in client.get(f"{base}/records", params={"outcome": "rejected"}).json()
    ] == ["line:2"]
    assert client.get(f"{base}/records", params={"outcome": "bogus"}).status_code == 400
    summary = client.get(f"{base}/rejects/summary").json()
    assert summary["outcomes"] == {"accepted": 1, "rejected": 1}
    assert summary["codes"] == {"missing_value": 2} and set(summary["rules"]) == {
        "session",
        "model_call",
    }
    assert [
        r["rule_id"] for r in client.get(f"{base}/rejects", params={"rule_id": "session"}).json()
    ] == ["session"]
    assert client.get("/api/imports/imp_nope/records").status_code == 404
    assert client.get("/api/imports/imp_nope/rejects/summary").status_code == 404
