"""Synthetic collisions and old-database upgrades; no uploaded datasets required."""

from __future__ import annotations

import json
import random
from collections import Counter

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
    assert len(detection) == 8
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
