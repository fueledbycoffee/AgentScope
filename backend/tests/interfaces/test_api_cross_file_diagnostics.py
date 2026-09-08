"""Import diagnostics round-trip, pagination and both sides of raw evidence."""

from collections import Counter

from tests.infrastructure.test_cross_file_claims import changed_rows
from tests.interfaces import test_api_multifile
from tests.interfaces.test_api_multifile import upload

client = test_api_multifile.client


def commit(client, *data):
    mapping = next(
        m["id"] for m in client.get("/api/mappings").json() if m["name"] == "tracelab-v1"
    )
    files = [
        {"upload_id": upload(client, "sample.jsonl", d)["upload_id"], "mapping_id": mapping}
        for d in data
    ]
    response = client.post("/api/imports", json={"source": "cross-file", "files": files})
    assert response.status_code == 201, response.text
    report = response.json()
    assert report["status"] in ("committed", "duplicate"), report
    return report


def test_commit_get_history_and_peer_evidence(client):
    first = commit(client, changed_rows([10, 20], "a"))
    report = commit(client, changed_rows([10, 30], "b"))
    assert report["duplicate_detection_version"] == 1
    assert report["warnings"]["suspected_duplicate"] == 1
    assert report["warnings"]["matching_claim_equal_projection"] == 3
    path = f"/api/imports/{report['import_id']}"
    assert client.get(path).json() == report
    assert report in client.get("/api/imports").json()
    page = client.get(path + "/diagnostics").json()
    assert page["total"] == 4 and page["conditions"] == []
    for item in page["items"]:
        assert item["peer"]["import_id"] == first["import_id"]
        for ref in (item, item["peer"]):
            response = client.get(
                "/api/raw-records",
                params={
                    "file_sha256": ref["file_sha256"],
                    "locator": ref["locator"],
                },
            )
            assert response.status_code == 200
            assert '"trace_key"' in response.json()["payload_text"]
    records = client.get(path + "/records").json()
    assert {r["outcome"] for r in records} == {"accepted"}
    counts = Counter()
    for r in records:
        counts.update(r["warning_counts"])
    assert dict(counts) == report["warnings"] == report["files"][0]["warnings"]
    replay = commit(client, changed_rows([10, 30], "b"))
    assert replay["duplicate_detection_version"] is None and replay["warnings"] == {}
    assert client.get(f"/api/imports/{replay['import_id']}/diagnostics").json()["total"] == 0


def test_diagnostics_filters_order_and_pages(client):
    report = commit(client, changed_rows([10] * 12, "a"), changed_rows([20] * 12, "b"))
    path = f"/api/imports/{report['import_id']}/diagnostics"
    sha = report["files"][0]["sha256"]
    params = {"file_sha256": sha, "code": "suspected_duplicate", "limit": 3, "offset": 8}
    page = client.get(path, params=params).json()
    assert page["total"] == 12
    assert [d["locator"] for d in page["items"]] == ["line:9", "line:10", "line:11"]
    page = client.get(path, params={**params, "locator": "line:10", "offset": 0}).json()
    assert page["total"] == 1 and len(page["items"]) == 1
    assert page["items"][0]["file_sha256"] == sha
    assert page["items"][0]["peer"]["import_id"] == report["import_id"]
    assert client.get(path, params={"offset": 999}).json()["items"] == []


def test_diagnostics_unknown_import_invalid_filter_and_empty(client):
    assert client.get("/api/imports/unknown/diagnostics").status_code == 404
    report = commit(client, changed_rows([10], "a"))
    path = f"/api/imports/{report['import_id']}/diagnostics"
    assert client.get(path).json() == {"items": [], "total": 0, "conditions": []}
    assert client.get(path, params={"code": "typo"}).status_code == 400
    assert client.get(path, params={"limit": 0}).status_code == 400
    assert client.get(path, params={"offset": -1}).status_code == 400
