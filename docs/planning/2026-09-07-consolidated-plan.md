# AgentScope — consolidated plan (2026-09-07)

Produced by two independent brainstorms (Claude Fable 5.1 and Codex gpt-6-astra) followed by an adversarial cross-review. The source plans and reviews are in this folder. Where the two disagreed, the position below is the one that survived verification against the actual datasets.

## 0. Prerequisites to unblock today (before or during day 1)

| Item | Status on this machine | Action |
|---|---|---|
| `gh` auth with `project` scope | OK | none |
| Anthropic API key | not in shell env | put in `backend/.env` (gitignored) |
| Second LLM config | no OpenAI key in env, no Ollama installed | choose: hosted OpenAI key, or `brew install ollama` + pull a small model; verify on day 1, not day 3 |
| SWE-chat access | gated on Hugging Face | log in to HF, accept the dataset terms, install `hf` CLI. Fallback second source: Trace Commons decoded Parquet |
| Python | system 3.9 | `uv python install 3.12` |
| Node / pnpm | 24 / present | none |

## 1. The five decisions

### D1. Stack: FastAPI + React/TypeScript + SQLite. JSONL and Parquet.
- Backend: Python 3.12, uv, FastAPI, SQLAlchemy 2 + Alembic, SQLite (foreign keys enabled on every connection), pyarrow, pydantic only at boundaries (API DTOs, mapping contract parsing), pytest, import-linter, ruff, mypy.
- Frontend: Vite + React + TS, TanStack Query, Recharts, types generated from OpenAPI (openapi-typescript).
- Built React assets served by the backend so a clone runs with one process.
- Cut from v0.1.0: CSV, CLI product surface, Postgres promise, Docker as a gate (Dockerfile only on day 4 if trivially cheap).
- Why not full TypeScript: Parquet and profiling tooling is weaker; why not Python-only UI: the mapping editor, chat and drill-down need a real SPA.
- Package name: `agentscope_app` (PyPI `agentscope` is Alibaba's framework; README states the project is unrelated).

### D2. LLM adapters: chat-completions-compatible adapter first, plus fake. (Decided by the owner on 2026-09-07.)
- Port `MappingAssistant` in the application layer: takes sanitised context (field profile, bounded filtered sample, current mapping, user message), returns an application-owned `MappingProposal` (mapping JSON + explanations + ambiguities + questions).
- Primary adapter: OpenAI-compatible chat completions, configured entirely from `.env`: `AGENTSCOPE_LLM_PROVIDER=openai_compatible`, `AGENTSCOPE_LLM_BASE_URL`, `AGENTSCOPE_LLM_MODEL`, `AGENTSCOPE_LLM_API_KEY`. Nothing hard-coded. Documented and tested targets: OpenRouter (primary), LM Studio and Ollama (local, no key). Advertise tested configurations only.
- Adapters own auth, endpoint, structured-output mechanism (JSON mode when the endpoint supports it, prompt-constrained JSON otherwise), refusal/truncation/timeout/malformed handling. One bounded repair attempt on validation failure, then diagnostics to the user.
- The two documented verification configs are two distinct models through this adapter (e.g. one via OpenRouter, one local via LM Studio or Ollama, or two OpenRouter models from different vendors).
- An Anthropic-native adapter is a stretch item: it is the worked example of "add a provider = add an adapter", not a release gate.
- CI runs against the fake only. Live two-model run is recorded release evidence.

### D3. Sessions are derived by a fixed domain reducer, not by the DSL.
- The DSL declares, per root record, which field is the session identity key (scoped by source namespace and harness). The application creates or reuses the session, emits the model-call observation and its tool-call observations, and recomputes `observed_start_at` / `observed_end_at` from accepted child timestamps.
- Span is "observed span in imported data", never "active time".
- No `group-by`, `sum`, `count`, `first` in the DSL. Dashboard aggregation lives in the metric layer.

### D4. Identity and idempotency (verified against TraceLab docs).
- TraceLab's `round_id` has about 8,900 duplicates and `trace_key` 514 in the merged trace; TraceLab itself uses an ingestion ordinal as surrogate. Native IDs are therefore **not** trusted as dedup keys.
- Three identities kept apart:
  1. **Source-occurrence identity**: `(raw_file sha256, record locator, emission path)`. Guarantees exact-file re-import adds nothing. This is the v0.1.0 dedup guarantee.
  2. **Claimed native identity** (`session_id`, `round_id`, `tool_call_id`, ...): stored, profiled, shown; used for session reconciliation only under a validated source contract.
  3. **Entity projection comparison**: when two records claim the same native identity, compare canonical fields, not parent-record hashes; equal is a duplicate, different is a flagged "suspected duplicate", never silent overwrite.
- Counts are labelled "recorded model-call observations". Overlapping-export reconciliation is deferred and documented.

### D5. Issues and CI sized for a solo dev with two coding agents.
- About 16 outcome-oriented issues (list in section 5), implementation subtasks as checkboxes. Split only where Claude and Codex work in parallel on separate worktrees.
- CI on every PR (`ci-required` is the single required check): ruff, mypy, import-linter, pytest (domain + mapping engine + SQLite migration-from-empty + API-level end-to-end with fake provider), tsc, vitest, build, and one Playwright smoke test (upload → preview → commit → dashboard → re-import) added on day 2 once the path exists.
- Branch protection: PR required, zero mandatory approvals, `ci-required` must pass, linear history, squash merge.
- Working agreement: human owns architecture, contracts, migrations, integration; agents get bounded issues and file ownership; the other agent reviews the diff, human merges; integrate midday and end of day.

## 2. Architecture

```
backend/src/agentscope_app/
  domain/          entities, identities, units, mapping AST + interpreter, validation
                   (syntactic / semantic / execution diagnostics), session reducer,
                   metric definitions and comparability rules. No framework imports.
  application/     use cases: UploadFile, ProfileFile, ProposeMapping, ReviseMapping,
                   ValidateMapping, PreviewImport, CommitImport, ListImports,
                   ListRejects, QueryDashboard, GetSession.
                   Ports: RawFileStore, RecordReader, ImportRepository,
                   TraceRepository, TraceQuery, MappingAssistant, UnitOfWork,
                   Clock, IdGenerator.
  infrastructure/  sqlalchemy repos + alembic, filesystem raw store, jsonl/jsonl.gz/
                   parquet readers, llm adapters (anthropic, openai_compatible, fake),
                   settings, redaction.
  interfaces/      FastAPI routers + DTOs, composition root, static serving of web build.
web/               React SPA.
```
Dependency direction inward; import-linter contracts fail CI on violation. Metric definitions in the domain; optimised SQL in the query adapter, cross-checked by reference tests on small fixtures.

Import flow: store bytes + hash → read records with locators → profile → choose saved mapping or ask assistant → validate → preview (no writes) → user confirms file hashes + mapping revision → apply engine to all records in one transaction → dashboard filtered on that import. Editing a mapping invalidates its preview.

"No free code execution": closed versioned AST, allowlisted transforms, no expression language, bounded iteration and array expansion, size limits (25 MiB per file, 100k records per batch), server-side revalidation regardless of provider structured output, trace text treated as untrusted data.

## 3. Data model (one row is ...)

| Table | One row is | Keys / notes |
|---|---|---|
| `sources` | a dataset namespace | unique `namespace`; defines where native IDs are scoped |
| `raw_files` | an immutable uploaded byte sequence | unique sha256, size, storage key |
| `imports` | one user import attempt (1..n files) | source FK, status, timestamps, summary snapshot (audit only) |
| `import_files` | one file in one attempt | import FK, raw_file FK, **mapping revision FK**, format, filename, dataset manifest fields |
| `raw_records` | one decoded record | raw_file FK, locator, payload JSON; unique `(raw_file_id, locator)` |
| `mappings` | one immutable mapping revision | logical key, revision, dsl_version, target_schema_version, contract JSON, hash, parent, approval state, proposal metadata (provider/model/prompt version) |
| `analysis_runs` | one assistant analysis | import_file FK, provider, model, sanitised context summary, proposal, diagnostics |
| `record_results` | one raw record's outcome in one import-file execution | PK `(import_file_id, raw_record_id)`; accepted / partial / duplicate / rejected / ignored; entity counts; missing-field summary |
| `rejects` | one explained failure | record_result FK, rule, path, code, human-readable message |
| `sessions` | one observed session | source FK, identity key, native id, agent/harness, `observed_start_at`, `observed_end_at` nullable; unique `(source_id, identity_key)` |
| `model_calls` | one recorded model-call observation | session FK, occurrence identity, native ids, provider label, model, timestamps, `input_tokens_total`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `reasoning_output_tokens`, accounting-semantics tag, error |
| `tool_calls` | one tool-call observation | session FK, nullable model_call FK (same session enforced), occurrence identity, tool name, `emitted_at`, `result_at`, `wall_latency_ms`, `internal_latency_ms` kept separate, is_error, exit code |
| `entity_contributions` | one raw record's contribution to one entity | raw_record FK, import_file FK, mapping FK, rule, emission path, exactly one typed entity FK |

3NF departures: JSON payloads and contracts (immutable documents); summary snapshots on `imports` (audit, never drive totals); `tool_calls.session_id` redundant when `model_call_id` set (supports orphan tools); cached observed session bounds (derivation documented). Dashboard uses SQL views, not materialised tables.

Units and nulls: UTC timestamps; integer ms; tokens non-negative int or null with semantics tag; absent key / explicit null / empty string / failed conversion distinguished in diagnostics and collapsed to null only when the contract says so. Missing is never zero.

## 4. Mapping DSL (contract)

Identity (logical id, revision, parent, hash) · compatibility (`dsl_version`, `target_schema_version`) · input (format, reader options, expected required fields) · rules (id, predicate, collection selector `$` or `$.tools[*]`, target entity, identity fields, parent reference) · field mappings (path or literal → target, ordered allowlisted transforms, type, unit from/to, null policy: required | nullable | default | warn | reject) · documentation (explanations, ambiguities, unsupported paths with reason).

Allowed: key/index access, bounded named-array iteration, root/current/parent scopes, existence/equality/membership predicates, trim, enum/bool map, strict int/decimal parse, timestamp parse, unit convert, ordered coalesce, constants, composite keys, bounded JSON-decode of a string field. Excluded: expressions, regex programs, recursion, joins, aggregation, generated code.

Validation stages: schema → semantic (targets, types, units, keys, references) → preview diagnostics → full-run diagnostics. Draft proposals may be incomplete; execution rejects any entity emission missing required identity or relationship fields, with an explanation.

Reference TraceLab rules: root → session contribution (key `session_id`, harness from `provider` via enum map); root → model_call (tokens as listed, timestamps from `timing_events`); `$.tools[*]` → tool_call with parent = enclosing model_call.

## 5. Day-by-day with gates

**Day 1 — establish + thin slice.** Gate: import a real TraceLab excerpt in the browser, preview, confirm, see the report and one indicator, inspect a session and its source record, restart the server and data persists, re-import the same file and totals do not change. No LLM involved.
- Issues: D1-01 repo/board/labels/milestone/CI/protection · D1-02 dataset access + excerpt manifests (TraceLab sample stratified by provider, full sessions, upstream hash recorded; SWE-chat access; reserve a Trace Commons native file unseen) · D1-03 ADRs: stack, identities, nulls/units, DSL v1 · D1-04 domain: entities, AST, interpreter v1, session reducer, tests · D1-05 infra: raw store, jsonl/gz reader, migrations, repos · D1-06 TraceLab mapping in DSL + CommitImport use case + exact-file idempotency test · D1-07 UI: upload → preview → confirm → report → 1 KPI → session detail.

**Day 2 — trustworthy ingestion and analytics.** Gate: JSONL and Parquet import; a partial import is explained; chart click reaches sessions then source records; overlapping files do not inflate counts.
- Issues: D2-01 Parquet reader + multi-file import + per-file mapping binding · D2-02 record/entity outcomes, rejects browser, history, transaction failure recovery · D2-03 metric layer: definitions, coverage, comparability, reference tests · D2-04 dashboard: 4 KPIs, 3 charts, filters, drill-down, quality strip, definitions page · D2-05 Playwright smoke in CI.

**Day 3 — assisted mapping and second source.** Gate: both LLM configs complete proposal → correction → preview → commit; saved mappings replay with provider disabled; two source mappings documented. Feature freeze at end of day.
- Issues: D3-01 profiler + redaction + `MappingAssistant` port + fake · D3-02 Anthropic adapter + compatible adapter · D3-03 analysis UI: proposal, explanations, ambiguities, chat, editable mapping table, validate, preview · D3-04 SWE-chat (or fallback) import through the UI + two-model verification report.

**Day 4 — verify, package, release.** Gate: clean-clone install works from the README; the reserved unseen file imports wholly or partially with explained limits and no code change; v0.1.0 references the tested commit.
- Issues: D4-01 unseen-structure rehearsal + failure paths + fixes · D4-02 docs: architecture diagram, ERD, ADRs, metric definitions, mapping docs, dataset manifests, model-switch procedure, CONTRIBUTING, release notes · D4-03 three numeric observations + release.

## 6. GitHub setup (step 1, executed on approval)

Adopted from Codex's commands with this owner:

```bash
AGS_OWNER=fueledbycoffee; AGS_REPO="$AGS_OWNER/AgentScope"
gh repo create "$AGS_REPO" --public --add-readme --license mit \
  --description "Import, normalise and explore AI coding-agent traces"
AGS_PROJECT_NUMBER="$(gh project create --owner "$AGS_OWNER" --title "AgentScope v0.1.0" --format json --jq .number)"
gh project edit "$AGS_PROJECT_NUMBER" --owner "$AGS_OWNER" --visibility PUBLIC
gh project link "$AGS_PROJECT_NUMBER" --owner "$AGS_OWNER" --repo "$AGS_REPO"
# Status options (Todo / In progress / In review / Done): gh cannot edit the built-in
# Status field's options; do it via GraphQL updateProjectV2SingleSelectField or once in the UI.
for L in day:1 day:2 day:3 day:4; do gh label create "$L" --repo "$AGS_REPO" --color 1D76DB --force; done
for L in area:core area:import area:ui area:llm area:delivery; do gh label create "$L" --repo "$AGS_REPO" --color 5319E7 --force; done
gh label create release-blocker --repo "$AGS_REPO" --color B60205 --force
gh api --method POST "repos/$AGS_REPO/milestones" -f title=v0.1.0 -f due_on=2026-09-11T23:00:00Z
gh repo edit "$AGS_REPO" --enable-squash-merge --enable-merge-commit=false --enable-rebase-merge=false --delete-branch-on-merge
# issues: gh issue create ... --assignee $AGS_OWNER --milestone v0.1.0 --label ... ; gh project item-add
# branch protection after first CI PR: required check "ci-required", 0 approvals, linear history
```

## 7. Risks (decide now vs defer)

| Risk | Decide now | Defer |
|---|---|---|
| DSL cannot express a source | bounded arrays, predicates, identity reconciliation; explain unsupported records | joins, general reconstruction |
| Native IDs collide (verified for TraceLab) | occurrence identity is the guarantee; native IDs profiled and flagged | fuzzy cross-export dedup |
| Cross-source metrics mislead | semantics tag + coverage on every metric; separate incompatible values | universal cost comparison |
| Second model fails late | verify config on day 1 | many-model benchmarking |
| SWE-chat access blocked | request today; Trace Commons Parquet fallback | HF integration |
| Sensitive data to provider | profile first; filtered sample shown before sending; keys backend-only | full anonymiser |
| Large files | 25 MiB / 100k records / bounded arrays, clear rejection | streaming, resumable jobs |
| Scope vs 4 days | cut list below is firm; freeze end of day 3 | everything else |

## 8. Not in v0.1.0
Auth, hosting, microservices/queues, HF/URL import, CSV, CLI, Postgres, autonomous mapping execution, universal native-format recognition, cross-dataset identity resolution, bulk reprocessing of committed imports, cost estimates, anomaly detection, NL questions, transcript search, node-based mapping designer, plugin framework.
