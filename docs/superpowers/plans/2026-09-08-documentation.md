# Plan: release documentation and clean-clone rehearsal (issue #18)

## Goal

Expected verifiable result (verbatim):

> A clean clone followed by the README reproduces the main path; `docs/` contains the component diagram, ERD, ADRs, metric definitions, the two source mappings, dataset manifests and the model-switch procedure; CONTRIBUTING and release notes with known limits exist.

This issue changes documentation and records verification only. It does not
change application behavior, add or bundle a mapping, publish dataset bytes,
or fill release claims on behalf of the coordinator.

## Current state

- [`README.md`](../../../README.md) has correct locked backend and web install
  commands, but presents a two-terminal development setup rather than a
  clean-clone, built-SPA quickstart. It does not walk a reader through the
  verified upload -> preview -> import -> overview path or state the expected
  TraceLab fixture totals.
- [`docs/architecture/import-pipeline.md`](../../architecture/import-pipeline.md)
  contains a Mermaid `flowchart` for the import boundary and a prose commit
  path. It has no Mermaid `erDiagram`, still introduces itself in terms of
  early issues, and its "Not yet" list can drift as the concurrent Day 4 work
  lands. The running composition root also has the assistant path, static SPA
  serving, JSONL/Parquet readers, SQLite/Alembic, the raw-file store, and
  bundled mapping loading.
- The physical schema in
  `backend/src/agentscope_app/infrastructure/db/models.py` currently contains
  `sources`, `raw_files`, `uploads`, `mappings`, `imports`, `import_files`,
  `raw_records`, `record_results`, `rejects`, `sessions`, `model_calls`,
  `tool_calls`, `entity_contributions`, and `session_diagnostics`. Important
  details for an honest ERD are the nullable `tool_calls.model_call_id`, the
  exactly-one-entity check on contributions, the per-file mapping binding,
  the content-addressed raw-file relationships, and the fact that `source`
  columns are logical namespace values rather than foreign keys to
  `sources.namespace`.
- ADR-001 through ADR-006 exist under [`docs/adr/`](../../adr/). The index in
  [`docs/adr/README.md`](../../adr/README.md) lists only ADR-001 through
  ADR-005. ADR-006 is owned by issue #45 and must not be edited here.
- The shipped metrics endpoint is currently
  `GET /api/metrics/summary?source=&agent=`. Its application DTO exposes
  `sessions`, `model_calls`, `tool_calls`, and `input_tokens`; the latter has
  `value`, `unit`, `coverage {known,total}`, and `by_semantics`. The wording
  lives in `application/use_cases/queries.py`, while
  [`docs/README.md`](../../README.md) still says metric definitions are
  planned. Issue #10 is concurrently extending this surface, so final metric
  documentation must be derived from the merged domain/API contract rather
  than this preliminary implementation or the sprint plan.
- [`docs/mapping/README.md`](../../mapping/README.md) is a thorough DSL and
  target-schema reference and links the bundled TraceLab mapping
  `backend/mappings/tracelab-v1.json`. It does not give a concise inventory of
  the two documented source families. SWE-chat's reviewed session and
  conversation mapping documents currently live under
  `backend/tests/verification/documents/`; they are replay fixtures and are
  deliberately not bundled defaults. The verification report records their
  human corrections and semantic limits.
- [`docs/datasets/README.md`](../../datasets/README.md) records source
  provenance, hashes, licence/redistribution decisions, retrieval and the
  committed TraceLab manifest. Its SWE-chat section still says the excerpt is
  pending even though `scripts/sample_swe_chat.py`, the local ignored
  `data/samples/swe-chat-1/manifest.json`, and the aggregate verification in
  `docs/verification/2026-09-08-second-source-two-models.md` have since
  landed. A clean clone correctly does not contain the gated SWE-chat bytes or
  their local manifest.
- [`docs/llm/configuration.md`](../../llm/configuration.md) documents all
  assistant variables, endpoint examples, failure behavior, live evidence,
  and begins with a one-sentence model-switch summary. It lacks a compact,
  numbered switch/restart/verify/rollback procedure a maintainer can execute
  without reconstructing it from the rest of the page.
- `CONTRIBUTING.md`, `docs/metrics/README.md`,
  `docs/releases/v0.1.0.md`, and a clean-clone verification record do not
  exist. The existing Playwright smoke exercises the product path, but it is
  not evidence that an artifact-free clone can follow the README.

## Design

### 1. Use verified behavior as the documentation source of truth

At implementation start, re-read the files and public contracts named above
after any coordinator-approved integration. Document only code, mappings, and
verification artifacts present in this branch. Do not infer features from the
consolidated plan, another worktree, or an open issue. If a concurrent feature
has not merged, describe the smaller shipped surface accurately rather than
writing future-tense release claims.

The documentation hierarchy will be explicit:

1. ADRs explain durable decisions.
2. Architecture and metric pages describe the shipped implementation.
3. Mapping and dataset pages identify executable/replay artifacts and their
   evidence status.
4. Verification pages record commands and observed results.
5. The release page remains a coordinator-owned draft skeleton.

### 2. Make the README reproduce one main path

Add a "Quickstart from a clean clone" before the contributor-oriented
development commands. From the repository root it will use the pinned tools
and lockfiles:

```sh
git clone https://github.com/fueledbycoffee/AgentScope.git
cd AgentScope
uv --directory backend sync --locked --all-groups
pnpm --dir web install --frozen-lockfile
pnpm --dir web build
cd backend
AGENTSCOPE_LLM_PROVIDER=none uv run uvicorn agentscope_app.interfaces.api.main:app
```

The no-provider setting keeps the optional assistant visibly unavailable
without blocking known saved mappings. The browser walkthrough will open
`http://127.0.0.1:8000/import`, upload
`fixtures/tracelab/tracelab-sample.jsonl.gz`, select `tracelab-v1` revision 1,
preview, import, open the overview, and state the stable acceptance values:
4,770 accepted records, 80 sessions, 4,770 recorded model-call observations,
5,723 tool-call observations, and no rejects. It will also explain where the
default SQLite database/raw files are created and how to remove that local
state intentionally. Keep the existing two-process Vite workflow as a
separate "Development" section and link provider setup as optional.

### 3. Bring the architecture page to the shipped system

Update `docs/architecture/import-pipeline.md` rather than creating a competing
overview. Its Mermaid component diagram will show these named boundaries:

- React SPA/browser and FastAPI routers/composition root;
- application use cases and the application-owned ports;
- framework-free mapping parser/interpreter, profiler/redactor, reducer, target
  schema, and the merged metric definitions actually present at execution;
- filesystem raw store, JSONL/gzip and Parquet readers, SQLAlchemy/Alembic,
  bundled mapping loader, and fake/unavailable/OpenAI-compatible assistant
  adapters;
- SQLite, uploaded bytes, and an optional external chat-completions endpoint;
- the built `web/dist` served by FastAPI and the inward dependency direction.

Add one Mermaid `erDiagram` sourced from the final SQLAlchemy models and
Alembic head. It will include every persisted table, cardinalities for actual
foreign keys, primary/foreign/unique keys needed to understand provenance and
idempotency, and short notes for constraints Mermaid cannot express. In
particular, it will not draw a physical `sources` relationship where the
database has only a logical namespace string, and it will state that an
`entity_contributions` row references exactly one of session/model/tool.
Remove issue-number progress narration and replace the "Not yet" section with
stable v0.1 boundaries linked to the release skeleton or omit it when all
claims have landed.

### 4. Add a metric reference, not a second implementation

Create `docs/metrics/README.md`. For every metric exposed by the merged
definition module and `/api/metrics` routes, provide a table with:

| Column | Contract |
| --- | --- |
| Name/API key | Exact response field and human label |
| Population and formula | Observation grain, numerator, denominator, and aggregation |
| Unit | Canonical unit or count |
| Scope | Supported source/agent/model/period filters actually implemented |
| Missingness/coverage | `known`, `total`, and when `value` is `null`/"Unavailable" |
| Comparability | Semantics tags or other grouping that prevents invalid totals |
| Drill target | Route or entity set behind the value, if implemented |

The reference will use the domain/API wording verbatim where that is the
canonical definition and will explain that zero is measured zero, never a
substitute for unavailable. It will distinguish distinct reconciled sessions
from recorded model/tool observations and show the lossless JSON/UI transport
for values that cannot safely round-trip as JavaScript numbers. If issue #10
has not merged, document only the four current summary values and say so; do
not invent its planned KPIs, charts, filters, or routes.

### 5. Document the two source mappings and manifest status

Add a source-mapping inventory to `docs/mapping/README.md` with two entries:

- **TraceLab:** bundled JSONL mapping, one root recorded model observation plus
  nested tools, source-scoped session identity, token-semantics split, mapped
  fields, intentionally unmapped fields, and a link to the executable JSON.
- **SWE-chat:** two Parquet documents (sessions and conversations) executed as
  one multi-file import under source `swe-chat`; exact links to the reviewed
  verification documents and expected-result fixtures; `role == assistant`
  and `role == tool_use` predicates, Arrow `.iso` timestamp accessors, and the
  recorded limits around thinking rows, result-row joins, call end times,
  latency, and token semantics. Label these as replay evidence, not installed
  mappings, and explain that users must review/save a mapping for their own
  gated files.

Update `docs/datasets/README.md` with a manifest inventory that distinguishes:

- the committed, redistributable TraceLab fixture and its JSON manifest;
- the reproducible but gitignored SWE-chat excerpt and local manifest produced
  by `scripts/sample_swe_chat.py --per-agent 1 --out-dir
  data/samples/swe-chat-1`, with safe aggregate facts linked to the merged
  verification report;
- provenance-only or reserved holdout material, which is not a clean-clone
  fixture and must not be claimed as inspected unless issue #17 evidence has
  merged.

Define the manifest fields readers rely on (source/revision and upstream
hashes, selection seed/caps, output paths/hashes/bytes/row counts, generation
tool/version, licence and redistribution status). Do not add raw data, copy a
local gated manifest blindly, or create a synthetic manifest that looks like
observed evidence.

### 6. Make switching models an explicit operational procedure

Add a numbered section to `docs/llm/configuration.md`:

1. Copy `.env.example` to `backend/.env` if needed and set provider, complete
   endpoint root, exact model id, key policy, timeout, JSON mode, and reply
   budget.
2. Stop and restart the backend, because `Settings` and the assistant adapter
   are constructed at application startup.
3. Verify `/api/health`, then use `scripts/llm_smoke.py` or the visible
   prepare/run UI path; distinguish adapter reachability, executable mapping
   validation, and semantic preview.
4. Roll back by restoring the previous variables or set an unsupported/none
   provider to disable assistance; saved mappings, imports, and dashboards
   remain available.

Keep keys out of commands, screenshots, verification output, and commits.
Retain the existing endpoint-specific and troubleshooting detail instead of
duplicating it.

### 7. Add contributor and release-document structure

Create `CONTRIBUTING.md` with the actual repository workflow: supported tool
versions and locked installs, issue/branch discipline, Clean Architecture
dependency rules, backend/web/e2e command matrix, test placement, mapping and
ADR change rules, data/licence/fixture review, secret handling, lossless number
and unavailable-value UI rules, accessible icon controls, and a pre-PR
checklist. It will link existing authoritative documents instead of copying
their full contracts.

Create `docs/releases/v0.1.0.md` as a structured skeleton only. It will contain
headings for release metadata/tested commit, highlights, supported inputs and
main path, verification evidence, known limits, security/data handling,
upgrade/compatibility notes, and acknowledgements. Every substantive field
will contain an explicit `TODO(coordinator)` marker describing the evidence
needed. It will not state that concurrent work shipped, name a final tag, give
numeric observations, or turn planned limitations into release facts.

Update the documentation indexes to link the new pages and ADR-006. The ADR
index change is a link/summary only; `docs/adr/ADR-006-ui-design-direction.md`
itself remains untouched.

### 8. Rehearse from a genuinely clean tree and record it

Use two small implementation commits. First commit all reader-facing docs.
Then make a temporary local clone of that committed branch with `git clone
--no-local` under `mktemp -d`; do not copy `.env`, `data/`, `.venv`,
`node_modules/`, `web/dist`, or pnpm-store content into it. Before installing,
assert those generated/local paths are absent.

Follow the README literally in the clone. Verify the FastAPI health endpoint,
the built SPA at `/import`, and the full TraceLab browser path. Run the
existing Chromium smoke project in that clone as the repeatable assertion for
upload -> preview -> commit -> overview -> exact-file re-import. Record the
tested commit, OS/tool versions, commands, assertions, observed totals, and
any deviations in `docs/verification/2026-09-08-clean-clone.md`; never record
environment values or process listings. Remove the temporary clone after the
results are captured. Commit the verification record separately so it can
honestly name the previously committed tree it tested.

## Files touched (exhaustive)

Phase 1:

- `docs/superpowers/plans/2026-09-08-documentation.md` (this plan)

Phase 2 implementation, after review:

- `README.md` — clean-clone quickstart and main-path walkthrough.
- `CONTRIBUTING.md` — contributor workflow and checks (new).
- `docs/README.md` — complete documentation index.
- `docs/adr/README.md` — add the existing ADR-006 to the index only.
- `docs/architecture/import-pipeline.md` — current component diagram and ERD.
- `docs/metrics/README.md` — metric definitions and comparability reference
  (new).
- `docs/mapping/README.md` — TraceLab/SWE-chat mapping inventory and status.
- `docs/datasets/README.md` — manifest inventory and current verified status.
- `docs/llm/configuration.md` — explicit model-switch procedure.
- `docs/releases/v0.1.0.md` — coordinator-owned release skeleton (new).
- `docs/verification/2026-09-08-clean-clone.md` — rehearsal evidence (new).

No ADR body, source code, mapping JSON, fixture, lockfile, workflow, generated
asset, local dataset, or release tag is in this issue's write surface.

## Tests

### Documentation checks

- **Relative-link audit:** resolve every new or changed local Markdown link
  from its containing file; separately inspect anchors used by the indexes.
- **Mermaid review:** render or preview both the `flowchart` and `erDiagram`;
  compare every ERD table/edge/constraint note to SQLAlchemy models and the
  Alembic head, and every component to the composition root/import contracts.
- **Claim audit:** search changed docs for `TODO`, "planned", "pending",
  issue numbers, unmerged branch names, secrets, and numeric release claims.
  Only the release skeleton may retain coordinator TODOs; pending evidence
  elsewhere must be intentionally and visibly qualified.
- `git diff --check` and `git status --short` before each commit.

### Clean-clone acceptance rehearsal

- **Artifact-free clone precondition:** before installation, no `.env`,
  `backend/data`, `.venv`, `web/node_modules`, or `web/dist` exists.
- **Locked install/build:** run the exact README `uv sync`, `pnpm install`, and
  `pnpm build` commands in the clone.
- **Single-process serve:** start FastAPI from `backend/` with assistance
  disabled; assert `GET /api/health` and `GET /import` succeed from the built
  backend.
- **Main path:** upload the committed TraceLab fixture, select its bundled
  mapping, preview and commit; assert 4,770 accepted/0 rejected, 80 sessions,
  4,770 model calls, and 5,723 tool calls; re-import the same bytes and assert
  the report is duplicate and totals are unchanged.
- **Browser regression:** in the clean clone, install the pinned Chromium
  binary if absent and run `pnpm --dir web e2e --project=chromium` (or the
  exact equivalent accepted by the existing Playwright CLI).

### Required repository checks

Run from the repository root, with no live provider call:

```sh
uv --directory backend run ruff check src tests ../scripts
uv --directory backend run ruff format --check src tests ../scripts
uv --directory backend run mypy src
uv --directory backend run lint-imports
uv --directory backend run pytest -q
uv --directory backend run python -m unittest discover -s ../scripts -p 'test_*.py'
pnpm --dir web lint
pnpm --dir web typecheck
pnpm --dir web test
pnpm --dir web build
pnpm --dir web e2e
```

If the exact configured commands differ after concurrent merges, use the
checked-in CI/package definitions and update both README/CONTRIBUTING and the
verification record to match; do not make code or CI changes in this issue.

## Acceptance checks mapped to the issue's tasks

| Requirement/task | Planned proof |
| --- | --- |
| Clean clone followed by README reproduces the main path | README quickstart plus committed clean-clone report naming the tested commit; artifact preconditions, health/SPA checks, exact TraceLab path and duplicate invariance recorded. |
| Architecture doc with Mermaid component diagram | Updated `docs/architecture/import-pipeline.md` has one renderable component flow matching the composition root and Clean Architecture boundaries. |
| ERD | The same page has a renderable Mermaid ERD covering every table in the Alembic head, real FK cardinalities, uniqueness/idempotency, nullable parentage, and the exactly-one contribution constraint. |
| ADRs | `docs/adr/README.md` indexes all existing ADR-001..006; ADR-006's body has no diff. |
| Metric definitions | `docs/metrics/README.md` covers every merged API metric with formula/population, unit, filters, coverage/missingness, comparability and drill target; docs index no longer says "planned". |
| Two source mappings | Mapping inventory links and distinguishes the bundled TraceLab mapping from the reviewed, non-bundled two-file SWE-chat replay documents and records each source's semantic limits. |
| Dataset manifests | Dataset inventory links the shipped TraceLab manifest and documents how/status/fields of the local ignored SWE-chat manifest without committing gated bytes or invented evidence. |
| Model-switch procedure | Numbered configure -> restart -> verify -> rollback steps match `Settings` and `build_assistant`; no key appears in tracked text. |
| `CONTRIBUTING.md` | A new contributor can install, select the relevant check matrix, preserve architecture/data/UI rules and prepare a reviewable PR using linked sources of truth. |
| `docs/releases/v0.1.0.md` with known limits | File exists with release and known-limits headings, but all coordinator-dependent claims remain explicit TODO markers as required. |

## Risks

- **Concurrent Day 4 drift:** issues #10, #17, #33, #39, and #45 may change
  metrics, verification facts, schema, UI routes, or indexes after this plan.
  Mitigation: reconcile only merged files at implementation start and again
  immediately before the rehearsal; never read or describe another agent's
  uncommitted worktree. Rerun affected checks when a relevant commit lands.
- **ERD overclaims enforcement:** several `source` and provenance columns look
  relational but are not physical FKs. Mitigation: derive edges from model and
  migration declarations, and explain logical scope separately.
- **SWE-chat documentation can look like product support:** its mappings are
  replay fixtures based on a small gated excerpt and are not installed.
  Mitigation: put status in the inventory table itself, link the verification
  caveats, and give no clean-clone SWE-chat walkthrough.
- **Metrics can drift between domain, SQL, API, and UI:** copied formulas become
  stale. Mitigation: make the merged definition module/API the source of truth,
  cross-check SQL/reference tests, and avoid duplicating definitions in
  architecture/release prose.
- **Circular verification evidence:** an uncommitted README cannot be tested by
  a clean clone, while adding the report changes the final commit. Mitigation:
  commit reader-facing docs first, clone/test that commit, then add only the
  evidence record in a second commit.
- **Environment leakage:** clone/rehearsal commands could inherit a developer
  `.env` or expose process environments. Mitigation: inspect only named safe
  variables, explicitly disable the provider, use fresh local storage, never
  run broad process listings, and record no secrets or raw payloads.
- **Release skeleton mistaken for published notes:** a file named v0.1.0 can
  appear authoritative. Mitigation: label it draft, keep every substantive
  section as `TODO(coordinator)`, and do not add release/tag claims.

## Cost estimate

About one day after review and after the documentation dependencies are merged:

- 0.2 day to reconcile the final schema, routes, metrics, mappings, manifests,
  and concurrent documentation changes;
- 0.35 day to write and cross-link README, architecture/ERD, metrics, mapping,
  dataset, model-switch, contributor, index, and release-skeleton content;
- 0.25 day for the isolated clean-clone install/main-path rehearsal and its
  evidence record;
- 0.2 day for link/Mermaid/claim audits and the full backend, web, and browser
  verification matrix.

Provider calls, dataset downloads, unseen-file rehearsal, release-note
finalisation, tagging, publishing, and application fixes are excluded. Any
failure found by the clean-clone rehearsal is reported to the owning issue or
coordinator; fixing code or CI requires an explicit scope decision.
