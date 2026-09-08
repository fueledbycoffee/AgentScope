# Cross-file claim diagnostics verification — 2026-09-08

Branch: `feat/33-cross-file-duplicates`. Python 3.12.13, SQLite 3.53.4,
local macOS worktree. Synthetic data only; generated databases/uploads stayed in
temporary directories and are not committed.

## Backend gates

All passed on the final implementation:

```sh
export UV_CACHE_DIR=/tmp/agentscope-33-uv
uv --directory backend run ruff format
uv --directory backend run ruff check src tests
uv --directory backend run mypy src
uv --directory backend run lint-imports
uv --directory backend run pytest -q
```

The temporary uv cache accommodates this run's filesystem sandbox. Ruff left all
104 Python files formatted; mypy checked 62 source files; all four import contracts
passed. Pytest: **492 tests, zero failures, errors or skips**, 60.99 seconds. The
existing Starlette/AnyIO deprecation warning remains. Saved-mapping replay tests and
their expected JSON documents passed unchanged. No web/src changes or web tests;
dedicated report/history controls are the owner-requested UI follow-up.

## Review closure and behavioral evidence

- P1 #1: 150 healthy emissions with optional session `agent` unmapped produce one
  `claim_scope_unavailable` condition row, affected count 150, zero emission
  diagnostic rows and no condition code in record/file/attempt warnings. The
  child-only mapping variant also creates its implicit session normally.
- P1 #2: populated 0004 upgrades with missing raw records, contribution rows or
  record results all reach 0005, preserve observations, leave version null and
  expose a backfill condition. Invalid mapping/payload and persisted-call mismatch
  cases pass too. A mismatch after the first 128-record page rolls back all claims
  of that file. A healthy Parquet file survives alongside a broken JSONL file.
- P1 #3: real SQLite foreign-key failures during entity storage or claim staging
  result in failed reports with `IntegrityError: FOREIGN KEY…`, never a 409 byte
  race. Existing occurrence-uniqueness and race-loser tests still pass.
- Equal repeated re-exports `{P1,P2,P1}` count only equal matches. An equal peer
  suppresses suspected warnings even with differing peers. The SQL detector matches
  a seeded brute-force oracle across 400 generated claims, scopes and files.
- Reversed file order and chunk sizes 1/2/128 preserve both-sided batch counts;
  witnesses prefer numeric `line:2` over `line:10` regardless of insert order.
  Exact chunk multiples incur no empty detection SELECT.
- Changed timestamps/model fields flag model claims; unchanged nested tools remain
  equal. Partial records retain their accepted child diagnostics. Session declarations
  compare individually; record/file/attempt warning sums reconcile, inserted counts
  and token totals remain observation totals. Failed later writes preserve old peers.
- API POST/GET/history round-trip versions, file warnings and conditions; filters,
  numeric ordering, totals, pagination, invalid input, empty results, legacy null
  version and both sides' raw evidence are exercised through FastAPI.

## 100,000-emission storage and lookup budget

Each workload has 50,000 source records, five derived sessions and 100,000 accepted
emissions (session declaration + model call per record):

- `repeated`: five scoped native call keys, each repeatedly emitting equal values.
- `distinct`: 50,000 scoped native call keys; repeated session declarations.
- `peers`: two files of 25,000 records with equal repeated projections except one
  changed call. Exactly **99,999 equal-match diagnostics and one suspected diagnostic**.

SQLite `dbstat` sums tables plus their indexes. Comparison bytes include all six
new tables/indexes and the added contribution lookup index. Entity bytes include
sessions, model_calls, tool_calls and entity_contributions with their preexisting
indexes; raw payloads, uploads and report/result tables are excluded from the
comparison denominator. **Budget: comparison storage below 6x entity storage.**

| Workload | Comparison bytes | Entity bytes | Ratio | Full import | 0004→0005 backfill | Detection SELECTs | Max binds per execution |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| repeated | 68,263,936 | 47,312,896 | 1.44x | 12.88 s | 12.04 s | 782 | 17 |
| distinct | 141,975,552 | 47,206,400 | 3.01x | 14.83 s | 12.03 s | 782 | 70 |
| peers | 90,669,056 | 47,333,376 | 1.92x | 14.68 s | 11.13 s | 782 | 17 |

All budgets passed. Backfill recovered exactly 100,000 claims per workload without
any backfill-unavailable conditions. Times are local samples, not service-level
promises; schema/data shape and host load affect them. The oversize-projection
regression proves the separate 64 KiB cap skips comparison without indexing a
truncated projection.

Each 128-row detection page has one MATERIALIZED candidate SELECT. A separate
indexed max-ID read bounds the pass. Scope interning and claim writes are additional
bounded executemany/read operations, not included in the 782 detection queries.
Across the whole import, SQLAlchemy observed 106,572 executions for repeated/distinct
and 107,361 for peers; the existing alternating session/call contribution inserts
account for most of that total. This is not a claim of 782 total database operations.
Measured statement execution time for detection alone was 0.17–0.26 seconds,
excluding Python processing and row fetching; full import time above includes both.

All three populated EXPLAIN plans use:

```text
MATERIALIZE candidates
SEARCH c USING INDEX ix_entity_claim_import (import_id=? AND id>?)
CORRELATED SCALAR SUBQUERY 1
SEARCH f USING INDEX sqlite_autoindex_claim_file_projections_1
  (scope_id=? AND projection_sha256=?)
CORRELATED SCALAR SUBQUERY 2
SEARCH f USING INDEX ix_claim_file_scope (scope_id=? AND file_sha256<?)
CORRELATED SCALAR SUBQUERY 3
SEARCH f USING INDEX ix_claim_file_scope (scope_id=? AND file_sha256>?)
SCAN c
SEARCH p USING INTEGER PRIMARY KEY (rowid=?) LEFT-JOIN
```

`SCAN c` is over the materialized page of at most 128 candidates, not the full
claim history. No peer table scan or projection-text range index is used. An equal
probe can skip one own-file row; strict file ranges skip none, regardless of how
many distinct projections that incoming file holds.

## Reproduction

The standard suite includes the oracle, bounded-query and migration regressions:

```sh
uv --directory backend run pytest -q tests/infrastructure/test_cross_file_claims.py
uv --directory backend run pytest -q tests/interfaces/test_api_cross_file_diagnostics.py
```

For the larger workload, run the following Python from `backend` with
`PYTHONPATH=src:. uv run python /tmp/claim-benchmark.py`, after saving the code
below there. It uses the real import stack and generated records, creates only
fresh temporary databases, checks the numeric budget, and exercises downgrade /
backfill without touching an existing user database.

```python
import json
import tempfile
import time
from pathlib import Path

from alembic import command
from sqlalchemy import event, text

from agentscope_app.application.dto import FileBinding
from agentscope_app.infrastructure.db.claims import TABLE_NAMES
from agentscope_app.infrastructure.db.engine import alembic_config, run_migrations
from tests.infrastructure.test_database import _tracelab_line
from tests.infrastructure.test_multifile_import import env as environment

for mode in ("repeated", "distinct", "peers"):
    e = environment.__wrapped__(Path(tempfile.mkdtemp(prefix="claim-benchmark-")))
    base = json.loads(_tracelab_line("bench"))
    rows = [{**base, "session_id": f"bench-{n % 5}",
             "trace_key": f"key-{n if mode == 'distinct' else n % 5}"}
            for n in range(50_000)]
    groups = [rows]
    if mode == "peers":
        groups = [rows[:25_000], rows[25_000:]]
        for row in groups[1]:
            row["salt"] = "re-export"
        groups[1][0]["input_tokens_total"] = 20
    uploads = [e.upload.execute(f"{n}.jsonl", b"".join(
        json.dumps(row, separators=(",", ":")).encode() + b"\n" for row in group
    )) for n, group in enumerate(groups)]
    selects = []
    def capture(conn, cursor, sql, params, context, many):
        if sql.startswith("\nWITH candidates"):
            selects.append(sql)
    event.listen(e.engine, "before_cursor_execute", capture)
    start = time.perf_counter()
    report = e.commit.execute("bench", [FileBinding(u.upload_id, "map_tracelab")
                                        for u in uploads])
    elapsed = time.perf_counter() - start
    assert report.status == "committed", report.error
    assert len(selects) == 782
    if mode == "peers":
        assert report.warnings["suspected_duplicate"] == 1
        assert report.warnings["matching_claim_equal_projection"] == 99_999
    with e.engine.connect() as c:
        sizes = c.execute(text("SELECT name,sum(pgsize) FROM dbstat GROUP BY name")).all()
        owners = dict(c.execute(text("SELECT name,tbl_name FROM sqlite_master")).all())
        new = sum(size for name, size in sizes if owners.get(name) in TABLE_NAMES
                  or name == "ix_contributions_import_file")
        old = sum(size for name, size in sizes if owners.get(name) in
                  ("sessions", "model_calls", "tool_calls", "entity_contributions")
                  and name != "ix_contributions_import_file")
    assert new < 6 * old
    config = alembic_config(e.engine)
    with e.engine.begin() as c:
        config.attributes["connection"] = c
        command.downgrade(config, "0004")
    start = time.perf_counter()
    run_migrations(e.engine)
    backfill = time.perf_counter() - start
    with e.engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM entity_claims")).scalar_one() == 100_000
        assert c.execute(text("SELECT count(*) FROM import_claim_conditions")).scalar_one() == 0
    print(mode, new, old, new / old, elapsed, backfill, len(selects))
    e.engine.dispose()
```
