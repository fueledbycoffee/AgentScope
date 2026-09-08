# Clean-clone rehearsal — 2026-09-08

Status: **blocked by the verification runner's local-listener policy after
successful clean setup**. This is not a completed browser rehearsal and must
not be used as evidence for the README's displayed or API totals.

## Reader snapshot and isolation

The final rehearsal used a fresh local, non-hardlinked clone of branch
`docs/18-documentation` at
`048315693316dc01729abd2543b60d227123094f`. The source and clone hashes matched.
Before setup, the clone had no `.env`, `backend/.env`, `backend/data/`,
`backend/.venv/`, `web/node_modules/`, `web/dist/` or `.pnpm-store/`.

The runner cannot reach package registries and cannot write to its default uv
cache. A temporary offline copy of the existing uv cache and a temporary,
writable copy-on-write pnpm package store were therefore selected outside the
clone. No virtual environment, `node_modules`, build output, application data
or configuration was copied into the clone. Those artifacts were created by
the documented locked-install commands. This runner-only cache selection is a
departure from following the README with no environmental assistance and is
recorded here rather than hidden.

## Transcript summary

| Step | Outcome |
| --- | --- |
| `uv --directory backend sync --locked --all-groups` | Passed offline from the temporary cache; uv created the clone's virtual environment and installed 53 packages from the lock. |
| `pnpm --dir web install --frozen-lockfile` | Passed offline from the temporary store; pnpm created `node_modules` and reused 246 locked packages. |
| `pnpm --dir web build` | Passed; Vite transformed 747 modules and produced `web/dist`. |
| Copy `.env.example`, select `AGENTSCOPE_LLM_PROVIDER=fake`, leave `AGENTSCOPE_LLM_API_KEY=` empty | Passed; no credential was used or recorded. |
| `uv --directory backend run python ../scripts/llm_smoke.py` | Passed in one attempt; receipt model `fake/deterministic-1`, executable document, `session`, `model_call` and `tool_call` rules, no issues. |
| README server on `127.0.0.1:8000` | Application startup completed, including SQLite creation, but uvicorn then failed to bind with `Errno 1: operation not permitted`. |
| README health and summary requests | Both failed to connect with curl exit 7 because no listener could bind. No summary payload or totals were observed. |
| README browser walkthrough and fake-assistant save | Not run: the documented server was unreachable, and this Codex runner did not expose the in-app browser automation runtime required by the browser skill. |
| Backend required checks | Passed: Ruff check and format, mypy over 60 files, all four import-linter contracts, 445 pytest tests (one dependency deprecation warning), and 18 script unit tests. |
| Web required checks | Passed: typecheck, lint with three existing warnings, 7 Vitest files / 145 tests, and production build. |

The separately documented Playwright command was also attempted in the first
fresh rehearsal clone. Chromium installation did not complete in this runner
and was interrupted after making no progress. `pnpm e2e` rebuilt the SPA and
started its isolated backend, but that backend hit the same listener policy on
`127.0.0.1:8765` before Playwright tests could begin. The backend reload command
and Vite development command were exercised too; their listeners were denied
on ports 8000 and 5173 respectively. These failures are environmental and are
not counted as passing product evidence.

## Required completion outside this runner

On a machine that permits loopback listeners and has the browser runtime,
repeat the README from a fresh clone with no repository-local caches or data.
Use its server on port 8000 for the import and assistant walkthrough, then read
the response from that same server's `/api/metrics/summary`. The expected values
in the README—80 sessions, 4,770 recorded model-call observations, 5,723
recorded tool-call observations, and 553,447,877 input tokens with 4,770 / 4,770
coverage—remain **unverified by this rehearsal** until that response and the UI
flow are observed.

No secret, raw trace content, absolute home path, database, package cache or
build artifact is included in this record.
