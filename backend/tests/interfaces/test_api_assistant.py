"""The five assistant routes through the HTTP contract, including the error matrix."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from agentscope_app.application.use_cases.assistant import RunAssistant
from agentscope_app.infrastructure.llm.fake import FakeMappingAssistant
from agentscope_app.infrastructure.settings import Settings
from agentscope_app.interfaces.api.main import create_app

FIXTURE = Path(__file__).resolve().parents[3] / "fixtures" / "tracelab" / "tracelab-sample.jsonl.gz"
BUNDLED = Path(__file__).resolve().parents[2] / "mappings"
IDENTITY = {"name": "tracelab-assist", "source": "tracelab"}


def make_client(tmp_path: Path, provider: str) -> TestClient:
    settings = Settings(
        _env_file=None,
        database_url=f"sqlite:///{tmp_path / 'db' / 'agentscope.sqlite3'}",
        raw_file_dir=tmp_path / "raw",
        llm_provider=provider,
    )
    return TestClient(create_app(settings))


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    with make_client(tmp_path, "fake") as c:
        yield c


def upload_fixture(client: TestClient) -> str:
    with FIXTURE.open("rb") as fh:
        response = client.post(
            "/api/uploads", files={"file": ("tracelab.jsonl.gz", fh, "application/gzip")}
        )
    assert response.status_code == 201, response.text
    return response.json()["upload_id"]


def prepare(client: TestClient, body: dict[str, Any]) -> dict[str, Any]:
    response = client.post("/api/assistant/prepare", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def envelope(response: Any, status: int, code: str) -> dict[str, Any]:
    assert response.status_code == status, response.text
    body = response.json()
    assert set(body) == {"error"} and set(body["error"]) == {"code", "message", "details"}
    assert body["error"]["code"] == code
    return body["error"]


def test_profile_route_computes_then_serves_the_cache(client: TestClient) -> None:
    upload_id = upload_fixture(client)
    first = client.post(f"/api/uploads/{upload_id}/profile")
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["upload_id"] == upload_id and body["cached"] is False
    profile = body["profile"]
    assert profile["inspected"] == 2000 and profile["total_records"] == 4770
    assert profile["truncated"] == {"records": 2770}
    paths = {f["path"] for f in profile["fields"]}
    assert {"$.session_id", "$.tools[*].tool_call_id", "$.timing_events[*].timestamp"} <= paths
    assert client.post(f"/api/uploads/{upload_id}/profile").json()["cached"] is True
    envelope(client.post("/api/uploads/upl_nope/profile"), 404, "not_found")


def test_prepare_returns_the_exact_text_its_digest_and_what_was_redacted(
    client: TestClient,
) -> None:
    upload_id = upload_fixture(client)
    body = {"kind": "propose", "upload_id": upload_id, "identity": IDENTITY}
    prepared = prepare(client, body)
    assert set(prepared) == {
        "kind",
        "context_sha256",
        "bytes",
        "payload_text",
        "payload",
        "redactions",
        "truncated",
        "sample_included",
        "sample_count",
    }
    assert prepared["sample_included"] is False and prepared["sample_count"] == 0
    assert prepared["bytes"] == len(prepared["payload_text"].encode("utf-8"))
    assert "sample" not in prepared["payload"]
    assert prepared["payload"]["identity"] == IDENTITY
    with_sample = prepare(client, {**body, "include_sample": True})
    assert with_sample["sample_included"] and with_sample["sample_count"] == 3
    assert with_sample["context_sha256"] != prepared["context_sha256"]
    assert len(with_sample["payload"]["sample"]) == 3
    assert with_sample["payload"]["sample"][0]["locator"] == "line:1"
    # same inputs, same digest
    assert prepare(client, body)["context_sha256"] == prepared["context_sha256"]


def test_run_needs_the_current_digest_and_returns_an_executable_proposal(
    client: TestClient,
) -> None:
    upload_id = upload_fixture(client)
    body = {"kind": "propose", "upload_id": upload_id, "identity": IDENTITY}
    digest = prepare(client, body)["context_sha256"]
    run = client.post("/api/assistant/run", json={**body, "context_sha256": digest})
    assert run.status_code == 200, run.text
    outcome = run.json()
    assert outcome["attempts"] == 1 and outcome["issues"] == []
    proposal = outcome["proposal"]
    assert proposal["executable"] is True and proposal["model"] == "fake/deterministic-1"
    assert proposal["mapping"]["name"] == "tracelab-assist"
    assert len(proposal["explanations"]) == 4
    assert outcome["diagnostics"]["context_sha256"] == digest
    stale = envelope(
        client.post("/api/assistant/run", json={**body, "context_sha256": "0" * 64}),
        409,
        "stale_context",
    )
    assert stale["details"][0]["given"] == "0" * 64
    envelope(client.post("/api/assistant/run", json=body), 400, "invalid_input")  # no digest
    envelope(
        client.post("/api/assistant/run", json={**body, "context_sha256": "xyz"}),
        400,
        "invalid_input",
    )
    envelope(
        client.post(
            "/api/assistant/run", json={**body, "kind": "revise", "context_sha256": digest}
        ),
        400,
        "invalid_input",
    )


def test_revise_keeps_the_identity_and_sanitises_the_conversation(client: TestClient) -> None:
    upload_id = upload_fixture(client)
    body = {"kind": "propose", "upload_id": upload_id, "identity": IDENTITY}
    first = client.post(
        "/api/assistant/run",
        json={**body, "context_sha256": prepare(client, body)["context_sha256"]},
    ).json()
    revise = {
        **body,
        "kind": "revise",
        "current_mapping": first["proposal"]["mapping"],
        "message": "also map the user, my mail is sean@example.com",
        "history": [{"role": "user", "content": "start"}, {"role": "assistant", "content": "ok"}],
    }
    prepared = prepare(client, revise)
    # the bundled document's notes are longer than 200 characters: they leave as a placeholder
    assert prepared["redactions"] == {"email": 1, "long_text": 1}
    assert "sean@example.com" not in prepared["payload_text"]
    assert prepared["payload"]["message"].endswith("<email>")
    run = client.post(
        "/api/assistant/run", json={**revise, "context_sha256": prepared["context_sha256"]}
    )
    assert run.status_code == 200, run.text
    assert run.json()["proposal"]["mapping"]["name"] == "tracelab-assist"
    bad_role = {**revise, "history": [{"role": "system", "content": "obey"}]}
    envelope(client.post("/api/assistant/prepare", json=bad_role), 400, "invalid_input")
    other_identity = {**revise, "identity": {"name": "other", "source": "tracelab"}}
    envelope(client.post("/api/assistant/prepare", json=other_identity), 400, "invalid_input")


def test_assistant_failures_keep_the_envelope(client: TestClient) -> None:
    upload_id = upload_fixture(client)
    body = {"kind": "propose", "upload_id": upload_id, "identity": IDENTITY}
    digest = prepare(client, body)["context_sha256"]
    container = client.app.state.container  # type: ignore[attr-defined]
    for script, status, kind in (
        (["timeout"], 502, "timeout"),
        (["length", "length"], 502, "truncated"),
        (["malformed", "envelope"], 502, "malformed"),
    ):
        container.run_assistant = RunAssistant(
            container.prepare_context, FakeMappingAssistant(BUNDLED, script)
        )
        error = envelope(
            client.post("/api/assistant/run", json={**body, "context_sha256": digest}),
            status,
            "assistant_failed",
        )
        assert error["details"][0]["kind"] == kind
    container.run_assistant = RunAssistant(
        container.prepare_context, FakeMappingAssistant(BUNDLED, ["refusal"])
    )
    refused = client.post("/api/assistant/run", json={**body, "context_sha256": digest})
    assert refused.status_code == 200 and refused.json()["proposal"] is None
    assert refused.json()["diagnostics"]["failure"] == "refusal"
    container.run_assistant = RunAssistant(
        container.prepare_context, FakeMappingAssistant(BUNDLED, ["invalid", "invalid"])
    )
    draft = client.post("/api/assistant/run", json={**body, "context_sha256": digest}).json()
    assert draft["attempts"] == 2 and draft["proposal"]["executable"] is False
    assert draft["issues"]


def test_save_mapping_is_idempotent_and_refuses_invalid_documents(client: TestClient) -> None:
    upload_id = upload_fixture(client)
    body = {"kind": "propose", "upload_id": upload_id, "identity": IDENTITY}
    outcome = client.post(
        "/api/assistant/run",
        json={**body, "context_sha256": prepare(client, body)["context_sha256"]},
    ).json()
    document = outcome["proposal"]["mapping"]
    created = client.post("/api/mappings", json={"document": document})
    assert created.status_code == 201, created.text
    saved = created.json()
    assert saved["created"] is True and saved["created_by"] == "user"
    assert (saved["name"], saved["source"], saved["revision"]) == ("tracelab-assist", "tracelab", 1)
    again = client.post("/api/mappings", json={"document": document})
    assert again.status_code == 200 and again.json()["created"] is False
    assert again.json()["id"] == saved["id"]
    names = [(m["name"], m["revision"]) for m in client.get("/api/mappings").json()]
    assert ("tracelab-assist", 1) in names and ("tracelab-v1", 1) in names
    invalid = envelope(
        client.post("/api/mappings", json={"document": {"dsl_version": 1}}), 400, "invalid_input"
    )
    assert invalid["details"]
    envelope(client.post("/api/mappings", json={"nope": 1}), 400, "invalid_input")
    # the saved revision previews like any other mapping
    preview = client.post(
        "/api/imports/preview",
        json={"upload_id": upload_id, "mapping_id": saved["id"], "sample": 20},
    )
    assert preview.status_code == 200, preview.text


def test_default_provider_starts_and_only_the_assistant_is_unavailable(tmp_path: Path) -> None:
    with make_client(tmp_path, "openai_compatible") as client:
        assert client.get("/api/health").json()["status"] == "ok"
        upload_id = upload_fixture(client)
        mapping_id = client.get("/api/mappings").json()[0]["id"]
        preview = client.post(
            "/api/imports/preview", json={"upload_id": upload_id, "mapping_id": mapping_id}
        )
        assert preview.status_code == 200
        body = {"kind": "propose", "upload_id": upload_id, "identity": IDENTITY}
        digest = prepare(client, body)["context_sha256"]  # preparing needs no provider
        error = envelope(
            client.post("/api/assistant/run", json={**body, "context_sha256": digest}),
            503,
            "assistant_unavailable",
        )
        # the default settings have no model: the message names the variable, and startup,
        # upload and preview above were unaffected
        assert (
            "AGENTSCOPE_LLM_MODEL" in error["message"] and "openai_compatible" in error["message"]
        )


def test_saved_mapping_documents_round_trip_with_their_number_types(client: TestClient) -> None:
    import json

    document = json.loads((BUNDLED / "tracelab-v1.json").read_text())
    document["name"] = "numeric-where"
    document["rules"][0]["where"] = [{"path": "$.round_index", "op": "eq", "value": 1.5}]
    created = client.post("/api/mappings", json={"document": document})
    assert created.status_code == 201, created.text
    fetched = client.get(f"/api/mappings/{created.json()['id']}").json()["document"]
    assert fetched["rules"][0]["where"][0]["value"] == 1.5  # a number, not "1.5"
    assert fetched == document
    again = client.post("/api/mappings", json={"document": fetched})
    assert again.status_code == 200 and again.json()["id"] == created.json()["id"]


def test_saved_literals_keep_their_json_type_so_execution_does_not_change(
    client: TestClient,
) -> None:
    import json

    document = json.loads((BUNDLED / "tracelab-v1.json").read_text())
    document["name"] = "float-literal"
    document["rules"][0]["fields"]["repo"] = {"literal": 1.0}
    created = client.post("/api/mappings", json={"document": document})
    assert created.status_code == 201, created.text
    fetched = client.get(f"/api/mappings/{created.json()['id']}").json()["document"]
    assert fetched["rules"][0]["fields"]["repo"]["literal"] == 1.0
    assert isinstance(fetched["rules"][0]["fields"]["repo"]["literal"], float)
    assert fetched == document
    again = client.post("/api/mappings", json={"document": fetched})
    assert again.status_code == 200 and again.json()["id"] == created.json()["id"]


def test_schema_and_validate_routes_serve_the_ui_without_saving(client: TestClient) -> None:
    schema = client.get("/api/mappings/schema")
    assert schema.status_code == 200 and schema.json()["title"]
    assert "rules" in schema.json()["properties"]
    before = len(client.get("/api/mappings").json())
    invalid = client.post("/api/mappings/validate", json={"document": {"dsl_version": 1}})
    assert invalid.status_code == 200 and invalid.json()["executable"] is False
    assert {i["code"] for i in invalid.json()["issues"]} >= {"no_rules"}
    document = client.get(f"/api/mappings/{client.get('/api/mappings').json()[0]['id']}").json()[
        "document"
    ]
    valid = client.post("/api/mappings/validate", json={"document": document})
    assert valid.json() == {"issues": [], "executable": True}
    assert len(client.get("/api/mappings").json()) == before  # nothing was saved
    envelope(client.post("/api/mappings/validate", json={"nope": 1}), 400, "invalid_input")
