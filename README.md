# AgentScope

Import, normalise and explore traces of AI coding agents (Claude Code, Codex and others).

AgentScope takes trace files (JSONL, Parquet), normalises them into a common relational model of sessions, model calls and tool calls, keeps the original records and their provenance, and lets you explore the result in a dashboard. An LLM-assisted import helper proposes a mapping for files it has never seen; the mapping is validated and applied by a deterministic engine, never by the model itself.

> Not related to the `agentscope` Python package (Alibaba's agent framework).

## Status

Pre-release. The plan for v0.1.0 lives in [`docs/planning/`](docs/planning/2026-09-07-consolidated-plan.md). Work is tracked on the GitHub Project linked to this repository.

## Development

Requirements: [uv](https://docs.astral.sh/uv/) (provisions Python 3.12), Node 24 and [pnpm](https://pnpm.io/).

```bash
# Backend (FastAPI)
cd backend
uv sync --locked --all-groups
cp ../.env.example .env          # then fill in your LLM endpoint and key
uv run uvicorn agentscope_app.interfaces.api.main:app --reload
# On first start the backend creates ./data/agentscope.sqlite3, runs the migrations and
# loads the bundled mappings from backend/mappings/. Try it: open http://127.0.0.1:8000/docs
# and upload fixtures/tracelab/tracelab-sample.jsonl.gz.
uv run pytest                    # tests
uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run lint-imports

# Web (React + Vite), in a second terminal
cd web
pnpm install --frozen-lockfile
pnpm dev                         # proxies /api to the backend on :8000
pnpm test && pnpm typecheck && pnpm lint && pnpm build
```

CI runs all of the above on every pull request; `ci-required` is the single status check that must pass before merging to `main`.

Layout: `backend/src/agentscope_app/{domain,application,infrastructure,interfaces}` follows Clean Architecture with the dependency direction enforced by import-linter (see `backend/pyproject.toml`). `web/` is the single-page front end.

Documentation index: [`docs/README.md`](docs/README.md). The import pipeline's components and tables are described in [`docs/architecture/import-pipeline.md`](docs/architecture/import-pipeline.md); the HTTP contract in [`docs/api/v0.1.md`](docs/api/v0.1.md).

## Licence

MIT. See [LICENSE](LICENSE).
