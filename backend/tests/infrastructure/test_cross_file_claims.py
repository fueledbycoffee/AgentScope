"""Synthetic collisions and old-database upgrades; no uploaded datasets required."""

from __future__ import annotations

import json
import random
from collections import Counter
from dataclasses import replace

import pytest
from alembic import command
from sqlalchemy import event, text

from agentscope_app.application.dto import FileBinding
from agentscope_app.domain.claims import ClaimCandidate, prepare_claims
from agentscope_app.domain.identity import SourceOccurrence
from agentscope_app.domain.mapping.interpreter import apply_mapping
from agentscope_app.domain.mapping.parser import parse_mapping
from agentscope_app.infrastructure.db import claims as claims_module
from agentscope_app.infrastructure.db.claims import DETECTION_SQL, ClaimIndex
from agentscope_app.infrastructure.db.engine import alembic_config, run_migrations
from agentscope_app.infrastructure.db.models import Base
from tests.infrastructure import test_multifile_import
from tests.infrastructure.test_database import _tracelab_line, mapping_record
from tests.infrastructure.test_multifile_import import Env

env = test_multifile_import.env


def imported(env: Env, rows=None):
    data = b"".join(_tracelab_line(s) for s in (rows or ["s"]))
    upload = env.upload.execute("a.jsonl", data)
    report = env.commit.execute("src", [FileBinding(upload.upload_id, "map_tracelab")])
    assert report.status == "committed", report.error
    return upload, report, data


def migrate(env: Env, direction, revision):
    config = alembic_config(env.engine)
    with env.engine.begin() as c:
        config.attributes["connection"] = c
        getattr(command, direction)(config, revision)


def snapshots(env):
    return {
        table: env.sql(f"SELECT * FROM {table}")
        for table in (
            "model_calls",
            "tool_calls",
            "sessions",
            "entity_contributions",
            "record_results",
        )
    }


def test_0005_backfill_matches_live_claims(env: Env):
    upload, report, data = imported(env, ["s", "s", "t"])
    spec = parse_mapping(mapping_record().document).spec
    emissions = [
        e
        for n, line in enumerate(data.splitlines(), 1)
        for e in apply_mapping(
            spec, json.loads(line), file_sha256=upload.sha256, locator=f"line:{n}"
        ).emissions
    ]
    expected = prepare_claims("src", emissions, {upload.sha256: spec})
    before = snapshots(env)
    migrate(env, "downgrade", "0004")
    run_migrations(env.engine)
    assert snapshots(env) == before
    actual = env.sql(
        "SELECT s.scope_text,p.projection_text,c.locator,c.emission_path "
        "FROM entity_claims c JOIN claim_scopes s ON s.id=c.scope_id "
        "JOIN claim_projections p ON p.scope_id=c.scope_id "
        "AND p.projection_sha256=c.projection_sha256"
    )
    assert sorted(actual) == sorted(
        (c.scope_text, c.projection_text, c.occurrence.locator, c.occurrence.emission_path)
        for c in expected.claims
    )
    assert env.sql("SELECT duplicate_detection_version FROM imports") == [(None,)]
    assert env.sql("SELECT COUNT(*) FROM import_diagnostics") == [(0,)]
    assert env.sql("SELECT COUNT(*) FROM import_claim_conditions") == [(0,)]
    assert env.sql("SELECT warnings FROM imports WHERE id=:i", i=report.import_id) == [
        (json.dumps(report.warnings, ensure_ascii=False, separators=(",", ":")),)
    ]


def numeric_mapping(env, field, value, mode):
    original = mapping_record()
    document = original.document
    fields = {"external_id": {"literal": "s"}, "agent": {"literal": "h"}}
    fields[field] = (
        {"literal": value}
        if mode == "literal"
        else {"path": "$.missing", "on_missing": "default", "default": value}
    )
    document["rules"] = [{**document["rules"][0], "fields": fields}]
    mapping = replace(
        original, id="numeric", name="numeric", content_hash="numeric", document=document
    )
    with env.uow_factory() as uow:
        uow.mappings.add(mapping)
        uow.commit()
    return mapping.id


@pytest.mark.parametrize("mode", ["literal", "default"])
@pytest.mark.parametrize("field", ["external_id", "repo"])
@pytest.mark.parametrize("value", [1, 1.0, 1e20, 0.125, -0.0, 9007199254740993])
def test_0005_numeric_mapping_backfill_matches_live_text(env: Env, field, value, mode):
    mapping = numeric_mapping(env, field, value, mode)
    _, report = commit_data(env, b"{}\n", mapping=mapping)
    assert report.records["accepted"] == 1
    query = (
        "SELECT s.scope_text,p.projection_text,c.locator,c.emission_path "
        "FROM entity_claims c JOIN claim_scopes s ON s.id=c.scope_id "
        "JOIN claim_projections p ON p.scope_id=c.scope_id "
        "AND p.projection_sha256=c.projection_sha256"
    )
    live = env.sql(query)
    assert len(live) == 1
    before = snapshots(env)
    migrate(env, "downgrade", "0004")
    run_migrations(env.engine)
    assert snapshots(env) == before
    # Compare exact stored canonical text, not decoded JSON numeric equality.
    assert env.sql(query) == live
    assert env.sql("SELECT code,message FROM import_claim_conditions") == []


@pytest.mark.parametrize("mode", ["literal", "default"])
@pytest.mark.parametrize("field,value", [("external_id", 1.0), ("repo", 1e20)])
def test_0005_numeric_mapping_reexport_matches_historical_claim(env: Env, field, value, mode):
    mapping = numeric_mapping(env, field, value, mode)
    original, _ = commit_data(env, b"{}\n", mapping=mapping)
    migrate(env, "downgrade", "0004")
    run_migrations(env.engine)
    reexport, report = commit_data(env, b"{ }\n", mapping=mapping)
    assert reexport.sha256 != original.sha256
    assert report.status == "committed"
    assert report.warnings == {"matching_claim_equal_projection": 1}
    with env.uow_factory() as uow:
        diagnostics = uow.imports.diagnostics(report.import_id, None, None, None, 50, 0)
    assert diagnostics.total == 1
    assert diagnostics.items[0].peer.file_sha256 == original.sha256


@pytest.mark.parametrize("damage", ["raw_records", "entity_contributions", "record_results"])
def test_0005_missing_provenance_upgrade_succeeds_unchecked(env: Env, damage):
    _, report, _ = imported(env, ["s", "t"])
    migrate(env, "downgrade", "0004")
    with env.engine.begin() as c:
        c.execute(text(f"DELETE FROM {damage} WHERE locator='line:2'"))
    before = snapshots(env)
    run_migrations(env.engine)
    assert snapshots(env) == before
    assert env.sql("SELECT version_num FROM alembic_version") == [("0005",)]
    assert env.sql("SELECT duplicate_detection_version FROM imports") == [(None,)]
    assert env.sql("SELECT COUNT(*) FROM entity_claims") == [(0,)]
    conditions = env.sql(
        "SELECT code,message FROM import_claim_conditions WHERE import_id=:i", i=report.import_id
    )
    assert len(conditions) == 1 and conditions[0][0] == "claim_backfill_unavailable"
    assert "provenance" in conditions[0][1]


def test_0005_replay_mismatch_upgrade_succeeds_unchecked(env: Env):
    imported(env)
    migrate(env, "downgrade", "0004")
    with env.engine.begin() as c:
        c.execute(text("UPDATE model_calls SET input_tokens=987"))
    run_migrations(env.engine)
    assert env.sql("SELECT duplicate_detection_version FROM imports") == [(None,)]
    assert env.sql("SELECT COUNT(*) FROM entity_claims") == [(0,)]
    assert "input_tokens" in env.sql("SELECT message FROM import_claim_conditions")[0][0]
    assert env.sql("SELECT input_tokens FROM model_calls") == [(987,)]


def test_0005_upgrade_downgrade_upgrade(env: Env):
    imported(env)
    before = snapshots(env)
    for _ in range(2):
        migrate(env, "downgrade", "0004")
        run_migrations(env.engine)
        assert snapshots(env) == before
        assert env.sql("SELECT COUNT(*) FROM entity_claims") == [(2,)]


def stage_synthetic(env, candidates, pages=128):
    # Reuse a valid import/mapping FK while exercising the index independently of mapping.
    _, report, _ = imported(env)
    with env.engine.begin() as c:
        for sha in sorted({e.occurrence.file_sha256 for e in candidates}):
            c.execute(
                text("INSERT OR IGNORE INTO raw_files VALUES (:sha,1,'','2026-01-01')"),
                {"sha": sha},
            )
        index = ClaimIndex(c, Base.metadata.tables)
        index.stage(
            report.import_id,
            {e.occurrence.file_sha256: "map_tracelab" for e in candidates},
            candidates,
        )
        return report, index.detect(report.import_id)


def candidate(file, projection, n, scope="scope"):
    return ClaimCandidate(
        SourceOccurrence(file, f"line:{n}", "model_call"),
        "model_call",
        "model_call",
        scope,
        projection,
    )


def test_detection_matches_bruteforce_oracle(env: Env):
    rng = random.Random(33)
    candidates = [
        candidate(f"f{rng.randrange(5)}", f"p{rng.randrange(8)}", n, f"s{rng.randrange(10)}")
        for n in range(400)
    ]
    _, rows = stage_synthetic(env, candidates)
    expected = {}
    for e in candidates:
        peers = [
            p
            for p in candidates
            if p.scope_text == e.scope_text and p.occurrence.file_sha256 != e.occurrence.file_sha256
        ]
        if peers:
            equal = any(p.projection_text == e.projection_text for p in peers)
            expected[e.occurrence.locator] = (
                "matching_claim_equal_projection" if equal else "suspected_duplicate"
            )
    assert {r["locator"]: r["code"] for r in rows} == expected
    for r in rows:
        assert r["file_sha256"] != r["peer_file_sha256"]


def test_identical_reexport_with_repeated_native_keys_is_not_suspected(env: Env):
    _, rows = stage_synthetic(
        env, [candidate(f, p, n) for f in ("a", "b") for n, p in enumerate(("P1", "P2", "P1"))]
    )
    assert Counter(r["code"] for r in rows) == {"matching_claim_equal_projection": 6}


def test_lookup_uses_indexes_and_bounded_pages(env: Env, monkeypatch):
    monkeypatch.setattr(claims_module, "PAGE_SIZE", 128)
    captured = []

    def record(conn, cursor, statement, parameters, context, executemany):
        captured.append((statement, parameters, executemany))

    event.listen(env.engine, "before_cursor_execute", record)
    candidates = [candidate("a", f"p{n}", n) for n in range(1000)]
    candidates.append(candidate("b", "changed", 0))
    report, rows = stage_synthetic(env, candidates)
    assert len(rows) == len(candidates)
    detection = [s for s, _, _ in captured if s.startswith("\nWITH candidates")]
    assert len(detection) == 9  # one live-import warmup page, then eight synthetic pages
    assert all(len(p) <= 999 for _, p, many in captured if not many)
    with env.engine.connect() as c:
        plans = [
            r[-1]
            for r in c.execute(
                text("EXPLAIN QUERY PLAN " + DETECTION_SQL),
                {"import_id": report.import_id, "after": 0, "limit": 128},
            )
        ]
    assert sum("ix_claim_file_scope" in p for p in plans) == 2
    assert any("sqlite_autoindex_claim_file_projections" in p for p in plans)
    assert not any("SCAN f" in p for p in plans)


def commit_data(env, data, source="src", mapping="map_tracelab"):
    upload = env.upload.execute("synthetic.jsonl", data)
    report = env.commit.execute(source, [FileBinding(upload.upload_id, mapping)])
    assert report.status in ("committed", "duplicate"), report.error
    return upload, report


def changed_rows(values, salt=""):
    base = json.loads(_tracelab_line("same"))
    return b"".join(
        json.dumps({**base, "input_tokens_total": v, "salt": salt}).encode() + b"\n" for v in values
    )


def test_equal_and_different_projections_across_committed_files(env: Env):
    a, first = commit_data(env, changed_rows([10, 20], "a"))
    b, second = commit_data(env, changed_rows([10, 30], "b"))
    assert first.warnings.get("suspected_duplicate", 0) == 0
    assert second.warnings["suspected_duplicate"] == 1
    assert second.warnings["matching_claim_equal_projection"] == 3  # two sessions + equal call
    assert second.entities == {"model_call": 2}
    assert second.records["accepted"] == 2
    assert env.sql("SELECT SUM(input_tokens) FROM model_calls") == [(70,)]
    with env.uow_factory() as uow:
        assert uow.imports.get(second.import_id) == second
        assert uow.imports.get(first.import_id) == first
        records = uow.imports.records(second.import_id, None, None, 50, 0)
        rollup = Counter()
        for record in records:
            rollup.update(record.warning_counts)
        assert dict(rollup) == second.warnings == second.files[0].warnings
        diagnostics = uow.imports.diagnostics(second.import_id, None, None, None, 50, 0)
        assert diagnostics.total == 4
        assert all(d.peer.file_sha256 == a.sha256 for d in diagnostics.items)
        assert all(d.peer.import_id == first.import_id for d in diagnostics.items)
    _, replay = commit_data(env, changed_rows([10, 30], "b"))
    assert replay.status == "duplicate" and replay.warnings == {}
    assert replay.duplicate_detection_version is None and replay.files[0].warnings == {}
    assert replay.files[0].duplicate_of == second.import_id


def test_matching_equal_projection_is_counted_for_repeated_reexport(env: Env):
    commit_data(env, changed_rows([10, 20, 10], "a"))
    _, second = commit_data(env, changed_rows([10, 20, 10], "b"))
    assert second.warnings.get("suspected_duplicate", 0) == 0
    assert second.warnings["matching_claim_equal_projection"] == 6
    assert second.records["accepted"] == 3 and second.entities == {"model_call": 3}


@pytest.mark.parametrize("reverse", [False, True])
@pytest.mark.parametrize("chunk", [1, 2, 128])
def test_same_attempt_is_order_independent(env: Env, monkeypatch, reverse, chunk):
    monkeypatch.setattr(claims_module, "PAGE_SIZE", chunk)
    uploads = [
        env.upload.execute("a.jsonl", changed_rows([10], "a")),
        env.upload.execute("b.jsonl", changed_rows([20], "b")),
    ]
    bindings = [FileBinding(u.upload_id, "map_tracelab") for u in uploads]
    report = env.commit.execute("src", list(reversed(bindings)) if reverse else bindings)
    assert report.status == "committed", report.error
    assert report.warnings["suspected_duplicate"] == 2
    assert report.warnings["matching_claim_equal_projection"] == 2
    assert all(f.warnings["suspected_duplicate"] == 1 for f in report.files)


@pytest.mark.parametrize("kind", ["session", "model_call"])
def test_healthy_optional_unmapped_field_has_one_condition_per_file_rule(env: Env, kind):
    from dataclasses import replace

    original = mapping_record()
    document = json.loads(json.dumps(original.document))
    document["rules"] = [r for r in document["rules"] if r["entity"] == kind]
    if kind == "session":
        del document["rules"][0]["fields"]["agent"]
    mapping = replace(
        original, id="optional", name="optional", content_hash="optional", document=document
    )
    with env.uow_factory() as uow:
        uow.mappings.add(mapping)
        uow.commit()
    _, report = commit_data(env, changed_rows([10] * 150), mapping="optional")
    assert report.status == "committed" and report.records["accepted"] == 150
    assert "claim_scope_unavailable" not in report.warnings
    assert "claim_scope_unavailable" not in report.files[0].warnings
    conditions = report.files[0].claim_conditions
    assert len(conditions) == 1 and conditions[0].affected_emissions == 150
    assert conditions[0].code == "claim_scope_unavailable"
    assert env.sql("SELECT COUNT(*) FROM import_claim_conditions") == [(1,)]
    assert env.sql("SELECT COUNT(*) FROM import_diagnostics") == [(0,)]
    assert env.sql("SELECT COUNT(*) FROM sessions") == [(1,)]  # implicit session still works
    with env.uow_factory() as uow:
        assert uow.imports.get(report.import_id) == report
        assert all(
            "claim_scope_unavailable" not in r.warning_counts
            for r in uow.imports.records(report.import_id, None, None, 500, 0)
        )


def test_timestamp_change_flags_call_but_parent_model_change_leaves_tool_equal(env: Env):
    base = json.loads(_tracelab_line("tool"))
    base["tools"] = [{"tool_call_id": "t", "tool_name": "read", "tool_wall_latency_ms": 15}]
    commit_data(env, json.dumps(base).encode() + b"\n")
    base["model"] = "new-model"
    base["timing_events"][0]["timestamp"] = "2026-05-11T06:41:00Z"
    _, report = commit_data(env, json.dumps(base).encode() + b"\n")
    assert report.warnings["suspected_duplicate"] == 1
    with env.uow_factory() as uow:
        page = uow.imports.diagnostics(report.import_id, None, None, None, 50, 0)
    assert {d.entity: d.code for d in page.items} == {
        "session": "matching_claim_equal_projection",
        "model_call": "suspected_duplicate",
        "tool_call": "matching_claim_equal_projection",
    }
    assert report.entities == {"model_call": 1, "tool_call": 1}


def test_partial_record_keeps_each_accepted_emission_diagnostic(env: Env):
    base = json.loads(_tracelab_line("partial"))
    base["tools"] = [{"tool_call_id": "valid", "tool_name": "read"}, {"tool_call_id": "bad"}]
    commit_data(env, json.dumps(base).encode() + b"\n")
    base["input_tokens_total"] = 25
    base["tools"][0]["tool_name"] = "write"
    _, report = commit_data(env, json.dumps(base).encode() + b"\n")
    assert report.records["partial"] == 1 and report.records["accepted"] == 0
    assert report.warnings["suspected_duplicate"] == 2
    assert report.entities == {"model_call": 1, "tool_call": 1}
    assert env.sql("SELECT COUNT(*) FROM entity_claims WHERE import_id=:i", i=report.import_id) == [
        (3,)
    ]


def test_0005_parquet_replay_and_broken_file_are_independent(env: Env):
    from tests.parquet_support import parquet_file, parquet_rows

    good = env.upload.execute("good.parquet", parquet_file(parquet_rows("p", 3)))
    bad, _, _ = imported(env)
    report = env.commit.execute("src", [FileBinding(good.upload_id, "map_parquet")])
    assert report.status == "committed", report.error
    before_claims = env.sql(
        "SELECT scope_id,projection_sha256,locator,entity FROM entity_claims "
        "WHERE import_id=:i ORDER BY locator,entity",
        i=report.import_id,
    )
    before = snapshots(env)
    migrate(env, "downgrade", "0004")
    with env.engine.begin() as c:
        c.execute(text("DELETE FROM raw_records WHERE file_sha256=:f"), {"f": bad.sha256})
    run_migrations(env.engine)
    assert snapshots(env) == before
    after_claims = env.sql(
        "SELECT scope_id,projection_sha256,locator,entity FROM entity_claims "
        "WHERE import_id=:i ORDER BY locator,entity",
        i=report.import_id,
    )
    # Intern IDs may change; versioned projection digests and provenance must not.
    assert [r[1:] for r in before_claims] == [r[1:] for r in after_claims]
    assert env.sql(
        "SELECT file_sha256 FROM import_claim_conditions WHERE code='claim_backfill_unavailable'"
    ) == [(bad.sha256,)]


@pytest.mark.parametrize("damage", ["invalid_mapping", "invalid_payload"])
def test_0005_unreadable_data_never_blocks_startup(env: Env, damage):
    imported(env)
    migrate(env, "downgrade", "0004")
    with env.engine.begin() as c:
        if damage == "invalid_mapping":
            c.execute(text("UPDATE mappings SET document='{}' WHERE id='map_tracelab'"))
        else:
            c.execute(text("UPDATE raw_records SET payload='broken json'"))
    run_migrations(env.engine)
    assert env.sql("SELECT COUNT(*) FROM entity_claims") == [(0,)]
    assert env.sql("SELECT code FROM import_claim_conditions") == [("claim_backfill_unavailable",)]
    assert env.sql("SELECT duplicate_detection_version FROM imports") == [(None,)]


def test_0005_late_replay_mismatch_rolls_back_only_the_file(env: Env):
    imported(env, ["s"] * 150)
    migrate(env, "downgrade", "0004")
    with env.engine.begin() as c:
        c.execute(text("UPDATE model_calls SET input_tokens=987 WHERE locator='line:99'"))
    before = snapshots(env)
    run_migrations(env.engine)
    assert snapshots(env) == before
    for table in ("entity_claims", "claim_file_projections", "claim_projections", "claim_scopes"):
        assert env.sql(f"SELECT COUNT(*) FROM {table}") == [(0,)]
    assert env.sql("SELECT code FROM import_claim_conditions") == [("claim_backfill_unavailable",)]


@pytest.mark.parametrize("reverse", [False, True])
def test_equal_peer_witness_uses_numeric_locator_not_insertion_order(env: Env, reverse):
    candidates = [candidate("a", "P", 10), candidate("a", "P", 2), candidate("b", "P", 1)]
    _, rows = stage_synthetic(env, list(reversed(candidates)) if reverse else candidates)
    assert next(r for r in rows if r["file_sha256"] == "b")["peer_locator"] == "line:2"


def test_exact_chunk_multiple_has_no_extra_detection_query(env: Env, monkeypatch):
    monkeypatch.setattr(claims_module, "PAGE_SIZE", 2)
    captured = []
    event.listen(
        env.engine,
        "before_cursor_execute",
        lambda c, cursor, sql, params, ctx, many: captured.append(sql),
    )
    stage_synthetic(env, [candidate("a", "P", 1), candidate("b", "Q", 1)])
    # Warmup import has two claims (one page); synthetic pass has four claims (two pages).
    assert sum(sql.startswith("\nWITH candidates") for sql in captured) == 3
