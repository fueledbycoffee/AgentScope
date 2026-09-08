# Review (Claude) of the #18 documentation plan

**Verdict: APPROVE WITH CHANGES.**

The plan is unusually careful about the thing that normally goes wrong in a
documentation issue — writing tomorrow's behaviour as today's fact — and its
"Current state" section is accurate everywhere I checked it against the tree.
The changes below are about four things it gets wrong or leaves unspecified:
the clean clone never exercises the assistant or `.env`; the release skeleton
hollows out the one thing the acceptance criterion names; the model-switch
procedure verifies with an endpoint that cannot fail; and the metric reference
would become a third divergent copy of definitions that already exist twice.

Findings: 2 × P1, 6 × P2, 4 × P3.

---

## Findings

### P1-1 — The clean-clone path deletes `.env` and the assistant instead of documenting them
**Section:** Design §2 (README quickstart), §8 (rehearsal), Tests (clean-clone
acceptance rehearsal).

**What is wrong.** The proposed quickstart is
`AGENTSCOPE_LLM_PROVIDER=none uv run uvicorn …` and never mentions `.env` at
all. Three consequences:

1. The repository's headline feature — "An LLM-assisted import helper proposes
   a mapping for files it has never seen" (`README.md`, second paragraph) —
   has no reproducible clean-clone path after this change. `none` resolves to
   `UnavailableMappingAssistant`, so every assistant run answers 503.
2. The current README step it silently drops, `cp ../.env.example .env`, is a
   documented trap that this issue is the right place to fix. `.env.example`
   ships `AGENTSCOPE_LLM_MODEL=inclusionai/ling-3.0-flash-fin:free` with
   `AGENTSCOPE_LLM_API_KEY=` empty. `OpenAICompatibleAssistant.__init__`
   (`backend/src/agentscope_app/infrastructure/llm/openai_compatible.py:132-150`)
   validates base URL, model, timeout, JSON mode and max tokens but **not** the
   key: `if api_key:` simply omits the `Authorization` header. So a reader who
   follows today's README verbatim gets an application that starts fine and an
   assistant that fails only at the first live call, with
   `503 … refused the request (401)` (`docs/llm/configuration.md`,
   Troubleshooting). Removing the step without correcting it leaves the trap
   in place for anyone who read the README before.
3. The plan therefore never rehearses what the issue's own gate is about: a
   clean clone, no key, and the offline assistant.

**Evidence checked.** `README.md`; `.env.example`;
`backend/src/agentscope_app/infrastructure/settings.py` (defaults
`llm_provider=openai_compatible`, `llm_model=""`, empty key);
`backend/src/agentscope_app/interfaces/api/container.py:76-100` (`build_assistant`:
`fake` → `FakeMappingAssistant(settings.bundled_mappings_dir)`,
`openai_compatible` → live adapter, anything else → `UnavailableMappingAssistant`);
`web/e2e/start-backend.mjs` (sets `AGENTSCOPE_LLM_PROVIDER: 'fake'` and
`AGENTSCOPE_LLM_API_KEY: ''` — "never a provider, never a key");
`web/e2e/assist.spec.ts` (drives the whole analyse → review payload → revise →
validate → save → preview → import path against that fake, offline, in a
browser).

**Required change.** The quickstart must document `.env` as the mechanism
(copy `.env.example` to `backend/.env`, leave the key empty) and make
`AGENTSCOPE_LLM_PROVIDER=fake` the clean-clone default: it is offline,
deterministic, needs no key, and is already the exact configuration the shipped
e2e suite uses for the assistant. `none` stays as the documented
"no assistant at all" variant for the pure import walkthrough. The rehearsal in
§8 must then walk the fake-assistant path in the clone as well as the TraceLab
import path, and record it. If the quickstart also keeps
`cp ../.env.example .env`, the shipped `.env.example` comment must say that the
default `openai_compatible` block needs a key and that `fake` is the offline
choice — otherwise correct the trap by pointing the copy step at `fake`.

---

### P1-2 — The release skeleton empties the one field the acceptance criterion names
**Section:** Design §7 (release document), Acceptance checks row
"`docs/releases/v0.1.0.md` with known limits".

**What is wrong.** The issue's expected verifiable result is "release notes
with known limits exist". The plan makes *every* substantive field, known
limits included, an explicit `TODO(coordinator)` marker, and its own acceptance
row concedes that ("all coordinator-dependent claims remain explicit TODO
markers"). A file whose Known-limits heading contains only a TODO does not
satisfy the criterion.

The distinction the plan misses is that known limits are **properties of the
merged code and of already-published evidence**, not release claims. They can
be written today without asserting that anything shipped, and they are the part
of a release note the coordinator is least able to reconstruct later. They are
already documented in this branch:

- SWE-chat coverage is partial in both tables; conversations have no provider
  field, `token_semantics` is `unknown`, and call end times and latency are
  unavailable because the result arrives on a row the mapping cannot join
  (`docs/verification/2026-09-08-second-source-two-models.md`, "Coverage" and
  "Final documents").
- An assistant row is not an API call; `tool_use` and `tool_result` share a
  `tool_call_id` (same report, "Source audit").
- Hard product limits: 25 MiB per file, 100,000 records per batch, 64 KiB
  assistant context after trimming (`docs/api/v0.1.md`, Errors).
- Free hosted models vary run to run and retire without notice; reasoning
  models need a 32,768 budget and a deadline in minutes
  (`docs/llm/configuration.md`, evidence table).
- Scope explicitly excluded from v0.1.0
  (`docs/planning/2026-09-07-consolidated-plan.md` §8).
- The `sources` table exists in the schema but nothing reads or writes it (see
  P3-1).

**Required change.** Fill "Known limits" and "Supported inputs and main path"
from merged evidence, each line citing the file it comes from. Restrict
`TODO(coordinator)` to what genuinely belongs to the coordinator: tag name,
release date, tested commit, highlights, and the final verification links.
Keep the draft label.

---

### P2-1 — The model-switch procedure verifies with an endpoint that cannot fail
**Section:** Design §6, step 3.

**What is wrong.** Step 3 says "Verify `/api/health`, then use
`scripts/llm_smoke.py` or the visible prepare/run UI path". `/api/health` is
registered inside `create_app` before the router and returns
`{"status": "ok", "version": …}` unconditionally
(`backend/src/agentscope_app/interfaces/api/main.py`). It never touches the
assistant. A misconfigured switch produces an `UnavailableMappingAssistant` and
a perfectly healthy `/api/health` — this is by design (ADR-005, restated in
`docs/llm/configuration.md`: "An invalid or missing assistant configuration
never stops the application"). Leading a *model-switch* procedure with it
teaches the reader the wrong signal.

Second problem in the same section: step 1 lists "timeout, JSON mode, and reply
budget" as fields to set, but the procedure carries none of the Ling evidence
that makes those fields matter. The documented defaults are 60 s and 8,192
(`settings.py`; the table in `docs/llm/configuration.md`), while `.env.example`
ships 240 s and 32,768 — and the evidence table records that the 8,192 default
"cut off twice with no content: 7,913 of 8,192 tokens went to hidden
reasoning". A numbered procedure that omits this reproduces the exact failure
the sprint already paid for.

**Evidence checked.** `main.py` (`health` handler, no container access);
`container.py:76-100`; `settings.py`; `.env.example`;
`docs/llm/configuration.md` (variable table, "Reasoning models", "Provider
errors relayed by OpenRouter", evidence table).

**Required change.** Remove `/api/health` as switch evidence, or keep it only
labelled "confirms the application is up; it says nothing about the assistant".
Add an explicit branch to step 1: for a reasoning model set
`AGENTSCOPE_LLM_MAX_TOKENS` to at least 32,768 and
`AGENTSCOPE_LLM_TIMEOUT_S` in minutes, and expect the
`json_mode_off_after_rejection` negotiation on endpoints that reject
structured outputs. Make the verification step the exact command already in the
page: `uv --directory backend run python ../scripts/llm_smoke.py`.

---

### P2-2 — The metric reference becomes a third, divergent copy
**Section:** Design §4; Files touched.

**What is wrong.** Metric definitions already exist twice in this branch and
the two copies have already drifted:

- Source of truth: `backend/src/agentscope_app/application/use_cases/queries.py:169`
  `DEFINITIONS` — e.g. `"Distinct sessions in scope (reconciled by source and external_id)."`
- `docs/api/v0.1.md:269-285` prints `"Distinct sessions in scope"` and
  `"Sum of input_tokens over calls with a known value; semantics per token_semantics"` —
  neither string matches the code any more.
- The shipped `/definitions` page (`web/src/pages/Definitions.tsx`) renders the
  definitions **from the API at runtime**, and its own comment says it
  "renders what the summary returns rather than restating it by hand".

The plan adds a fourth surface, does not mention `/definitions` at all, and
does not put `docs/api/v0.1.md` in its write surface — so the stale copy
survives a PR whose stated goal is that definitions have one home.

**Required change.** State in `docs/metrics/README.md` that
`queries.DEFINITIONS` is the single source, quote it verbatim, and link the
`/definitions` page as the runtime view of the same strings. Then either add
`docs/api/v0.1.md` to the write surface and correct its four sample strings in
the same PR, or record the drift explicitly as a defect handed to #10 — but do
not leave it undeclared.

---

### P2-3 — The rehearsal's "repeatable assertion" tests a different server than the README
**Section:** Design §8; Tests → clean-clone acceptance rehearsal, "Browser
regression".

**What is wrong.** The plan proposes running the Chromium smoke project in the
clone "as the repeatable assertion for upload -> preview -> commit -> overview
-> exact-file re-import". That suite does not run the README's commands. Its
`webServer` runs `node e2e/start-backend.mjs`, which spawns its *own*
`uv run uvicorn` on port 8765 with `AGENTSCOPE_DATABASE_URL` and
`AGENTSCOPE_RAW_FILE_DIR` pointed at a `mkdtemp` root and
`AGENTSCOPE_LLM_PROVIDER=fake`, and removes that root on exit
(`web/playwright.config.ts`, `web/e2e/start-backend.mjs`). The README path is a
different port, a different provider setting, and the default on-disk store at
`backend/data/agentscope.sqlite3` / `backend/data/raw-files` (`settings.py`).
Green Playwright is evidence that the built artefacts and the product path
work; it is not evidence that the documented commands do. The plan says exactly
this in its own Current state ("it is not evidence that an artifact-free clone
can follow the README") and then contradicts it in Tests.

**Required change.** Split the evidence in
`docs/verification/2026-09-08-clean-clone.md` into two clearly labelled parts:
(a) the README server started by the documented command on :8000, walked
through the browser, with the four totals read from
`GET /api/metrics/summary` **on that server** and the created `backend/data`
paths listed; (b) the Playwright smoke as a separate regression, with a
sentence saying it uses its own throwaway backend and therefore does not
exercise the README commands.

---

### P2-4 — Playwright browser installation is unspecified, and the command is not the obvious one
**Section:** Tests → "Browser regression"; Files touched (README, CONTRIBUTING).

**What is wrong.** The plan says only "install the pinned Chromium binary if
absent". CI installs
`pnpm exec playwright install --with-deps chromium-headless-shell`
(`.github/workflows/ci.yml`, `e2e` job). The intuitive
`playwright install chromium` is not that, and a clean-clone reader who guesses
will either download the wrong set or all browsers. The rehearsal will hit this
and the resulting README/CONTRIBUTING text will be invented at the keyboard
unless the plan pins it now.

Two adjacent facts the docs must also carry, both verified: `pnpm --dir web e2e`
is `pnpm build && playwright test` (`web/package.json`), so it rebuilds `dist`
itself; and `start-backend.mjs` spawns `uv run uvicorn` with `cwd: backend`, so
the backend `uv sync` must already have happened or the e2e run fails with no
useful message.

**Required change.** Name the CI command verbatim in README/CONTRIBUTING and in
the rehearsal steps, and state the two ordering facts above.

---

### P2-5 — The "Required repository checks" do not match CI
**Section:** Tests → Required repository checks; Files touched (CONTRIBUTING).

**What is wrong.** CONTRIBUTING is supposed to be how a contributor predicts
`ci-required`. The plan's matrix already differs from `.github/workflows/ci.yml`
today, before any concurrent merge:

| Plan | CI (`ci.yml`) |
| --- | --- |
| `ruff check src tests ../scripts` | `ruff check . ../scripts` |
| `ruff format --check src tests ../scripts` | `ruff format --check . ../scripts` |
| `mypy src` | `mypy` |

`mypy src` is not a narrower run of the same thing: `backend/pyproject.toml`
configures `packages = ["agentscope_app"]` with `mypy_path = "src"`, so passing
a path overrides the configured selection. The plan's escape hatch ("if the
exact configured commands differ after concurrent merges, use the checked-in CI
definitions") reads as a future contingency, but the divergence exists now.

**Required change.** Copy the commands from `ci.yml` verbatim into the plan and
into CONTRIBUTING, and add a one-line rule that CONTRIBUTING mirrors `ci.yml`
and is updated with it.

---

### P2-6 — Implementation is gated on unmerged issues with no cut-off, against a 2026-09-11 sprint end
**Section:** Cost estimate; Risks → "Concurrent Day 4 drift".

**What is wrong.** The estimate is "about one day **after review and after the
documentation dependencies are merged**". The dependencies named are #10, #17,
#33, #39 and #45, all in flight. With today at 2026-09-08 and the sprint ending
2026-09-11, an unbounded wait on five parallel issues is the single largest
schedule risk in the plan, and nothing in the plan bounds it. The 1.0-day
breakdown is otherwise credible, though the 0.2 day for "link/Mermaid/claim
audits and the full backend, web, and browser verification matrix" has to cover
that matrix twice (repo and clone), including a cold `uv sync`, `pnpm install`,
`pnpm build` and a browser download in a fresh temp tree.

**Required change.** Name a freeze: write against the surface merged at a
stated commit and time, say so in the docs and in the verification record, and
declare that anything landing after it is a follow-up issue rather than a
re-write. Also make explicit which of the eleven files can be written *before*
the freeze (CONTRIBUTING, ERD, mapping and dataset inventories, model-switch
procedure — none of these depend on #10/#39/#45) so the critical path is only
the metrics page, the architecture "Not yet" replacement and the release
skeleton.

---

### P3-1 — The ERD needs a bounded attribute rule, a table-set check, and an honest note about `sources`
**Section:** Design §3 (ERD); Tests → Mermaid review.

The plan says the ERD "will include every persisted table" but never says which
attributes, which is how a 14-table `erDiagram` becomes unreadable on GitHub.
Two concrete improvements:

- The table set is checkable, not typed: `backend/tests/infrastructure/test_database.py:33`
  holds `EXPECTED_TABLES` with exactly the 14 names the plan lists. Cite it as
  the source and the ERD can never silently drift from the Alembic head.
- `sources` is created by migration `0001_initial_schema` and mapped at
  `models.py:80`, but **no repository reads or writes it**: grepping
  `infrastructure/db/` for `Source` returns only the class definition, and
  `repositories.py` never mentions it. Drawing it as an entity implies a live
  source registry that does not exist. The plan already promises not to draw a
  false FK from the logical `source` strings — good — but it must also say the
  table is presently unpopulated, and that belongs in the release notes'
  known limits too (P1-2).

Also worth stating the attribute rule explicitly: primary keys, real foreign
keys, the unique constraints that carry idempotency
(`uq_model_calls_occurrence`, `uq_tool_calls_occurrence`,
`uq_sessions_source_external_id`, `uq_raw_records_locator`,
`uq_mappings_name_revision`, the partial `(sha256, source) WHERE committed = 1`
index on `import_files`) and nothing else, with the rest as prose.

---

### P3-2 — `web/README.md` is stale, reachable from a clean clone, and out of the write surface
**Section:** Files touched.

`web/README.md` ships in every clone and currently says: the app is "the day-1
trace import and inspection slice"; the dashboard lives at `/dashboard`
(`web/src/App.tsx:43` now redirects `/dashboard` to `/overview`); and the API
contract "is carried by the backend PR for issues #5 and #6" — a PR reference in
shipped documentation, exactly the kind of issue-number narration the plan
strips from the architecture page. The plan's exhaustive file list excludes it.

**Required change.** Either add it to the write surface and bring it in line, or
state in the plan that it is knowingly out of scope and name the issue that owns
it. Silence means a clean-clone reader is told to open a route that redirects.

---

### P3-3 — There are three reviewed SWE-chat documents, not two
**Section:** Design §5 (mapping inventory).

The plan describes "two Parquet documents (sessions and conversations)".
`backend/tests/verification/documents/` contains three mapping documents, each
with an `.expected.json`: `swe-chat-sessions-v1.json` (run A-sessions-3),
`swe-chat-conversations-v1.json` (run B-conversations-5, NVIDIA config, four
reviewer corrections) and `swe-chat-conversations-v1-a.json` (run
A-conversations-6, dots-studio config, four corrections). Two *tables*, three
*documents*, from two model configurations — which is the point of #16 and
worth saying. `test_replay_without_assistant.py` globs the directory, so the
count is load-bearing.

**Required change.** Say "two tables, three reviewed documents", and name the
run and model behind each so the inventory matches the verification report.

---

### P3-4 — Small corrections to the drift list, the clone command and the tool pins
**Sections:** Risks; Design §8; Design §2.

- The drift list is "#10, #17, #33, #39, and #45" but omits **#11**, whose
  dashboard is named in the architecture page's "Not yet" section that this
  plan deletes. Add it (note that `/overview`, the scope bar and the KPI
  regions are already merged and exercised by `web/e2e/smoke.spec.ts`, so the
  remaining #11 surface needs checking, not assuming).
- `git clone --no-local` from a linked worktree resolves HEAD in a way that is
  easy to get wrong. Pin it: `git clone --no-local --branch docs/18-documentation`,
  and record the cloned commit SHA in the verification file.
- The quickstart should pin the tool versions the lockfiles assume: uv
  `0.11.15` (`ci.yml`), Node 24 (`ci.yml`), pnpm `10.28.1`
  (`web/package.json` `packageManager`). `--frozen-lockfile` and
  `--locked` fail unhelpfully on a mismatch.

---

## What the plan gets right

- **The "Current state" section is accurate.** Every claim I checked holds: the
  14 tables and their names; the nullable `tool_calls.model_call_id`
  (`models.py:259`); the exactly-one-entity `CheckConstraint` on
  `entity_contributions` (`models.py:296`); the per-file mapping binding on
  `import_files`; `source` as a logical namespace rather than an FK; ADR-006
  present but missing from `docs/adr/README.md`; the four metrics and their DTO
  shape; `docs/README.md` still calling metric definitions "planned";
  `docs/datasets/README.md` still saying the SWE-chat excerpt is "pending"
  after `scripts/sample_swe_chat.py` landed; `docs/llm/configuration.md`
  lacking a compact procedure. That is a plan written from the tree, not from
  the issue tracker.
- **The unmerged-work discipline is right and specific.** "Document only code,
  mappings, and verification artifacts present in this branch. Do not infer
  features from the consolidated plan, another worktree, or an open issue" —
  plus the explicit instruction to document the four current summary values if
  #10 has not merged, and to leave `ADR-006`'s body untouched. This is exactly
  the failure mode a Day-4 documentation issue invites.
- **The two-commit rehearsal design is correct** and resolves a real circularity:
  reader-facing docs first, clone and test that commit, then add the evidence
  record naming the tree it tested. The artifact-free precondition assertions
  (`.env`, `backend/data`, `.venv`, `web/node_modules`, `web/dist`) are the
  right ones and match `.gitignore`.
- **The SWE-chat framing is honest.** Labelling the reviewed documents replay
  evidence rather than installed mappings, refusing a clean-clone SWE-chat
  walkthrough, and putting status in the inventory table itself all match what
  `docs/verification/2026-09-08-second-source-two-models.md` actually
  established, including the `role == "assistant"` / `role == "tool_use"`
  predicates and the `.iso` accessors.
- **The dataset section refuses the tempting shortcuts**: no gated bytes, no
  copied local manifest, no synthetic manifest dressed as observed evidence,
  and the holdout stays uninspected pending #17.
- **Restraint on scope.** Updating `docs/architecture/import-pipeline.md`
  instead of creating a competing overview; the ADR index touched by link only;
  "no ADR body, source code, mapping JSON, fixture, lockfile, workflow,
  generated asset, local dataset, or release tag is in this issue's write
  surface"; and reporting rehearsal failures to the owning issue rather than
  fixing code here.
- **The secret hygiene is right throughout**: no keys in commands, screenshots,
  verification output or commits; no process listings; fresh local storage for
  the rehearsal.
