# Import pipeline (issues #5 and #6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From an uploaded TraceLab JSONL file to persisted sessions, model calls and tool calls with provenance, through the domain mapping engine, with exact-file idempotency and an import report; exposed over the v0.1 HTTP contract.

**Architecture:** Application layer owns the ports and use cases (`StoreUpload`, `PreviewImport`, `CommitImport`, read-side queries) and is tested with in-memory fakes. Infrastructure implements the ports: filesystem raw store, JSONL/gzip reader, SQLAlchemy 2 repositories over SQLite with Alembic migrations, a unit of work. Interfaces expose FastAPI routers and the composition root. Dependency direction unchanged and enforced by import-linter.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2, Alembic, SQLite (foreign keys on every connection), pydantic (API DTOs and settings only), pytest, Hypothesis.

**Spec:** `docs/planning/2026-09-07-consolidated-plan.md` sections 2 and 3; `docs/api/v0.1.md`; ADR-002 (identities, idempotency), ADR-003 (nulls).

## Global constraints

- Domain stays stdlib-only; application imports only domain (+ stdlib); infrastructure implements ports; interfaces wire.
- Limits: 25 MiB per upload, 100,000 records per file, preview sample ≤ 1,000 records.
- Missing is never zero: every metric carries coverage.
- Exact-file idempotency: same bytes + same source → nothing inserted, every record `duplicate`. Record-level uniqueness on occurrence key enforced by the database.
- Checks before every commit: pytest, ruff (check + format), mypy, lint-imports.

## File structure

| File | Responsibility |
|---|---|
| `application/errors.py` | `NotFoundError`, `InvalidInputError(details)`, `LimitExceededError` |
| `application/dto.py` | frozen dataclasses mirroring the API contract: `StoredFile`, `RawRecord`, `UploadInfo`, `MappingRecord`, `PreviewReport`, `ImportReport`, `RejectRow`, `SessionSummary`, `SessionDetail`, `MetricsSummary`, `Metric` |
| `application/ports.py` | Protocols: `RawFileStore`, `RecordReader`, `UploadRepository`, `MappingRepository`, `ImportRepository`, `TraceRepository`, `UnitOfWork`, `Clock`, `IdGenerator` |
| `application/use_cases/uploads.py` | `StoreUpload` |
| `application/use_cases/imports.py` | `PreviewImport`, `CommitImport`, `ListImports`, `GetImport`, `ListRejects` |
| `application/use_cases/queries.py` | `ListMappings`, `GetMapping`, `ListSessions`, `GetSession`, `GetRawRecord`, `MetricsSummary` |
| `infrastructure/settings.py` | pydantic-settings from `AGENTSCOPE_*` |
| `infrastructure/files/raw_store.py` | filesystem `RawFileStore` keyed by sha256 |
| `infrastructure/readers/jsonl.py` | JSONL and `.jsonl.gz` `RecordReader` with `line:N` locators, size/record limits |
| `infrastructure/db/models.py` | SQLAlchemy models for the 12 tables of the plan |
| `infrastructure/db/engine.py` | engine factory, `PRAGMA foreign_keys=ON` on connect |
| `infrastructure/db/repositories.py` | port implementations |
| `infrastructure/db/unit_of_work.py` | `SqlAlchemyUnitOfWork` |
| `infrastructure/db/alembic/` | migration env + initial revision |
| `infrastructure/mappings/bundled.py` | loads `backend/mappings/*.json` into the mapping repository at startup (idempotent by content hash) |
| `interfaces/api/{deps,schemas,routers/*}.py` | FastAPI DTOs and routers; composition root in `main.py` |
| `tests/application/…` | use cases with in-memory fakes |
| `tests/infrastructure/…` | readers, raw store, repositories against a migrated temp SQLite |
| `tests/interfaces/test_api_e2e.py` | upload → preview → import → report → sessions → re-import through TestClient on the real fixture |

## Tasks (each: failing test → implementation → checks → commit)

1. **Application contracts**: `errors.py`, `dto.py`, `ports.py`. Test: DTOs are frozen and JSON-serialisable via `dataclasses.asdict`.
2. **StoreUpload** with fakes: stores bytes, sniffs format, counts records, previews 20, reports `already_imported`, enforces 25 MiB and 100k records.
3. **PreviewImport**: runs `apply_mapping` over the first N records, classifies records, aggregates warnings, returns samples; refuses non-executable mappings with the issues as details.
4. **CommitImport**: duplicate detection by (sha256, source); full run; `reduce_sessions`; persistence through the unit of work; report with record and entity counts; rejects stored; failure leaves nothing (fake UoW records commit/rollback).
5. **Read-side use cases**: mappings, imports, rejects, sessions, session detail, raw record, metrics summary (coverage, by token_semantics).
6. **JSONL reader + raw store** (infrastructure) with tests on the real fixture (gzip) and on malformed lines (a malformed line is a record with `payload=None` and a decode error that CommitImport turns into a reject `invalid_json`).
7. **Database**: models, engine, Alembic initial migration, migration-from-empty test, foreign keys enforced test, unique occurrence key test.
8. **Repositories + unit of work** against a temp SQLite, including `TraceRepository.store` idempotency and the metrics query.
9. **Bundled mappings** loader (content-hash idempotent), `Settings`, composition root.
10. **API routers** per `docs/api/v0.1.md` + end-to-end test on the fixture; error mapping (400/404/413/409).
11. **Docs**: `docs/architecture/import-pipeline.md` (component diagram, sequence), README run instructions; PR.
