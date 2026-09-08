from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from agentscope_app.application.dto import FileBinding
from agentscope_app.application.metric_queries import TraceScope
from agentscope_app.infrastructure.db import models as m
from agentscope_app.infrastructure.settings import Settings
from agentscope_app.interfaces.api.main import create_app
from tests.infrastructure.test_database import _tracelab_line


@pytest.fixture
def client(tmp_path):
    settings = Settings(
        _env_file=None,
        database_url=f"sqlite:///{tmp_path / 'metrics.sqlite3'}",
        raw_file_dir=tmp_path / "raw",
    )
    with TestClient(create_app(settings)) as client:
        yield client


def ingest(client):
    container = client.app.state.container
    mapping_id = container.list_mappings.execute()[0].id
    info = container.store_upload.execute(
        "metrics.jsonl", _tracelab_line("one") + _tracelab_line("two") + _tracelab_line("three")
    )
    report = container.commit_import.execute("tracelab", [FileBinding(info.upload_id, mapping_id)])
    assert report.status == "committed"
    with container.uow_factory() as uow:
        calls = list(uow.session.scalars(select(m.ModelCall).order_by(m.ModelCall.id)))
        for call, tag, amount in zip(
            calls, ["a", "b", None], [2**63 - 1, 2**53 + 1, None], strict=True
        ):
            call.token_semantics = tag
            call.input_tokens = amount
        uow.commit()
    return container


def test_metrics_http_metadata_coverage_and_exact_text(client):
    container = ingest(client)
    summary = client.get("/api/metrics/summary").json()
    assert set(summary) == {
        "sessions",
        "model_calls",
        "tool_calls",
        "input_tokens",
        "output_tokens",
    }
    metric = summary["input_tokens"]
    assert metric["value"] == 2**63 + 2**53
    assert metric["recorded_sum_text"] == str(2**63 + 2**53)
    assert metric["value_text"] is None and metric["comparability"] == "mixed"
    assert metric["reason"] == "not comparable: 2 token semantics in selection"
    assert metric["coverage"] == {"known": 2, "total": 3}
    assert metric["by_semantics"] == {"a": 2**63 - 1, "b": 2**53 + 1}
    assert len(metric["semantics_partitions"]) == 3
    assert metric["semantics_partitions"][-1]["coverage"] == {"known": 0, "total": 1}
    for metric in summary.values():
        assert metric["metric_id"] and metric["version"] == 1
        assert metric["definition"] and metric["unit"] and metric["reason"]
        assert set(metric["coverage"]) == {"known", "total"}
    definitions = client.get("/api/metrics/definitions").json()
    assert {d["id"] for d in definitions if d["headline_kpi"]} == {
        "sessions",
        "model_calls",
        "tool_calls",
        "input_tokens",
    }
    assert len(definitions) == 19
    by_id = {d["id"]: d for d in definitions}
    assert by_id["tool_wall_latency_ms"]["field"] == "wall_latency_ms"
    assert by_id["tool_internal_latency_ms"]["field"] == "internal_latency_ms"
    assert by_id["cache_read_tokens"]["unit"] == "tokens"
    assert by_id["unlinked_tools"]["population"] == "tool_is_unlinked"
    assert by_id["imports_in_scope"]["grain"] == "import"
    response = client.get(
        "/api/metrics/query", params={"metric_id": "input_tokens", "group_by": "model"}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["overall"]["recorded_sum_text"] == str(2**63 + 2**53)
    assert body["overall"]["comparability"] == "mixed"
    assert body["overall"]["value_text"] is None
    assert body["overall"]["coverage"] == {"known": 2, "total": 3}
    assert "value" not in body["overall"]
    partition = body["buckets"][0]["result"]["semantics_partitions"][0]
    drill = TraceScope(**partition["drill_scope"])
    with container.uow_factory() as uow:
        assert len(uow.trace_query.session_ids(drill, limit=100, offset=0)) == 1
    empty = client.get(
        "/api/metrics/query", params={"metric_id": "input_tokens", "source": "absent"}
    ).json()
    assert empty["overall"]["value_text"] is None
    assert empty["overall"]["coverage"] == {"known": 0, "total": 0}
    assert empty["overall"]["comparability"] == "unknown"
    counts = client.get(
        "/api/metrics/query", params={"metric_id": "model_calls", "source": "absent"}
    ).json()
    assert counts["overall"]["value_text"] == "0"
    assert counts["overall"]["coverage"] == {"known": 0, "total": 0}
    # Raw provenance stays raw while the metric normalizes the tag to unknown.
    sessions = container.list_sessions.execute(source=None, agent=None)
    assert any(
        container.get_session.execute(s.id).model_calls[0].token_semantics is None for s in sessions
    )


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"metric_id": "nope"},
        {"metric_id": "sessions", "group_by": "model"},
        {"metric_id": "sessions", "group_by": "nonsense"},
        {"metric_id": "sessions", "group_by": "session_id"},
        {"metric_id": "sessions", "started_from": "not-a-date"},
        {"metric_id": "sessions", "started_from": "2026-01-01T00:00:00"},
        {
            "metric_id": "sessions",
            "started_from": "2026-01-02T00:00:00Z",
            "started_before": "2026-01-01T00:00:00Z",
        },
        {"metric_id": "sessions", "activity_grain": "nonsense"},
        {"metric_id": "sessions", "activity_grain": "session"},
        {"metric_id": "sessions", "model": "m", "model_is_unknown": "true"},
        {"metric_id": "sessions", "timestamp_missing": "true"},
        {"metric_id": "model_calls", "group_by": ["model", "agent", "source"]},
        {"metric_id": "unlinked_tools", "tool_is_linked": "true"},
    ],
)
def test_invalid_metric_queries_always_use_400_envelope(client, params):
    response = client.get("/api/metrics/query", params=params)
    assert response.status_code == 400, response.text
    error = response.json()["error"]
    assert error["code"] == "invalid_input" and error["message"]
    assert error["details"]
    assert all(set(detail) == {"path", "message"} for detail in error["details"])


def test_http_offset_bounds_and_day_drill(client):
    ingest(client)
    response = client.get(
        "/api/metrics/query",
        params={
            "metric_id": "model_calls",
            "group_by": "started_day",
            "started_from": "2026-05-11T08:40:00+02:00",
            "started_before": "2026-05-11T08:40:01+02:00",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["overall"]["value_text"] == "3"
    assert body["buckets"][0]["keys"] == ["2026-05-11"]
    scope = body["buckets"][0]["drill_scope"]
    assert datetime.fromisoformat(scope["started_from"]).hour == 6
    assert scope["activity_grain"] == "model_call"


@pytest.mark.parametrize(
    "params",
    [
        [("metric_id", "sessions"), ("session_ids", "s")],
        [("metric_id", "sessions"), ("source", "a"), ("source", "b")],
        [("metric_id", "sessions"), ("started_form", "2026-01-01T00:00:00Z")],
    ],
)
def test_unknown_or_repeated_scope_parameters_return_400(client, params):
    response = client.get("/api/metrics/query", params=params)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_input"
    assert set(response.json()["error"]["details"][0]) == {"path", "message"}


def test_day_drill_round_trip_preserves_original_tool_witness(client):
    import json

    container = client.app.state.container
    mapping_id = container.list_mappings.execute()[0].id
    record = json.loads(_tracelab_line("drill"))
    record["tools"] = [{"tool_name": "shell", "emitted_at": "2026-05-10T12:00:00Z"}]
    info = container.store_upload.execute("drill.jsonl", (json.dumps(record) + "\n").encode())
    container.commit_import.execute("tracelab", [FileBinding(info.upload_id, mapping_id)])
    response = client.get(
        "/api/metrics/query",
        params={"metric_id": "model_calls", "group_by": "started_day", "tool": "shell"},
    )
    assert response.status_code == 200, response.text
    bucket = response.json()["buckets"][0]
    assert bucket["keys"] == ["2026-05-11"] and bucket["result"]["value_text"] == "1"
    scope = bucket["drill_scope"]
    assert scope["witness_time_override"] is True
    assert scope["witness_started_from"] is None
    params = {key: value for key, value in scope.items() if value is not None}
    params["metric_id"] = "sessions"
    drilled = client.get("/api/metrics/query", params=params)
    assert drilled.status_code == 200, drilled.text
    assert drilled.json()["overall"]["value_text"] == "1"
    # An independently requested same-day tool filter still correctly requires that day's tool.
    params["witness_time_override"] = False
    assert client.get("/api/metrics/query", params=params).json()["overall"]["value_text"] == "0"


@pytest.mark.parametrize(
    "params",
    [
        {"witness_time_override": True},
        {"witness_started_from": "2026-01-01T00:00:00Z"},
        {
            "witness_time_override": True,
            "activity_grain": "model_call",
            "witness_started_from": "2026-01-01T00:00:00",
        },
        {
            "witness_time_override": True,
            "activity_grain": "model_call",
            "witness_started_from": "2026-01-02T00:00:00Z",
            "witness_started_before": "2026-01-01T00:00:00Z",
        },
        {
            "witness_time_override": True,
            "activity_grain": "model_call",
            "witness_started_from": "2026-01-01T00:00:00Z",
            "witness_timestamp_missing": True,
        },
    ],
)
def test_invalid_witness_time_overrides_use_400(client, params):
    response = client.get("/api/metrics/query", params={"metric_id": "sessions", **params})
    assert response.status_code == 400, response.text
    assert response.json()["error"]["code"] == "invalid_input"


def test_observed_span_definition_and_empty_result(client):
    response = client.get("/api/metrics/query", params={"metric_id": "observed_span_ms"})
    assert response.status_code == 200
    body = response.json()
    assert body["definition"]["label"] == "observed span in imported data"
    assert "idle time and resumptions" in body["definition"]["caveat"]
    assert body["overall"]["value_text"] is None
    assert body["overall"]["coverage"] == {"known": 0, "total": 0}


def test_reasoning_model_groups_and_diagnostic_only_definition(client):
    ingest(client)
    response = client.get(
        "/api/metrics/query", params={"metric_id": "reasoning_tokens_distribution"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["group_by"] == ["model"]
    assert body["definition"]["display_decimal_places"] == 1
    assert "nearest-rank" in body["definition"]["quantile_rule"]
    response = client.get("/api/metrics/query", params={"metric_id": "reasoning_to_output_ratio"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_input"
    definitions = {d["id"]: d for d in client.get("/api/metrics/definitions").json()}
    assert definitions["reasoning_to_output_ratio"]["diagnostic"] is True
