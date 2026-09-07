"""The day-1 gate over HTTP: upload, preview, import, report, sessions, re-import."""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from agentscope_app.infrastructure.settings import Settings
from agentscope_app.interfaces.api.main import create_app

FIXTURE = Path(__file__).resolve().parents[3] / "fixtures" / "tracelab" / "tracelab-sample.jsonl.gz"


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(
        _env_file=None,
        database_url=f"sqlite:///{tmp_path / 'db' / 'agentscope.sqlite3'}",
        raw_file_dir=tmp_path / "raw",
    )
    with TestClient(create_app(settings)) as client:
        yield client


def test_health_reports_ok_and_version(client: TestClient) -> None:
    body = client.get("/api/health").json()
    assert body["status"] == "ok" and body["version"]


def test_bundled_mapping_is_listed_with_its_document(client: TestClient) -> None:
    mappings = client.get("/api/mappings").json()
    assert [(m["name"], m["source"], m["revision"]) for m in mappings] == [
        ("tracelab-v1", "tracelab", 1)
    ]
    detail = client.get(f"/api/mappings/{mappings[0]['id']}").json()
    assert detail["document"]["dsl_version"] == 1 and detail["issues"] == []
    assert client.get("/api/mappings/nope").status_code == 404


def test_day_one_gate_upload_preview_import_explore_reimport(client: TestClient) -> None:
    mapping_id = client.get("/api/mappings").json()[0]["id"]
    with FIXTURE.open("rb") as fh:
        upload = client.post(
            "/api/uploads", files={"file": ("tracelab.jsonl.gz", fh, "application/gzip")}
        )
    assert upload.status_code == 201, upload.text
    info = upload.json()
    assert info["format"] == "jsonl" and info["record_count"] == 4770
    assert len(info["preview"]) == 20 and info["preview"][0]["locator"] == "line:1"
    assert info["already_imported"] == []

    preview = client.post(
        "/api/imports/preview",
        json={"upload_id": info["upload_id"], "mapping_id": mapping_id, "sample": 50},
    )
    assert preview.status_code == 200, preview.text
    assert (
        preview.json()["records"]["sampled"] == 50
        and preview.json()["entities"]["model_call"] == 50
    )

    created = client.post(
        "/api/imports",
        json={"upload_id": info["upload_id"], "mapping_id": mapping_id, "source": "tracelab"},
    )
    assert created.status_code == 201, created.text
    report = created.json()
    assert report["status"] == "committed"
    assert report["records"]["accepted"] == 4770 and report["entities"] == {
        "session": 80,
        "model_call": 4770,
        "tool_call": 5723,
    }
    assert client.get(f"/api/imports/{report['import_id']}").json()["status"] == "committed"
    assert [r["import_id"] for r in client.get("/api/imports").json()] == [report["import_id"]]
    assert client.get(f"/api/imports/{report['import_id']}/rejects").json() == []
    assert client.get("/api/imports/nope").status_code == 404

    sessions = client.get("/api/sessions", params={"source": "tracelab", "limit": 100}).json()
    assert len(sessions) == 80 and {s["agent"] for s in sessions} == {"claude-code", "codex"}
    codex_only = client.get("/api/sessions", params={"agent": "codex", "limit": 100}).json()
    assert len(codex_only) == 40

    detail = client.get(f"/api/sessions/{sessions[0]['id']}").json()
    assert detail["id"] == sessions[0]["id"] and detail["external_id"] == sessions[0]["external_id"]
    assert len(detail["model_calls"]) == sessions[0]["model_call_count"]
    assert detail["input_tokens"]["coverage"]["total"] == sessions[0]["model_call_count"]
    ref = detail["model_calls"][0]["raw_record"]
    raw = client.get("/api/raw-records", params=ref).json()
    assert raw["payload"]["session_id"] == sessions[0]["external_id"]
    assert sessions[0]["external_id"] in raw["payload_text"]
    assert json.loads(raw["payload_text"])["session_id"] == sessions[0]["external_id"]
    assert client.get("/api/sessions/nope").status_code == 404

    metrics = client.get("/api/metrics/summary", params={"source": "tracelab"}).json()
    assert metrics["sessions"]["value"] == 80 and metrics["model_calls"]["value"] == 4770
    assert metrics["input_tokens"]["coverage"] == {"known": 4770, "total": 4770}
    assert set(metrics["input_tokens"]["by_semantics"]) == {"tracelab-claude", "tracelab-codex"}
    assert metrics["input_tokens"]["definition"]
    empty = client.get("/api/metrics/summary", params={"source": "none"}).json()
    assert empty["sessions"]["value"] == 0 and empty["input_tokens"]["value"] is None

    with FIXTURE.open("rb") as fh:
        again = client.post(
            "/api/uploads", files={"file": ("copy.jsonl.gz", fh, "application/gzip")}
        ).json()
    assert [r["import_id"] for r in again["already_imported"]] == [report["import_id"]]
    second = client.post(
        "/api/imports",
        json={"upload_id": again["upload_id"], "mapping_id": mapping_id, "source": "tracelab"},
    ).json()
    assert second["status"] == "duplicate" and second["records"]["duplicate"] == 4770
    after = client.get("/api/metrics/summary", params={"source": "tracelab"}).json()
    assert after["model_calls"]["value"] == 4770  # nothing doubled


def test_errors_follow_the_contract(client: TestClient) -> None:
    bad = client.post("/api/uploads", files={"file": ("notes.txt", b"hello world", "text/plain")})
    assert bad.status_code == 400
    assert bad.json()["error"]["code"] == "invalid_input" and bad.json()["error"]["message"]
    missing = client.post(
        "/api/imports/preview", json={"upload_id": "x", "mapping_id": "y", "sample": 5}
    )
    assert missing.status_code == 404 and missing.json()["error"]["code"] == "not_found"
    too_many = client.post(
        "/api/imports/preview", json={"upload_id": "x", "mapping_id": "y", "sample": 5000}
    )
    assert too_many.status_code == 400
    assert too_many.json()["error"]["code"] == "invalid_input"
    assert too_many.json()["error"]["details"][0]["path"] == "body.sample"


def test_payload_text_keeps_big_integers_and_decimals_exact() -> None:
    from decimal import Decimal

    from agentscope_app.domain.jsonx import dumps_exact

    text = dumps_exact(
        {
            "native_id": 9007199254740993,
            "ratio": Decimal("1.00000000000000001"),
            "ok": True,
            "n": [1, None],
        }
    )
    assert "9007199254740993" in text and "1.00000000000000001" in text
    assert '"9007199254740993"' not in text and "true" in text and "null" in text


def test_client_routes_are_served_by_the_index_page(tmp_path: Path) -> None:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>AgentScope</title><div id=root></div>")
    (dist / "assets" / "app.js").write_text("console.log('app')")
    settings = Settings(
        _env_file=None,
        database_url=f"sqlite:///{tmp_path / 'db' / 'agentscope.sqlite3'}",
        raw_file_dir=tmp_path / "raw",
    )
    with TestClient(create_app(settings, web_dist=dist)) as client:
        assert client.get("/assets/app.js").text == "console.log('app')"
        for route in ("/", "/overview", "/sessions/ses_1", "/imports?offset=50"):
            response = client.get(route)
            assert response.status_code == 200 and "id=root" in response.text, route
        assert client.get("/assets/missing.js").status_code == 404  # real files keep real 404s
        assert client.get("/api/sessions/nope").status_code == 404  # the API is untouched
        assert client.get("/api/sessions/nope").json()["error"]["code"] == "not_found"
        typo = client.get("/api/metrics/sumary")  # an unknown API path is never the page
        assert typo.status_code == 404 and typo.json()["error"]["code"] == "not_found"
