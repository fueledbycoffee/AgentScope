# AgentScope

Import, normalise and explore traces of AI coding agents (Claude Code, Codex and others).

AgentScope takes trace files (JSONL, Parquet), normalises them into a common relational model of sessions, model calls and tool calls, keeps the original records and their provenance, and lets you explore the result in a dashboard. An LLM-assisted import helper proposes a mapping for files it has never seen; the mapping is validated and applied by a deterministic engine, never by the model itself.

> Not related to the `agentscope` Python package (Alibaba's agent framework).

## Status

Pre-release. The plan for v0.1.0 lives in [`docs/planning/`](docs/planning/2026-09-07-consolidated-plan.md). Work is tracked on the GitHub Project linked to this repository.

## Quickstart from a clean clone

Use uv 0.11.15, Node.js 24 and pnpm 10.28.1. From the repository root, install
only from the checked-in lockfiles, build the SPA, and create the backend's
gitignored configuration:

```sh
uv --directory backend sync --locked --all-groups
pnpm --dir web install --frozen-lockfile
pnpm --dir web build
cp .env.example backend/.env
```

In `backend/.env`, set `AGENTSCOPE_LLM_PROVIDER=fake` and leave
`AGENTSCOPE_LLM_API_KEY=` empty. This is the deterministic offline assistant
used by the browser tests: it requires no account, key, or network call.

The checked-in example intentionally names a real hosted model while leaving
its key empty. If you copy it without selecting `fake` or supplying a valid key
for your own endpoint, the application still starts but the first assistant
call can fail authentication. Set `AGENTSCOPE_LLM_PROVIDER=none` only when you
want the assistant disabled; saved mappings and imports remain available.

Start the documented server from `backend/`:

```sh
cd backend
uv run uvicorn agentscope_app.interfaces.api.main:app --host 127.0.0.1 --port 8000
```

The first start creates `backend/data/agentscope.sqlite3`, applies migrations,
loads `backend/mappings/`, creates `backend/data/raw-files/`, and serves the
built SPA. In another terminal, this checks application liveness:

```sh
curl -fsS http://127.0.0.1:8000/api/health
```

Open <http://127.0.0.1:8000/import> and reproduce the main path:

1. Upload `fixtures/tracelab/tracelab-sample.jsonl.gz`.
2. Choose `tracelab-v1 · revision 1 · tracelab`, then select **Preview**.
3. Confirm that 200 sampled records are accepted with no rejects, then select
   **Import**. The report must show 4,770 of 4,770 accepted and 0 rejected.
4. Open the overview. It must show 80 sessions, 4,770 recorded model-call
   observations, 5,723 recorded tool-call observations and 553,447,877 input
   tokens with coverage 4,770 / 4,770 calls.

Read those four totals from this server, not from a test harness:

```sh
curl -fsS http://127.0.0.1:8000/api/metrics/summary
```

To confirm the keyless assistant path, upload the fixture again, select
**Draft a mapping with the assistant**, enter `tracelab-offline-check` as the
mapping name and `tracelab-offline` as its source, include a redacted sample,
and send `Propose a mapping for this file`. Review the exact payload in the
drawer before selecting **Send this**. The receipt must name
`fake/deterministic-1`; validate the executable document and save revision 1.
This check saves a mapping but does not import the fixture under the second
source, so the totals above remain unchanged.

Stop the backend before resetting local state. Removing `backend/data/`
deletes the local database and content-addressed uploads; it is intentionally
gitignored and will be recreated on the next start.

## Development

For backend hot reload, run from `backend/` after the locked setup above:

```sh
uv run uvicorn agentscope_app.interfaces.api.main:app --reload
```

In a second terminal, run Vite from `web/`; it proxies `/api` to port 8000:

```sh
pnpm dev
```

The complete contributor checks, including the exact CI commands and Chromium
setup, are in [`CONTRIBUTING.md`](CONTRIBUTING.md). The e2e command rebuilds
`web/dist` and starts its own throwaway backend; it is regression evidence, not
evidence for the README server or its `backend/data/` state.

After the backend locked install, run the same browser setup and suite as CI
from `web/`:

```sh
pnpm exec playwright install --with-deps chromium-headless-shell
pnpm e2e
```

Layout: `backend/src/agentscope_app/{domain,application,infrastructure,interfaces}` follows Clean Architecture with the dependency direction enforced by import-linter (see `backend/pyproject.toml`). `web/` is the single-page front end.

Documentation index: [`docs/README.md`](docs/README.md). The import pipeline's components and tables are described in [`docs/architecture/import-pipeline.md`](docs/architecture/import-pipeline.md); the HTTP contract in [`docs/api/v0.1.md`](docs/api/v0.1.md).

## Licence

MIT. See [LICENSE](LICENSE).
