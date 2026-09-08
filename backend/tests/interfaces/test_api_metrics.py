import json
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
    assert len(definitions) == 20
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


@pytest.mark.parametrize("origin", ["tool_calls", "model_calls"])
@pytest.mark.parametrize("bounded_witness", [False, True])
def test_returned_scopes_round_trip_after_every_grain_switch(client, origin, bounded_witness):
    container = client.app.state.container
    mapping_id = container.list_mappings.execute()[0].id
    records = []
    for session, tokens, other_day in [("s1", 10, "01"), ("s2", 5, "02")]:
        record = json.loads(_tracelab_line(session))
        model_day = other_day if origin == "model_calls" else "01"
        tool_day = other_day if origin == "tool_calls" else "01"
        record["input_tokens_total"] = tokens
        record["timing_events"] = [{"timestamp": f"2026-01-{model_day}T12:00:00Z"}]
        record["tools"] = [{"tool_name": "shell", "emitted_at": f"2026-01-{tool_day}T12:00:00Z"}]
        records.append(json.dumps(record) + "\n")
    info = container.store_upload.execute("january.jsonl", "".join(records).encode())
    report = container.commit_import.execute("tracelab", [FileBinding(info.upload_id, mapping_id)])
    assert report.status == "committed"

    def query(metric_id, scope, group_by=()):
        params = {key: value for key, value in scope.items() if value is not None}
        response = client.get(
            "/api/metrics/query", params={**params, "metric_id": metric_id, "group_by": group_by}
        )
        assert response.status_code == 200, response.text
        return response.json()

    initial_scope = {"model": "m", "tool": "shell"}
    if bounded_witness:
        initial_scope.update(
            started_from="2026-01-01T00:00:00Z", started_before="2026-02-01T00:00:00Z"
        )
    january = query(origin, initial_scope, ["started_day"])["buckets"][0]
    assert january["keys"] == ["2026-01-01"]
    assert january["result"]["value_text"] == "1"

    def check_scopes(metric_id, scope):
        groups = [] if metric_id == "imports_in_scope" else ["source"]
        result = query(metric_id, scope, groups)
        assert result["overall"]["value_text"] == ("10" if metric_id == "input_tokens" else "1")
        assert result["overall"]["coverage"] == {"known": 1, "total": 1}
        assert query(metric_id, result["scope"], groups) == result
        for expected, returned_scope in [
            (result["overall"], result["scope"]),
            *((bucket["result"], bucket["drill_scope"]) for bucket in result["buckets"]),
        ]:
            followed = query(metric_id, returned_scope)["overall"]
            for field in ("value_text", "recorded_sum_text", "coverage", "distribution"):
                assert followed[field] == expected[field]
            for partition in expected["semantics_partitions"]:
                followed = query(metric_id, partition["drill_scope"])["overall"]
                for field in ("value_text", "coverage", "distribution"):
                    assert followed[field] == partition[field]
                assert query("sessions", partition["drill_scope"])["overall"]["value_text"] == "1"
        return result["buckets"][0]["drill_scope"]

    # Each grain can follow each other grain, including another switch after a returned drill.
    metrics = ("input_tokens", "tool_calls", "sessions", "imports_in_scope")
    for first in metrics:
        scope = check_scopes(first, january["drill_scope"])
        for second in metrics:
            check_scopes(second, scope)


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


def test_scheduled_cost_exact_rates_semantics_splits_and_token_coverage(client, monkeypatch):
    from fractions import Fraction

    from agentscope_app.domain.pricing import ModelRates, PriceSchedule
    from agentscope_app.infrastructure.db import trace_query

    container = ingest(client)
    schedule = PriceSchedule(
        "offline-test-v1",
        {"vendor/model": ModelRates(Fraction("0.01"), Fraction("0.02"), Fraction("0.001"))},
    )
    monkeypatch.setattr(trace_query, "load_price_schedule", lambda: schedule)
    with container.uow_factory() as uow:
        calls = list(uow.session.scalars(select(m.ModelCall).order_by(m.ModelCall.id)))
        for call, tag, input_, output in zip(
            calls,
            ["tracelab-claude", "tracelab-codex", "unknown"],
            [100, 100, 50],
            [10, 10, 5],
            strict=True,
        ):
            call.model = "vendor/model"
            call.token_semantics = tag
            call.input_tokens, call.output_tokens = input_, output
            call.cache_read_tokens = 60 if tag == "tracelab-claude" else None
            call.cache_creation_tokens = 20 if tag == "tracelab-claude" else None
            call.reasoning_tokens = 4  # Never added to the output denominator/cost a second time.
        uow.commit()
    response = client.get(
        "/api/metrics/query", params={"metric_id": "scheduled_cost_usd", "group_by": "model"}
    )
    assert response.status_code == 200, response.text
    result = response.json()["overall"]
    assert result["schedule_version"] == "offline-test-v1"
    assert result["value_text"] is None
    assert result["recorded_sum_text"] == "0.66"
    assert result["priced_coverage"] == {"known": 100, "total": 275}
    assert result["coverage"] == {"known": 2, "total": 3}
    parts = {p["semantics"]: p for p in result["semantics_partitions"]}
    assert parts["tracelab-claude"]["value_text"] == "0.46"
    assert parts["tracelab-claude"]["priced_coverage"] == {"known": 90, "total": 110}
    assert parts["tracelab-codex"]["value_text"] == "0.2"
    assert parts["tracelab-codex"]["priced_coverage"] == {"known": 10, "total": 110}
    assert parts["unknown"]["value_text"] is None
    for tag, part in parts.items():
        response = client.get(
            "/api/metrics/query", params={"metric_id": "scheduled_cost_usd", "token_semantics": tag}
        )
        assert response.json()["overall"]["priced_coverage"] == part["priced_coverage"]
        if tag == "unknown":
            assert response.json()["overall"]["reason"] == (
                "No recorded tokens have both a rate and validated billing semantics."
            )
    monkeypatch.setattr(trace_query, "load_price_schedule", lambda: None)
    response = client.get("/api/metrics/query", params={"metric_id": "scheduled_cost_usd"})
    result = response.json()["overall"]
    assert result["schedule_version"] is None and result["value_text"] is None
    assert result["priced_coverage"] == {"known": 0, "total": 275}
    assert "schedule unavailable" in result["reason"]
