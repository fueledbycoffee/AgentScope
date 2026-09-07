# Second source through the UI, two model configurations (issue #16)

Status: **complete** (all runs on the evening of 2026-09-07; report finalised
2026-09-07 23:45 local).
Definitions and gates: `docs/superpowers/plans/2026-09-07-second-source-two-models.md`
(revision 2, §0). This report records what the runs showed and nothing more.

## Environment

| Item | Value |
| --- | --- |
| Application | AgentScope at the commit named in the "Tested commit" line below (branch `feat/16-second-source` rebased on `main` after PRs #38, #40, #41) |
| Endpoint | OpenRouter, `https://openrouter.ai/api/v1` (`/chat/completions`), key from `backend/.env`, never recorded |
| Config A | `dots-studio/dots-3-note-preview:free` (vendor dots-studio), JSON mode `auto`, timeout 180 s, max tokens 8192 |
| Config B | `nvidia/nemotron-3-super-120b-a12b:free` (vendor NVIDIA), same settings |
| Substitutions tried for B | `liquid/lfm-2.5-2.6b:free` (Liquid AI): cut off twice on both tables (87 s, 53 s), recorded as failed. `google/gemma-4-26b-a4b-it:free`: 429 rate-limited upstream on every attempt. |
| Harness | `web/e2e/verify-second-source.mjs` (local only): one isolated backend per run (own SQLite file and raw store under `data/verification/runs/<run>/backend`), the built web app, Playwright driving the same UI a person uses; database snapshot taken after saving and before importing |
| Context versions | context 1, prompt 1, profiler 1, sanitizer 2 |
| Dataset | SWE-chat excerpt `data/samples/swe-chat-1/` built by `scripts/sample_swe_chat.py --per-agent 1` (manifest in that directory: upstream hashes, seed, output hashes); 12 sessions, 518 conversation rows; not committed (dataset terms) |
| Tools | uv lock and pnpm lock at the tested commit; Playwright 1.63 |
| Tested commit | branch `feat/16-second-source` at the commit that adds this line (the PR's head; the runs used the application as of `fef4d61`, whose backend and web code equal that head: only docs, fixtures and the harness changed after) |

## Source audit (aggregate only, `scripts/audit_swe_chat.py`)

- Conversations: 518 rows; `role × turn_type`: assistant/assistant_response 127,
  assistant/assistant_thinking 22, tool_use 88, tool_result 62, user/user_prompt 21,
  user/system_injected 6, metadata (progress 174, queue_operation 10,
  file_snapshot 6, summary 1, system_event 1). No continuation rows in the excerpt.
- Ids: `turn_id` 518 distinct of 518; `session_id` 12 of 12 in sessions;
  `tool_call_id` 88 distinct over 148 non-null rows, so **tool_use and
  tool_result rows share the id** (a call and its result).
- Assistant rows versus the sessions table's declared `api_call_count`: equal
  in 4 sessions, more assistant rows in 3, fewer in 5. **An assistant row is
  not an API call**; the dataset notes said this was unvalidated, the excerpt
  confirms it.
- `tool_name`: on all 88 tool_use rows, on 44 of 62 tool_result rows.
- Nulls: `timestamp` null on 112 conversation rows; `model` null on 470
  (present essentially on assistant rows); sessions `created_at` null on 2,
  `attribution_calculated_at` on 4, `duration_seconds` on 8.
- Timestamps: sessions `created_at`, `attribution_calculated_at` are
  `timestamp[ns, UTC]`; conversations `timestamp` is `timestamp[us, UTC]`
  (Arrow wrappers with `.iso` accessors in the profile).

Inclusion predicates used for the conversations mapping: model calls are
`role == "assistant"` rows (both `assistant_response` and
`assistant_thinking`; the thinking rows have no tokens and no model), tool
calls are `role == "tool_use"` rows (tool_result rows are results, not calls);
user, system-injected and metadata rows emit nothing. Sessions come from the
sessions table only; token totals there are session aggregates and are left
unmapped (no per-call rows); `token_semantics` is `unknown`.

## Pre-checks (profile only, `scripts/llm_smoke.py --file …`, no UI)

| Config | Table | Time | Calls | Model outcome | Notes |
| --- | --- | --- | --- | --- | --- |
| A | sessions | 38 s | 1 | executable | 5 explanations, 1 ambiguity (`session.ended_at`), 2 questions |
| A | conversations | 141 s | 2 | draft (`not_an_object`, `required_field_unmapped`) | 20 explanations, 4 ambiguities, 3 questions |
| B (Liquid, failed) | sessions | 87 s | 2 | error: truncated twice | |
| B (Liquid, failed) | conversations | 53 s | 2 | error: truncated twice | |
| B | sessions | 131 s | 1 | executable | 6 explanations, 1 ambiguity, 1 question |
| B | conversations | 94 s | 2 | executable | 28 explanations, 9 ambiguities, 6 questions |

Prepared context: sessions 21,430 bytes (redactions `long_text` 3),
conversations 20,154 bytes (redactions `long_text` 5, `path` 8: file paths in
the conversations' `file_path`/`command` examples left as `<path>`). No sample
was included in the pre-checks.

## Runs through the UI

*(one row per run; filled as the runs complete; artifacts under
`data/verification/runs/<run>/`, local)*

| Run | Config | Table | Sample | Calls | Model outcome | Corrections | Saved | Preview | Import | Replay |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A-sessions | A | sessions | off | 2 | executable | none applied (harness v1) | rev 1 `map_93ed…` | 0 accepted / 12 rejected (`invalid_value`: `$.created_at` is the wrapper, not `.iso`) | committed with 12 rejects (harness v1 imported anyway; kept as evidence of the gate that was then added) | — |
| A-sessions-2 | A | sessions | off | 1 | executable (this reply used `$.created_at.iso` itself and added `ended_at`) | none | rev 1 `map_396b…` | 4 accepted / 8 rejected (`reversed_interval`: `attribution_calculated_at` precedes `created_at` by milliseconds; it is not an end time) | committed 4/12 | — |
| A-sessions-3 | A | sessions | off | 2 | executable after the built-in repair, `$.created_at.iso`, no `ended_at` | none needed (both prepared corrections were not applicable) | rev 1 `map_f0a1…` | 12 accepted / 0 rejected | committed 12/12 (session 12) | pre-import snapshot restored, backend with `AGENTSCOPE_LLM_PROVIDER=none`: import through the Import page committed, 12 sessions under `source=swe-chat`, no assistant request in the browser log (`replay-A-sessions-3`) |
| A-conversations | A | conversations | off | — | harness v1 timed out waiting for a reply bubble (the page shows failures as notices, which v1 did not watch); no artifacts; rerun as A-conversations-2 | | | | | |
| B-sessions | B | sessions | off | — | harness v1 timed out the same way; rerun below | | | | | |
| B-sessions-2 | B | sessions | off | 2 | executable after the built-in repair, `$.created_at.iso`, no `ended_at` | none needed | rev 1 `map_88c1…` | 12 accepted / 0 rejected (warnings: `precision_reduced` 10, `null` 3) | committed 12/12 (session 12) | snapshot restored, `AGENTSCOPE_LLM_PROVIDER=none`: control prepare 200 then run **503 assistant_unavailable**; Import page import committed, 12 sessions under `source=swe-chat`, zero assistant run requests (`replay-B-sessions-2`) |
| B-conversations | B | conversations | off | 1 | executable | 1: `"$.timestamp"` → `"$.timestamp.iso"` (base `df02f6fa…`, target `cf4124b1…`) | rev 1 `map_622e…` | 200 sampled: 74 accepted, 126 partial, 0 rejected; 50 reject rows in the sample (tool_call rule) | committed 518/518 records: 9 sessions, **149 model calls (= assistant rows), 132 tool calls (88 tool_use + 44 tool_result rows with a name)**, 386 `missing_required tool_name` emission rejects: the rule's `where tool_name exists` is true for Parquet nulls and for result rows | pending (rerun with the predicate fixed below) |
| B-conversations-2 | B | conversations | off | 1 | executable; this reply used `$.timestamp.iso` itself but left the **model_call rule without a `where`** | 1: tool_call `where` → `role == "tool_use"` | rev 1 `map_74da…` | accepted 518/518, 0 rejects | committed: 9 sessions, **518 model calls (every row), 88 tool calls** | not replayed: semantically wrong (a model call per row); superseded by B-conversations-3 |
| B-conversations-3 | B | conversations | off | 1 | executable | both `where` corrections prepared | — | — | — | harness v3 waited on an invalid locator at validation; no outcome (corrected document kept) |
| B-conversations-4 | B | conversations | off | — | no reply and no error notice within 420 s (two 180 s calls plus preparation can exceed it) | | — | — | — | rerun with a 600 s wait and a 240 s adapter timeout |
| B-conversations-5 | B | conversations | off | 1 | executable (this reply used the wrapper path again) | 4: `$.timestamp` → `$.timestamp.iso`; tool_call `where` → `role == "tool_use"`; model_call `where` → `role == "assistant"`; `notes` set by the reviewer (all recorded with base/target hashes) | rev 1 `map_cd22…` | 518 accepted, 0 rejected | committed 518/518: **9 sessions, 149 model calls, 88 tool calls, 0 reject rows** (the audit's expected counts) | snapshot restored, `AGENTSCOPE_LLM_PROVIDER=none`: control prepare 200 then run **503**; Import page import committed: **9 sessions, 149 model calls, 88 tool calls, 0 rejects**, identical; zero assistant run requests (`replay-B-conversations-5`) |
| A-conversations-2 | A | conversations | off | 1 | draft: the only issue is `notes` (an object instead of a string); rules were right (session `where is_first_turn == true`, model_call `role == assistant`) | tool_call `where` applied; harness v2 did not watch the issue list and timed out at validation | — | — | — | — |
| A-conversations-3 | A | conversations | off | — | stopped on purpose (same locator defect) | | | | | |
| A-conversations-4 | A | conversations | off | 2 | executable after the built-in repair (`$.timestamp.iso` by itself) | model_call `where` → `role == "assistant"`, `notes` string; the tool_call `where` correction was **lost by a harness flag-parsing defect** (repeated `--set-where` kept only the last) | rev 1 `map_d1ae…` | 518 accepted | committed 518/518: 9 sessions, **149 model calls (correct)**, 132 tool calls and 386 `missing_required` emission rejects (the presence test again) | superseded by A-conversations-5 |
| A-conversations-5 | A | conversations | off | 2 | draft: **every path written as a bare column name** (`session_id`, `timestamp`, …), a new variance of the same model | both `where` predicates and notes applied; not executable (invalid paths) | — | — | — | rerun as A-conversations-6 with a systematic `$.` prefix correction |
| A-conversations-6 | A | conversations | off | 2 | executable after the built-in repair (this reply used `$.`-prefixed paths, so the bare-path correction was not needed) | 4: `$.timestamp` → `$.timestamp.iso`; tool_call `where` → `role == "tool_use"`; model_call `where` → `role == "assistant"`; `notes` set by the reviewer | rev 1 `map_1c8a…` | 246 accepted, 272 ignored (rows emitting nothing), 0 rejected | committed 518/518: **9 sessions, 149 model calls, 88 tool calls, 0 reject rows** | snapshot restored, `AGENTSCOPE_LLM_PROVIDER=none`: control prepare 200 then run **503**; import committed with identical counts; zero assistant run requests (`replay-A-conversations-6`) |

## Findings so far

1. Both models understand the profile well enough to propose the right
   fields; the recurring mistake is addressing a Parquet timestamp wrapper by
   its object path (`$.created_at`) instead of the accessor the profile lists
   (`$.created_at.iso`). The result is contract-valid and fails on every
   record at preview time, which the UI shows before import.
2. Guessing an end time from `attribution_calculated_at` is wrong for this
   source (it precedes the start); the reducer's reversed-interval guard
   caught all eight cases. The right mapping leaves `ended_at` null.
3. Free hosted models are intermittently unavailable (429, upstream
   overload, cut-off replies); the adapter reports each cleanly and the
   substitution log records what was tried.
4. The conversations table's tool rows need a role predicate, not a
   presence test: Parquet keeps `tool_name: null` on every non-tool row, the
   DSL's `exists` is true for a present null, and 44 tool_result rows carry a
   tool name. `where tool_name exists` therefore fires on all 518 rows,
   rejects 386 emissions as `missing_required` and double-counts 44 results as
   calls. The correction is `where role == "tool_use"` (the audit predicted
   it; the built-in fake already uses it).
5. Model variance is large between identical requests: config B once wrote a
   `model_call` rule with no `where` at all, which imports "successfully" with
   a model call per row (518). Executable and accepted are not the same as
   right; the preview's entity counts are what a reviewer must read.
6. Both models' `model_call` rule (`role == "assistant"`) counts
   `assistant_thinking` rows as calls (22 of 149 in the excerpt); whether that
   is right depends on what the source means by a turn, which the audit shows
   is not "one API call" (assistant rows equal the declared call count in 4 of
   12 sessions). Recorded as a coverage limit, not corrected.
7. Both models copied the row's `timestamp` into both `started_at` and
   `ended_at` of every model and tool call, so each call read as a zero-length
   interval and the latency metrics as zero. A row has one instant; the tool
   result's time sits on another row the mapping cannot join. Corrected after
   the run in every committed conversations document (ends left null), and the
   regression fixture pins a call whose result row is one second later. Found
   by the adversarial review of the pull request, not by either agent during
   the runs: a mapping that validates and imports cleanly can still assert
   something the data does not say.

## Replay without the assistant

Four replays, each run three times (`replay-*`; `replay2-*` after the harness
gained explicit pass/fail assertions; `replay3-*` after the second adversarial
review made the comparison a real one: the original run's import report is
the baseline, and the replay must reproduce its accepted and rejected counts
and its mapping id and revision, the expected session count and entity counts
are mandatory flags, the control run must answer 503, and the request log
must hold zero assistant runs; all four `replay3-*` runs PASSED): the pre-import
snapshot restored into a fresh backend started with
`AGENTSCOPE_LLM_PROVIDER=none` and an empty key; a control prepare answered
200 and the following run **503 assistant_unavailable**; the import through the
Import page with the saved revision committed with counts identical to the
live run (12 sessions; 9 sessions, 149 model calls, 88 tool calls); the
browser request log contains zero assistant run requests.

The API regression test `backend/tests/verification/test_replay_without_assistant.py`
builds the real application container with its assistant replaced by a
recorder that raises on any call, then saves each reviewed document, uploads a
synthetic SWE-shaped Parquet table (with a first-turn row so config A's
session predicate fires), previews and imports through the HTTP API, and
asserts: committed, zero duplicates, the expected accepted count and entity
counts, the distinct sessions and their mapped `agent`, each call row's
declared start and a **null end** (the fixture's tool_use row is at 12:00:03
and its result row at 12:00:04; a mapping that copied the start into the end
would have been caught here), an assistant control call that stops at the
digest check, zero recorder calls, and the same revision found again by
content hash.

## Acceptance matrix

| | Config A | Config B |
| --- | --- | --- |
| sessions: live proposal | yes | yes |
| sessions: human-assisted completion | **yes**, zero manual edits (run A-sessions-3; the two earlier runs show the model's variance: wrapper path, then a wrong `ended_at`) | **yes**, zero manual edits (B-sessions-2) |
| conversations: live proposal | yes (executable after the built-in repair in runs 4 and 6; drafts in 2 and 5) | yes (executable, one call) |
| conversations: human-assisted completion | **yes**, four recorded corrections (accessor, two role predicates, notes) | **yes**, the same four corrections |
| replay passed | yes (both tables; UI replays with the 503 control; API regression test on the final documents) | yes (both tables; UI replays with the 503 control; API regression test on the final documents) |

Coverage: sessions **partial** (token and tool aggregates unmapped by design);
conversations **partial** (no provider field; token semantics unknown; latency
and status fields absent from the source).

## Final documents

Committed under `backend/tests/verification/documents/` after review (paths,
role predicates and notes only; no source values):
`swe-chat-sessions-v1.json` (A-sessions-3; B-sessions-2 produced a document
with the same fields), `swe-chat-conversations-v1.json` (B-conversations-5,
**with four reviewer corrections applied after the run**, recorded in the
document's `notes` and in the fixture's provenance: the session rule's
`ended_at` (a turn's timestamp is not a declared end; the reducer would keep
the first row's value and raise `conflicting_value` on the rest), the literal
`is_error: false` on model and tool calls (an unknown outcome stays null, the
UI shows "unavailable" rather than "no"), `tool_call.status ← $.category`
(a category is not an outcome), and `ended_at ← $.timestamp.iso` on model and
tool calls (a row's timestamp is one instant, the start; the result arrives on
another row the mapping cannot join, so the end stays null and the latency
metrics stay unavailable rather than reading zero). The revision imported in
run B-conversations-5 still carried those fields; its counts are unaffected,
its declared session ends, error flags and call ends were fabricated and are
not to be trusted), `swe-chat-conversations-v1-a.json` (A-conversations-6: the
minimal set, **with the same call-end correction**: both models copied the
row's timestamp into both `started_at` and `ended_at`, the one correction
common to every conversations proposal). Each
carries an `.expected.json` with the outcomes computed on the synthetic
SWE-shaped table (sessions: 3 rows accepted, 3 session emissions;
conversations, 6 rows: B's unconditional session rule accepts all 6, A's
`is_first_turn` predicate accepts 3 and ignores 3; both yield 1 session,
2 model calls, 1 tool call). None is bundled under
`backend/mappings/` yet: the conversations semantics (thinking rows as calls;
result rows dropped) are a reviewer's choice for this excerpt, recorded here,
and belong to the source's own documentation before they ship as defaults
(#17).

## What this shows, and what it does not

- Two distinct models from two vendors completed the workflow on both tables
  through the UI with human corrections, and their saved mappings replay
  identically with no assistant. The models were right about the field set
  almost every time and wrong about three things repeatedly: addressing a
  Parquet timestamp wrapper by its object path, guessing an end time, and
  turning a presence test into a role predicate for tool rows. The application
  caught each (validation, preview rejects, the reducer's interval guard) and
  the corrections are small and recorded.
- Variance between identical requests was large (a missing `where`, bare
  column names, an object in `notes`): a proposal must be read, not trusted;
  `executable` is a contract statement only.
- The free tier is not a dependable substrate: one model retired, two were
  rate-limited or overloaded all evening, a small one was cut off twice.
- Not shown: correctness of the conversations semantics for the full dataset
  (the excerpt has 12 sessions), any hosted or local endpoint other than
  OpenRouter, and the field table or report entry point of #39.
