# AgentScope — Claude's plan (independent draft)

## 1. Reading of the brief

Hard requirements:
- Import JSONL + (CSV or Parquet). Preview, import history, per-import report (imported / duplicates / rejects / missing), rejects browsable with reasons.
- Common relational model: sessions, model calls, tool calls, explicit keys/relations, ~3NF with justified exceptions, raw data + provenance kept, explicit null/unit/id handling, idempotent re-import.
- LLM import assistant: sample + field profile in, proposed mapping + explanations + ambiguities out. User chats, corrects, previews, validates. LLM never writes to DB. Mapping saved, editable, reusable. App explains what it cannot interpret.
- Dashboard: >= 4 KPIs, >= 3 charts, session detail; filters source/agent/model/period; each metric has an accessible definition (formula, unit, scope, null handling); missing != 0; non-comparable metrics separated/flagged; drill-down chart -> sessions; data quality visible.
- Clean Architecture: domain / use cases / interfaces / infra; core independent of web framework, DB, LLM vendor; rules testable without UI or real LLM.
- LLM provider switchable by config; >= 2 configs tested and documented; test fake.
- CI on every PR; no keys in repo or browser bundle; stats computed by code; trace text is data not instructions; sensitive data filtered before LLM.
- Deliverables: README, LICENSE, CONTRIBUTING, release notes, architecture doc + component diagram, ERD, ADRs, metric definitions, mappings for 2 sources, models tested + switching procedure, 3 numeric observations with filters, verification report of both LLM configs, dataset provenance/versions/dates.
- Tests: re-import no dupes; relations preserved; a metric correct after join + filter; invalid mapping rejected with explanation.

Most likely under-delivered without early planning:
1. **The mapping DSL + generic engine.** The temptation is to hand-code a TraceLab parser and bolt the DSL on later. If TraceLab is not itself imported through the DSL, the DSL will be too weak for the unknown file on day 4.
2. **Metric semantics.** Null handling, per-source comparability, and definitions must be a first-class module with tests, not chart-side code.
3. **The paper trail.** ADRs, metric definitions, mapping docs, verification report, release notes. Cheap if written as you go, expensive on day 4.

## 2. Stack propositions

### A. Python backend + React/TypeScript front (recommended)
- **Components:** Python 3.12, FastAPI, SQLAlchemy 2 + Alembic, SQLite by default (Postgres-capable via URL), pyarrow (Parquet/CSV), pydantic for contracts, pytest + hypothesis, import-linter for layer rules, uv. Front: Vite + React + TypeScript, TanStack Query, ECharts or Recharts, openapi-typescript for generated client types.
- **Advantages:** best-in-class data tooling (pyarrow, profiling), every LLM vendor has a first-class Python SDK including local ones (Ollama, LM Studio via OpenAI-compatible API), pydantic makes the mapping contract validation trivial, pytest ecosystem. React gives real drill-down dashboards and a chat UI. SQLite means a clone runs with zero services.
- **Disadvantages:** two languages, two toolchains, two CI jobs, API contract to keep in sync (mitigated by OpenAPI codegen). More scaffolding on day 1.
- **Clean Architecture fit:** natural. `domain` and `application` packages have no framework imports; import-linter enforces it in CI.
- **Timebox fit:** good. AI agents are strong on both halves; the split also parallelises well (backend agent / frontend agent).
- **LLM abstraction:** `MappingAdvisor` port (Protocol) in application layer; adapters: Anthropic SDK, OpenAI-compatible (covers OpenAI, Ollama, Mistral, Groq, LM Studio), Fake. Config via pydantic-settings env vars `AGENTSCOPE_LLM_PROVIDER / MODEL / BASE_URL / API_KEY`.

### B. Full TypeScript monorepo
- **Components:** pnpm workspaces: `packages/core` (domain + use cases, zero runtime deps), `packages/infra` (Drizzle or Kysely over better-sqlite3, file readers, LLM adapters), `apps/api` (Hono or Fastify), `apps/web` (Vite React). zod for the mapping contract shared by API and UI. vitest.
- **Advantages:** one language; the mapping contract and DTO types are literally shared between server and browser; package boundaries physically enforce dependency direction (core's package.json has no deps); fast iteration.
- **Disadvantages:** Parquet in Node is workable (hyparquet, parquet-wasm, or duckdb-node) but less mature than pyarrow; field profiling and CSV inference must be hand-rolled; LLM SDKs fine but local-model story slightly weaker; two package managers of concern avoided but monorepo tooling itself costs setup time.
- **Clean Architecture fit:** strongest physical enforcement of all options.
- **Timebox fit:** good, similar to A, slightly more time on data plumbing.
- **LLM abstraction:** own `MappingAdvisor` interface in core; adapters wrap vendor SDKs (or Vercel AI SDK as an implementation detail, never as the port).

### C. Python-only, server-rendered (FastAPI + Jinja + HTMX + Chart.js)
- **Components:** single Python app, templates, HTMX for interactivity, Chart.js/Plotly for charts.
- **Advantages:** fastest to first pixel, one toolchain, no API contract, still Clean-Architecture-friendly (templates are just another interface adapter).
- **Disadvantages:** chart drill-down, an editable mapping tree, and a chat panel get awkward in HTMX; less "product" feel; harder to grow later. Streamlit/Reflex variants are worse: they fight the layering.
- **Timebox fit:** best for day 1, worst for day 3 (mapping editor + chat).
- **LLM abstraction:** same as A.

### D. Variant: DuckDB as the store (applies to A or C)
- DuckDB reads JSONL/CSV/Parquet natively and aggregates fast. Tempting, but it is an analytical engine: the normalised store needs upserts, unique constraints, and migrations, which SQLite + Alembic do better. Use DuckDB/pyarrow only as *file readers* if useful. Not recommended as the primary store.

**Recommendation: A.** The core of this product is data wrangling + LLM structured output + testable rules; Python is strongest there. The front needs interactive drill-down and a chat/mapping editor; React is strongest there. SQLite keeps "clone and run" trivial.

Naming note: `agentscope` is already a well-known Python package (Alibaba's agent framework) on PyPI. Repo name `agentscope` on GitHub is fine; the Python package should be `agentscope_app` or similar to avoid confusion.

## 3. Architecture

```
backend/src/agentscope_app/
  domain/          entities (Session, ModelCall, ToolCall, ImportRun, RawRecord, Reject),
                   mapping contract (MappingSpec, Transform whitelist), mapping engine
                   (apply_mapping -> NormalizedRecords | Reject), metric definitions
                   (pure functions over rows), validation rules. No framework imports.
  application/     use cases: ImportFiles, AnalyseFile, ProposeMapping, ReviseMapping,
                   PreviewMapping, SaveMapping, GetImportReport, QueryDashboard,
                   GetSessionDetail. Ports (Protocols): SessionRepo, ImportRepo,
                   RawRecordStore, MappingRepo, FileReader, FieldProfiler, MappingAdvisor
                   (LLM), Redactor, Clock, UnitOfWork.
  infrastructure/  sqlalchemy repos + alembic, readers (jsonl/csv/parquet), llm adapters
                   (anthropic, openai_compatible, fake), settings, redaction.
  interfaces/      FastAPI routers + DTOs, CLI (typer) for headless import.
web/               React SPA; talks only to the API.
```
Dependency direction: interfaces -> application -> domain; infrastructure -> application (implements ports) -> domain. Composition root in `interfaces/api/main.py` wires adapters from config. import-linter contracts fail CI on violations.

**Engine sits in domain.** The LLM returns JSON; `MappingSpec.model_validate` parses it; the validator checks every transform is in the whitelist, every required target field is mapped or explicitly declared `unmapped` with a note, and types line up. No `eval`, no `exec`, no expression language. Preview = run the engine on the sample in memory. Import = same engine over the whole file inside a unit of work.

## 4. Data model

| Table | One row is | Key | Notes |
|---|---|---|---|
| `sources` | a dataset family (tracelab, swe-chat, ...) | id | name, description, comparability notes |
| `mappings` | one version of a saved mapping | id | source_id, name, version, spec JSON, parent_id, proposed_by (provider+model or "human"), created_at |
| `import_runs` | one user-triggered import | id | source_id, mapping_id, status, started/finished_at, summary counts (derived, denormalised) |
| `import_files` | one file in a run | id | run_id, filename, sha256, size, format, line_count |
| `raw_records` | one original record as read | id | file_id, line_no, payload JSON, record_hash |
| `import_rejects` | one record that could not be normalised | id | file_id, line_no, reason_code, message, payload |
| `sessions` | one agent session | id | source_id, external_id (unique with source_id), agent, started_at, ended_at, repo, raw_record_id |
| `model_calls` | one LLM invocation | id | session_id, seq, provider, model, started_at, latency_ms, input/output/cache_read/cache_write tokens (nullable), error, raw_record_id |
| `tool_calls` | one tool invocation | id | session_id, model_call_id (nullable), seq, tool_name, started_at, duration_ms, status, error, raw_record_id |
| `analysis_runs` | one LLM analysis of a file | id | file profile, provider, model, proposal JSON, ambiguities, created_at (feeds the verification report) |

3NF deviations, justified: summary counts on `import_runs` (report history must survive raw-record purge); `payload` JSON in `raw_records` (provenance by design); SQL views `v_session_metrics`, `v_daily_activity` for dashboards.

**Idempotency:** file-level sha256 -> re-import of identical file yields a report with all rows as duplicates, nothing inserted. Record-level: natural key (`source_id`, `external_id`) for sessions; (`session_id`, `seq`) for calls; plus `record_hash`. Same key + same hash = duplicate (counted). Same key + different hash = conflict reject with explanation. Never silent overwrite.

**Nulls/units:** all measures nullable; mapping declares source unit and the engine converts to canonical (tokens int, durations ms, timestamps UTC). Metric layer reports coverage (`n_with_value / n_total`) next to every value.

## 5. Mapping DSL (saved contract)

```yaml
schema_version: 1
name: tracelab-jsonl
source: tracelab
format: jsonl
entities:
  session:
    from: "$"                       # iterate root records
    key: [external_id]
    fields:
      external_id: { path: "$.session_id" }
      agent:       { path: "$.agent", transforms: [lower] }
      started_at:  { path: "$.start_ts", transforms: [{ parse_datetime: { unit: s } }] }
  model_call:
    from: "$.turns[*]"
    parent: session
    fields:
      model:         { path: "$.model" }
      input_tokens:  { path: "$.usage.input", type: int, missing: null }
      latency_ms:    { path: "$.latency", transforms: [{ unit: { from: s, to: ms } }] }
  tool_call:
    from: "$.turns[*].tool_calls[*]"
    parent: model_call
    fields: { tool_name: { path: "$.name" } }
unmapped:
  - { path: "$.repo_meta", reason: "no target field; kept in raw payload" }
```
Transform whitelist: `lower`, `upper`, `trim`, `cast`, `parse_datetime`, `unit`, `coalesce`, `constant`, `concat`, `enum_map`, `json_path`. Path language: a restricted JSONPath subset (dot, index, `[*]`). Validation rejects unknown transforms, unmapped required fields, type mismatches, unknown units, with a human-readable explanation per error. `schema_version` + `proposed_by` keep old mappings loadable after a model change; the spec contains nothing vendor-specific.

## 6. Day-by-day

- **Day 1 (thin slice):** repo + project + CI + LICENSE + README stub + ADR-001 stack. 20-min spike: download a TraceLab JSONL extract, inspect its shape, record provenance. Domain entities, MappingSpec, engine v0 (root + one nested level), JSONL reader, SQLite repos, `ImportFiles` use case, bundled TraceLab mapping *written in the DSL*, CLI import, FastAPI upload endpoint, React upload page + 1 KPI (sessions, total tokens). Demo: upload file -> KPI shows.
- **Day 2 (socle):** import report + rejects viewer + import history; CSV + Parquet readers; duplicate/conflict handling with tests; metric module with definitions + null semantics + tests; 4 KPIs, 3 charts, session detail, filters, drill-down, data-quality panel. Demo: real TraceLab data, re-import shows 100% duplicates.
- **Day 3 (LLM):** FieldProfiler, Redactor, MappingAdvisor port + Anthropic + OpenAI-compatible + Fake adapters; analyse UI (profile, proposal with explanations/ambiguities, chat to revise, edit mapping, preview, validate, import). Import SWE-chat through a UI-created mapping. Run with two configs (e.g. Claude and a local Ollama model); write the verification report.
- **Day 4 (publish):** import a Trace Commons file cold via the UI; fix what breaks; architecture doc + diagram, ERD, ADRs, metric definitions, mapping docs, datasets doc, 3 observations; CONTRIBUTING; release notes; tag + `gh release create v0.1.0`.

## 7. GitHub setup

```
gh repo create fueledbycoffee/agentscope --public --license mit --gitignore Python --description "Explore AI coding-agent traces: import, normalise, dashboard, LLM-assisted mapping"
gh project create --owner fueledbycoffee --title "AgentScope v0.1.0"
# Status field: default Todo / In Progress / Done. Add "In review" via GraphQL updateProjectV2SingleSelectField (gh CLI cannot edit options of the built-in Status field) or once in the web UI.
gh label create area:domain ...  area:import  area:llm  area:dashboard  area:docs  area:infra  type:feat  type:bug  type:chore  day:1..4
gh api repos/fueledbycoffee/agentscope/milestones -f title=v0.1.0 -f due_on=2026-09-11T23:00:00Z
gh issue create --title ... --body ... --label ... --milestone v0.1.0 ; gh project item-add <n> --owner fueledbycoffee --url <issue-url>
# Branch protection (solo): require PR + CI status check; no required reviewer (cannot self-approve).
gh api -X PUT repos/.../branches/main/protection ...  (or a ruleset)
# CI: .github/workflows/ci.yml -> backend: uv sync, ruff, import-linter, pytest; web: pnpm install, tsc, vitest, build.
```
Initial issues (title -> verifiable result), grouped by day:
- D1: Repo/CI/docs skeleton -> CI green on an empty PR. ADR-001 stack -> file merged. Dataset spike -> `docs/datasets.md` with provenance + sample committed or fetch script. Domain entities + MappingSpec + engine v0 -> unit tests pass. JSONL reader + SQLite repos -> import CLI writes sessions. Bundled TraceLab mapping -> CLI import of extract produces N sessions. Upload endpoint + upload page + 1 KPI -> browser shows KPI after upload.
- D2: Import report + rejects viewer. Import history. CSV + Parquet readers. Duplicate/conflict tests. Metric module + definitions page. Charts x3 + KPIs x4. Session detail. Filters + drill-down. Data-quality panel.
- D3: FieldProfiler + Redactor. MappingAdvisor port + Fake. Anthropic adapter. OpenAI-compatible adapter. Analyse UI (profile/proposal/chat). Mapping editor + preview + validate. SWE-chat import via UI. Two-config verification report.
- D4: Trace Commons cold import + fixes. Architecture doc + diagram + ERD. Metric + mapping + dataset docs + 3 observations. README/CONTRIBUTING/release notes. v0.1.0 release.

## 7b. Dataset facts (verified 2026-09-07, changes the DSL)

- **TraceLab** (CC BY 4.0): `https://github.com/uw-syfi/TraceLab/releases/download/v0.0.1/syfi_coding_trace.jsonl.gz`, 357,161 rows, **one row = one LLM invocation**, fields `provider, session_id, round_id, turn, user, model, input_tokens_total, prefix_tokens, newly_append_tokens, claude_cache_creation_input_tokens (null for Codex), timing_events[], tools[] (tool_name, tool_call_id, emitted_at, input_chars, result_chars, tool_wall_latency_ms, tool_internal_latency_ms, is_error, result_at, command_status, command_exit_code, continuation_of_tool_call_id), source_store, trace_key`. Gzipped. No output_tokens field as such; token semantics are provider-specific (prefix vs newly appended).
  - Consequence 1: **sessions are derived entities**, aggregated from model-call rows by `session_id` (started_at = min timing event, ended_at = max, agent = provider). The DSL must support an entity whose rows are *grouped* from another entity, not only iterated.
  - Consequence 2: the reader must handle `.gz`. We need a sampling script (e.g. N whole sessions, stratified by provider) and a documented selection method.
- **SWE-chat** (ODC-BY, **gated**: must accept terms on HF): Parquet, several tables; `sessions` (one row per session: `session_id, repo_id, user_id, agent, created_at, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, turn_count, tool_call_count`) and `conversations` (one row per turn: `turn_id, role, turn_type, content, model, timestamp, input_tokens, output_tokens, cache_*`, `tool_name, tool_call_id`). Model calls and tool calls come from *filtering rows by `role`/`turn_type`* of one table. The DSL therefore also needs a **row filter** per entity. Parquet is the natural tabular format to support (satisfies "CSV or Parquet").
- **Trace Commons** (CC BY 4.0): 30 sessions, native formats per harness under `sessions/<harness>/*.jsonl|json` plus a decoded Parquet under `data/` with `harness, session_id, prompt, messages, tools, metadata, sent_at, num_user_messages, num_tool_calls, trace, file_path`. Good "unknown structure" test: nested `messages` arrays.

DSL additions implied: `from` may be a root iteration, a nested array, **or a group-by over another entity**; each entity gets an optional `where` filter (field equals / in / not null); aggregate functions for derived entities (`min`, `max`, `count`, `first`, `sum`).

## 8. Risks and decisions

- **DSL expressiveness vs nested trace formats** (biggest). Decide now: support root + nested array iteration with parent linkage from day 1; do the TraceLab spike *before* freezing the DSL.
- **LLM structured output variance across providers.** Decide now: JSON-only responses validated by pydantic; on failure, feed the validation errors back once, then surface to user. Use tool-use/JSON mode where the vendor has it, behind the adapter.
- **Metric comparability** (Claude cache tokens vs Codex, different duration semantics). Decide now: every metric carries `scope` (which sources it is valid for) and the UI flags mixed-source aggregates.
- **Sensitive data** in traces (paths, emails, keys). Decide now: Redactor runs before any LLM call; only profile + N sample rows sent; samples wrapped as data in the prompt.
- **Time.** Defer: Postgres, Docker, auth, HF direct connection.
- Open: exact TraceLab/SWE-chat shapes (spike day 1); which second model (local Ollama vs OpenAI).

## 9. Not in v0.1.0
Auth/multi-user, hosted deployment, HF/URL import, anomaly detection, data Q&A assistant, Postgres/Docker (maybe a Dockerfile if trivially cheap), i18n, per-connector code.
