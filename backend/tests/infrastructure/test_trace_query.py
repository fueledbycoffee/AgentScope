import sqlite3
from dataclasses import replace
from datetime import UTC, datetime

import pytest
from alembic import command
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Column, Integer, inspect, select, text
from sqlalchemy.orm import Session

from agentscope_app.application.dto import FileBinding
from agentscope_app.application.metric_queries import MetricQuerySpec, TraceScope, drill_scope
from agentscope_app.domain.metrics import REGISTRY, Dimension, EntityGrain, MetricRegistry, evaluate
from agentscope_app.infrastructure.db import models as m
from agentscope_app.infrastructure.db.engine import (
    alembic_config,
    create_engine_for,
    run_migrations,
)
from agentscope_app.infrastructure.db.metric_sql import create_metric_views, drop_metric_views
from agentscope_app.infrastructure.db.trace_query import SqlAlchemyTraceQuery
from agentscope_app.infrastructure.db.unit_of_work import make_uow_factory
from tests.infrastructure.test_database import _pipeline, _report, _tracelab_line, mapping_record
from tests.metric_reference import oracle, oracle_evaluation, population, synthetic_rows


@pytest.fixture
def database(tmp_path):
    engine = create_engine_for(f"sqlite:///{tmp_path / 'metrics.sqlite3'}")
    run_migrations(engine)
    uow_factory = make_uow_factory(engine)
    with uow_factory() as uow:
        uow.mappings.add(mapping_record())
        for import_id in ("i1", "i2"):
            uow.imports.add_report(_report(import_id, "alpha"))
        uow.commit()
    data = synthetic_rows()
    with Session(engine) as session:
        session.add_all(m.Session(**row) for row in data["session"])
        session.flush()
        for grain, cls in (("model_call", m.ModelCall), ("tool_call", m.ToolCall)):
            for row in data[grain]:
                source = next(s["source"] for s in data["session"] if s["id"] == row["session_id"])
                session.add(
                    cls(
                        **row,
                        source=source,
                        occurrence_key=row["id"],
                        file_sha256="f" * 64,
                        locator=row["id"],
                        emission_path=grain,
                    )
                )
            session.flush()
        session.commit()
    yield engine, data
    engine.dispose()


def sql_parts(query, spec):
    return {
        r.keys: {p.semantics: (p.value, p.known, p.total) for p in r.parts}
        for r in query.aggregate(spec).rows
    }


def value(query, metric_id, scope=None):
    spec = MetricQuerySpec(REGISTRY.get(metric_id), scope or TraceScope())
    return evaluate(spec.definition, [p for row in query.aggregate(spec).rows for p in row.parts])


SCOPES = [
    TraceScope(),
    TraceScope(source="alpha"),
    TraceScope(agent="a"),
    TraceScope(source="beta", agent_is_unknown=True),
    TraceScope(model="m"),
    TraceScope(tool="shell"),
    TraceScope(model="other", tool="read"),
    TraceScope(import_id="i1"),
    TraceScope(import_id="i2", model="m"),
    TraceScope(session_ids=()),
    TraceScope(session_ids=("empty",)),
    TraceScope(model_is_unknown=True),
    TraceScope(token_semantics="unknown"),
    TraceScope(tool_is_unlinked=True),
    TraceScope(usage_missing=True),
    TraceScope(timestamp_missing=True, activity_grain=EntityGrain.MODEL_CALL),
    TraceScope(
        started_from=datetime(2026, 1, 1, tzinfo=UTC),
        started_before=datetime(2026, 1, 2, tzinfo=UTC),
    ),
    TraceScope(model="m", started_from=datetime(2026, 1, 2, tzinfo=UTC)),
    TraceScope(tool="read", started_before=datetime(2026, 1, 2, tzinfo=UTC)),
]


@pytest.mark.parametrize("metric_id", [k for k in REGISTRY.definitions if k != "imports_in_scope"])
def test_sql_matches_reference_for_every_definition_and_scope(database, metric_id):
    engine, data = database
    definition = REGISTRY.get(metric_id)
    with Session(engine) as session:
        query = SqlAlchemyTraceQuery(session)
        for scope in SCOPES:
            if definition.population == "timestamp_missing" and scope.has_time_bounds:
                continue  # explicitly invalid specification
            for groups in [(), *((d,) for d in definition.supported_dimensions)]:
                spec = MetricQuerySpec(definition, scope, groups)
                expected = oracle(data, definition, spec.scope, groups)
                actual = sql_parts(query, spec)
                assert actual == expected, (metric_id, spec)
                for row in query.aggregate(spec).rows:
                    result = evaluate(definition, row.parts)
                    assert (
                        result.value,
                        result.recorded_sum,
                        result.known,
                        result.total,
                        result.comparability,
                    ) == oracle_evaluation(expected[row.keys], definition.unit == "tokens")


def test_new_definition_runs_without_adapter_changes_and_distinct_units(database):
    engine, data = database
    registry = MetricRegistry([replace(REGISTRY.get("cache_read_tokens"), id="new_cached_input")])
    with Session(engine) as session:
        query = SqlAlchemyTraceQuery(session)
        for metric_id, literal in [
            ("input_tokens", 10),
            ("output_tokens", 7),
            ("cache_read_tokens", 3),
            ("tool_wall_latency_ms", 1500),
            ("tool_internal_latency_ms", 400),
        ]:
            spec = MetricQuerySpec(
                REGISTRY.get(metric_id), TraceScope(import_id="i1", source="alpha")
            )
            assert sql_parts(query, spec) == oracle(data, spec.definition, spec.scope)
            result = value(query, metric_id, spec.scope)
            assert result.value == literal
        spec = MetricQuerySpec(registry.get("new_cached_input"))
        assert sql_parts(query, spec) == oracle(data, spec.definition, spec.scope)
        assert evaluate(spec.definition, query.aggregate(spec).rows[0].parts).value == 3
        assert value(query, "tool_wall_latency_ms", TraceScope(tool="read")).value is None
        assert value(query, "tool_internal_latency_ms", TraceScope(tool="read")).value == 200


def test_unknown_timestamps_and_utc_boundaries(database):
    engine, _ = database
    with Session(engine) as session:
        query = SqlAlchemyTraceQuery(session)
        definition = REGISTRY.get("model_calls")
        day = TraceScope(
            started_from=datetime.fromisoformat("2026-01-01T02:00:00+02:00"),
            started_before=datetime.fromisoformat("2026-01-02T02:00:00+02:00"),
        )
        utc = TraceScope(
            started_from=datetime(2026, 1, 1, tzinfo=UTC),
            started_before=datetime(2026, 1, 2, tzinfo=UTC),
        )
        assert value(query, "model_calls", day).value == 2
        assert sql_parts(query, MetricQuerySpec(definition, day)) == sql_parts(
            query, MetricQuerySpec(definition, utc)
        )
        assert query.aggregate(MetricQuerySpec(definition, day)).excluded_unknown_timestamps == 2
        spec = MetricQuerySpec(definition, group_by=(Dimension.STARTED_DAY,))
        results = sql_parts(query, spec)
        assert results[(None,)][None] == (2, 2, 2)
        assert results[("2026-01-01",)][None] == (2, 2, 2)
        scope = drill_scope(spec, ("2026-01-01",))
        assert scope.started_from == datetime(2026, 1, 1, tzinfo=UTC)
        assert scope.started_before == datetime(2026, 1, 2, tzinfo=UTC)


def test_time_and_child_predicates_require_same_witness(database):
    engine, data = database
    with Session(engine) as session:
        query = SqlAlchemyTraceQuery(session)
        for scope in SCOPES:
            ids = sorted(r["id"] for r in population(data, "session", scope))
            assert list(query.session_ids(scope, limit=100, offset=0)) == ids
        scope = TraceScope(model="m", started_from=datetime(2026, 1, 2, tzinfo=UTC))
        assert query.session_ids(scope, limit=100, offset=0) == []
        assert value(query, "sessions", scope).value == 0
        # Tool on Jan 2 must not witness model activity for s1 under model m.
        scope = replace(scope, activity_grain=EntityGrain.MODEL_CALL)
        assert query.session_ids(scope, limit=100, offset=0) == []


def test_chart_drill_scope_matches_session_ids(database):
    engine, data = database
    with Session(engine) as session:
        query = SqlAlchemyTraceQuery(session)
        for metric_id, groups in [
            ("model_calls", (Dimension.STARTED_DAY,)),
            ("input_tokens", (Dimension.MODEL, Dimension.AGENT)),
            ("tool_calls", (Dimension.TOOL_NAME, Dimension.LINKED)),
            ("unlinked_tools", (Dimension.STARTED_DAY,)),
            ("unknown_timestamps", (Dimension.MODEL,)),
            ("missing_usage", (Dimension.MODEL,)),
        ]:
            spec = MetricQuerySpec(REGISTRY.get(metric_id), group_by=groups)
            for row in query.aggregate(spec).rows:
                for part in row.parts:
                    scope = drill_scope(spec, row.keys, part.semantics)
                    expected = sorted(
                        {r["session_id"] for r in population(data, spec.definition.grain, scope)}
                    )
                    actual = list(query.session_ids(scope, limit=100, offset=0))
                    assert actual == expected
                    paged = [
                        *query.session_ids(scope, limit=1, offset=0),
                        *query.session_ids(scope, limit=100, offset=1),
                    ]
                    assert paged == expected
        assert value(query, "unlinked_tools").value == 2
        assert query.session_ids(
            TraceScope(model="other", usage_missing=True), limit=100, offset=0
        ) == ["s1"]


def test_semantics_partitions_and_unknown_normalization(database):
    engine, _ = database
    with Session(engine) as session:
        query = SqlAlchemyTraceQuery(session)
        spec = MetricQuerySpec(REGISTRY.get("input_tokens"))
        assert sql_parts(query, spec) == {
            (): {
                "a": (10, 2, 2),
                "b": (None, 0, 1),
                "unknown": (15, 3, 3),
            }
        }
        assert value(query, "input_tokens").comparability == "unknown"
        result = value(query, "input_tokens", TraceScope(source="alpha"))
        assert (result.value, result.known, result.total) == (10, 2, 3)
        assert value(query, "input_tokens", TraceScope(session_ids=("empty",))).value is None
        assert value(query, "model_calls", TraceScope(session_ids=())).value == 0


def test_exact_sum_exceeds_js_and_sqlite_integer_ranges(database):
    engine, _ = database
    with Session(engine) as session:
        for index, amount in enumerate([2**53 + 1, 2**63 - 1]):
            session.get(m.ModelCall, f"c{index}").input_tokens = amount
        session.flush()
        result = value(SqlAlchemyTraceQuery(session), "input_tokens", TraceScope(source="alpha"))
        assert result.value == 2**53 + 2**63
        assert isinstance(result.value, int)


def test_join_multiplication_import_scope_and_reimport(tmp_path):
    engine = create_engine_for(f"sqlite:///{tmp_path / 'ingested.sqlite3'}")
    run_migrations(engine)
    uow_factory, upload, commit, _, _ = _pipeline(engine, tmp_path)
    import json

    first = json.loads(_tracelab_line("s"))
    first["tools"] = [{"tool_name": "shell"}, {"tool_name": "read"}]
    second = json.loads(_tracelab_line("s"))
    second["round_index"] = 1
    second["tools"] = [{"tool_name": "shell"}]
    payload = (json.dumps(first) + "\n" + json.dumps(second) + '\n{"provider":"claude"}\n').encode()
    info = upload.execute("fanout.jsonl", payload)
    report = commit.execute("tracelab", [FileBinding(info.upload_id, "map_tracelab")])
    assert report.status == "committed" and report.reject_count > 0
    with Session(engine) as session:
        query = SqlAlchemyTraceQuery(session)
        assert len(list(session.scalars(select(m.EntityContribution)))) > 1
        for metric_id, literal in [
            ("sessions", 1),
            ("model_calls", 2),
            ("tool_calls", 3),
            ("input_tokens", 20),
            ("imports_in_scope", 1),
        ]:
            assert value(query, metric_id).value == literal
            assert value(query, metric_id, TraceScope(import_id=report.import_id)).value == literal
        assert value(query, "input_tokens").known == 2
        for cls in (m.ModelCall, m.ToolCall):
            assert all(
                c.source == session.get(m.Session, c.session_id).source
                for c in session.scalars(select(cls))
            )
    # A second import contributes to the same session; a duplicate contributes zero.
    third = json.loads(_tracelab_line("s"))
    third["round_index"] = 2
    info2 = upload.execute("more.jsonl", (json.dumps(third) + "\n").encode())
    report2 = commit.execute("tracelab", [FileBinding(info2.upload_id, "map_tracelab")])
    duplicate = commit.execute("tracelab", [FileBinding(info.upload_id, "map_tracelab")])
    assert duplicate.status == "duplicate"
    with Session(engine) as session:
        query = SqlAlchemyTraceQuery(session)
        assert value(query, "sessions").value == 1
        assert value(query, "model_calls").value == 3
        assert value(query, "imports_in_scope").value == 2
        assert value(query, "model_calls", TraceScope(import_id=report2.import_id)).value == 1
        for metric_id in ("imports_in_scope", "sessions", "model_calls", "tool_calls"):
            assert value(query, metric_id, TraceScope(import_id=duplicate.import_id)).value == 0
        assert value(query, "imports_in_scope", TraceScope(tool="shell")).value == 2
        tool_scope = TraceScope(tool="shell", activity_grain=EntityGrain.TOOL_CALL)
        assert value(query, "imports_in_scope", tool_scope).value == 1
    engine.dispose()


def test_metric_views_upgrade_downgrade_and_connection_reopen(tmp_path):
    engine = create_engine_for(f"sqlite:///{tmp_path / 'migration.sqlite3'}")
    with engine.begin() as connection:
        config = alembic_config(engine)
        config.attributes["connection"] = connection
        command.upgrade(config, "0004")
        connection.execute(
            text(
                "INSERT INTO sessions (id, source, external_id, model_call_count, "
                "tool_call_count) VALUES ('s', 'a', 's', 0, 0)"
            )
        )
    run_migrations(engine)
    run_migrations(engine)
    assert len(inspect(engine).get_view_names()) == 3
    assert "metric_sessions_v1" not in m.Base.metadata.tables
    with engine.begin() as connection:
        assert connection.execute(text("SELECT count(*) FROM metric_sessions_v1")).scalar() == 1
        drop_metric_views(connection)
        operations = Operations(MigrationContext.configure(connection))
        with operations.batch_alter_table("model_calls", recreate="always") as batch:
            batch.add_column(Column("test_metric_column", Integer))
        create_metric_views(connection)
        assert connection.execute(text("SELECT count(*) FROM metric_sessions_v1")).scalar() == 1
    engine.dispose()
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT exact_int_sum(9007199254740993)")).scalar()
            == "9007199254740993"
        )
        assert connection.execute(text("SELECT exact_int_sum(NULL)")).scalar() is None
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.downgrade(config, "0004")
    assert inspect(engine).get_view_names() == []
    with engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM sessions")).scalar() == 1
    raw = sqlite3.connect(":memory:")
    with pytest.raises(sqlite3.OperationalError, match="no such function"):
        raw.execute("SELECT exact_int_sum(1)")
    raw.close()
    engine.dispose()
