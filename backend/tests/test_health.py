from fastapi.testclient import TestClient

from agentscope_app.interfaces.api.main import create_app


def test_health_reports_ok_and_version() -> None:
    client = TestClient(create_app())

    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert isinstance(body["version"], str) and body["version"]
