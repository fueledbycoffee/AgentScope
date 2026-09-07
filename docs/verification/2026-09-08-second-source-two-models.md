# Second source through the UI, two model configurations (issue #16)

Status: **in progress** (runs on the evening of 2026-09-07, continued 2026-09-08).
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
| Tested commit | *(filled at the end)* |

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
| A-conversations | A | conversations | off | | | `--replace "$.timestamp"→"$.timestamp.iso"` if needed | | | | |
| B-sessions | B | sessions | off | | | | | | | |
| B-conversations | B | conversations | off | | | | | | | |

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

## Replay without the assistant

*(filled after the runs: pre-import snapshot restored, backend started with
`AGENTSCOPE_LLM_PROVIDER=none`, control call answers 503, import through the
Import page with the saved revision, identical counts, zero assistant
requests)*

The API regression test `backend/tests/verification/test_replay_without_assistant.py`
replays every reviewed final document under `backend/tests/verification/documents/`
against synthetic SWE-shaped Parquet with a recording assistant that raises on
any call.

## Acceptance matrix

| | Config A | Config B |
| --- | --- | --- |
| sessions: live proposal | yes | yes (pre-check) |
| sessions: human-assisted completion | **yes**, zero manual edits (run A-sessions-3; the two earlier runs show the model's variance: wrapper path, then a wrong `ended_at`) | |
| conversations: live proposal | yes (draft) | |
| conversations: human-assisted completion | | |
| replay passed | yes (sessions; UI replay and API regression test) | |

Coverage: sessions **partial** (token and tool aggregates unmapped by design);
conversations **partial** (no provider field; token semantics unknown; latency
and status fields absent from the source).
