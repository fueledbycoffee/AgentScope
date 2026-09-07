# ADR-001: Application stack and release boundaries

## Status

Accepted — 2026-09-07.

## Context

AgentScope imports coding-agent traces, preserves their provenance and exposes
mapping review and metric drill-down in a local browser application. The first
release needs reliable data tooling and a usable mapping editor within a small
delivery window. Running a clone must not require a database service.

The [consolidated plan](../planning/2026-09-07-consolidated-plan.md) selects two
input formats and an inward dependency direction. The existing
[backend contracts](../../backend/pyproject.toml) already enforce the layers;
this record preserves that boundary as implementation grows.

## Decision

Use Python 3.12 with FastAPI for the backend, React with TypeScript for the
frontend, and SQLite for persistent relational data. Use `uv` for Python and
`pnpm` for the frontend, with committed lockfiles for reproducible installs.

The selected backend persistence stack is SQLAlchemy 2 plus Alembic migrations;
enable SQLite foreign keys on every connection. Use pyarrow for Parquet reading.
These are architectural selections; this ADR does not claim that all selected
dependencies are already installed in the initial scaffold.

Build the frontend with Vite, TanStack Query and Recharts. Generate API types
from OpenAPI using openapi-typescript. Serve the built React assets from the
backend so the installed application runs in one process; development may use
separate frontend and backend servers.

Support JSONL, including gzip-compressed JSONL, and Parquet. Readers decode
records and stable locators; the shared domain mapping engine performs
normalisation. A source-specific reader must not become a hidden mapping engine.

Keep the Python import package named `agentscope_app`; the distribution is
`agentscope-app`. PyPI's `agentscope` is Alibaba's unrelated framework. The
repository name does not justify importing or depending on that package.

Maintain four layers under `backend/src/agentscope_app/`:

- `domain`: entities, identities, units, mapping interpreter, session reducer
  and metric definitions; no framework dependencies.
- `application`: use cases and ports; depends inward on the domain.
- `infrastructure`: persistence, file readers, settings and provider adapters;
  implements application ports.
- `interfaces`: FastAPI DTOs, routers, static serving and the composition root.

The import-linter ordering is interfaces → infrastructure → application →
domain; inward imports may skip a layer. Its framework/client deny-lists also
protect the core. Use Pydantic at boundaries, including contract parsing, rather
than in domain entities. Keep those deny-lists current as dependencies are added.

Cut CSV, a CLI product surface, and a Postgres compatibility promise from
v0.1.0. Docker is not an installation or release gate; an optional Dockerfile
may follow only if cheap. Developer scripts do not constitute a CLI product.

## Consequences

Two languages and toolchains require CI and an explicit API boundary. Generated
types reduce drift, while import-linter guards dependencies independently of
directory naming. Domain rules remain testable without HTTP, SQLite or an LLM.

SQLite keeps setup small; it does not promise hosted multi-user scaling. The
format and deployment cuts keep effort on trustworthy import behavior. Adding
a database URL or a reader dependency alone does not expand supported products.

## Alternatives considered

- Full TypeScript: shared types are attractive, but Python's Parquet and profiling tooling better fits the import workload.
- Python-only UI: fewer tools initially, but mapping editing, chat and drill-down justify a React SPA.
- DuckDB as the primary store: useful analytical tooling, but SQLite better fits the selected relational persistence and migration workflow.
- Postgres or mandatory Docker: adds deployment work without serving the local v0.1.0 scope.
