# Plan: second source through the UI and two-model verification report (issue #16), revision 2

Revision 2 after the Codex review (`…-review-codex.md`, 10 findings, 7 P1).
Day 3's last issue; the freeze is declared at its end whatever the state of
the evidence, and the evidence gates are stated so the report cannot claim
more than the runs show.

Expected result (issue text): SWE-chat is imported through a mapping created
in the UI; the same workflow is completed with two distinct model
configurations; the report under `docs/verification/` records models,
endpoints, proposals, corrections and outcomes without secrets; saved
mappings replay with the provider disabled.

## 0. Definitions [3]

- **Model outcome** (per run): `executable` (first or after the one repair,
  recorded which), `draft` (non-executable with issues), `refusal`,
  `error` (transport, timeout, truncated twice).
- **Human-assisted completion** (per configuration, per table): a live
  proposal was returned; every revision message and manual edit is recorded
  with its base and target document hashes; the final executable document was
  saved through the UI; a preview was reviewed; a fresh import committed with
  zero duplicate records and the expected emissions; the offline replay
  passed. Replacing most of a draft by hand is recorded as such and counts as
  human-assisted, not as model success.
- **Source coverage** (per table): `supported`, `partial` (fields left
  unmapped with reasons), `blocked` (a DSL limit prevents the table's
  meaning from being represented; recorded, not worked around).
- Old TraceLab smoke results, fake runs, refusals and transport errors are
  adapter evidence, never evidence for this issue.

## 1. Source audit before any mapping is trusted [4]

Aggregate-only, local, printed into the report (no row values):
role × turn_type × is_continuation distribution of the conversations table;
distinct-ness of `turn_id`, `session_id`, `tool_call_id`; per-session count
of `role=assistant` rows versus the sessions table's `api_call_count`;
tool_use / tool_result pairing and how many tool_result rows carry a
`tool_name`; nulls per column; timestamp wrapper units and time zones. From
that: explicit inclusion predicates (which rows are model calls, which are
tool calls, what is excluded and why). The two tables get two mappings bound
to their files, sharing `session_id` and the source so the reducer merges
them; session token totals and declared call counts are never turned into
synthetic model calls; `token_semantics` stays `unknown` unless the audit
justifies a tag. Already known from the excerpt (2026-09-07): `tool_use` rows
carry `tool_name`, `tool_result` rows mostly do not; `assistant` rows include
`assistant_thinking` turns; `metadata` rows exist.

## 2. Configurations and substitution policy [9]

| | Config A | Config B |
| --- | --- | --- |
| Endpoint | OpenRouter `https://openrouter.ai/api/v1` | OpenRouter |
| Model | `dots-studio/dots-3-note-preview:free` (dots-studio) | `nvidia/nemotron-3-super-120b-a12b:free` (NVIDIA); first candidate `liquid/lfm-2.5-2.6b:free` (Liquid AI) was truncated twice on both tables and is recorded as a failed substitution |
| JSON mode | `auto` | `auto` |
| Timeout / max tokens | 180 s / 8192 | 180 s / 8192 |

Pre-checks (profile only, `scripts/llm_smoke.py`, no sample) on 2026-09-07:
A: sessions executable in one call (38 s); conversations draft after the
repair (141 s; `not_an_object`, `required_field_unmapped`). B candidate 1
(Liquid): truncated twice on both tables (87 s, 53 s). B candidate 2
(NVIDIA): sessions executable in one call (131 s); conversations pending.
`google/gemma-4-26b-a4b-it:free` was rate-limited upstream (429) every time
it was tried. Substitutions are bounded: at most three
candidates per slot, each recorded (id, vendor, outcome); the two final
models must be from different vendors; no paid model without the owner's
decision; a local model counts only if it is actually different weights and
runs the same UI procedure. If a slot ends with no model completing the
procedure, the report says so and the issue stays open into day 4 with the
evidence gathered.

## 3. Isolation and replay [1] [2]

- Each configuration gets its own temporary database and raw store
  (`AGENTSCOPE_DATABASE_URL`, `AGENTSCOPE_RAW_FILE_DIR` under a run directory),
  the same input bytes, the same source `swe-chat`. Nothing is shared with
  the review server or another run.
- Per configuration: upload both files → assistant → save both revisions →
  **snapshot the database and raw store before importing** → import → report
  committed counts.
- **Replay**: a copy of the pre-import snapshot, backend restarted with
  `AGENTSCOPE_LLM_PROVIDER=none` (routed to the unavailable adapter; a
  `503` on a deliberate assistant call proves the routing), empty key; import
  through the Import page with the saved revisions; assert `status=committed`,
  zero duplicates, identical record and entity counts to the live run,
  identical document hashes across the restart, zero assistant requests in
  the browser log. The API regression test (`backend/tests/verification/`)
  injects a recording assistant that raises on any call and asserts zero
  calls while importing synthetic SWE-shaped Parquet with the final documents.

## 4. Artifacts and export policy [5] [7]

Run ids `A-sessions`, `A-conversations`, `B-…`, one artifact directory per run
under a gitignored local root. Committed (after manual inspection and the
redactor scan): the report; sanitised proposal envelopes (mapping, issues,
explanations, ambiguities, questions; no payload text); revision messages;
manual diffs with base/target hashes; final documents; the request log as
method/path/status counters only; provenance (commit, date, endpoint host,
model ids configured and reported, vendor, JSON-mode fallback, attempts,
adapter notes, context/prompt/profiler/sanitizer versions, digests, byte
counts, redaction counts). Never committed: SWE-chat Parquet or rows,
prepared samples, databases, `.env`, headers, unreviewed response bodies,
Playwright traces, videos, screenshots, HARs (the live harness runs with
`trace: 'off'` and writes to the local root). Identical documents are
deduplicated by hash with all run bindings kept. The saved mappings are
committed under `backend/mappings/` only if the audit and the runs make them
reviewed and executable; otherwise they live under `docs/verification/` as
evidence.

## 5. Reproduction inputs [6]

Dataset revision and upstream hashes from `data/samples/swe-chat-1/manifest.json`
(the exact sampling command with `--per-agent 1 --out-dir data/samples/swe-chat-1`,
seed, caps, output hashes, rows: expected 12 / 518, verified at run time);
tool versions (uv lock, pnpm lock, Playwright version); exact build and
launch commands with working directories; fresh backend process per
configuration and for the replay (the JSON-mode fallback is per process);
which proposal (profile-only or sample-on) advanced to revision and save;
the comparison rule: `entities.session` counts emitted observations, distinct
sessions are read from `/api/sessions?source=swe-chat`.

## 6. Harness

`scripts/verify_second_source.mjs` (Playwright, local only): takes the run
id, config env, files, identity; drives the UI exactly as a person would;
writes the artifact directory; never a CI test. `scripts/llm_smoke.py --file`
stays the profile-only pre-check (it calls the provider immediately; it is
never used with a sample).

## 7. Report

`docs/verification/2026-09-08-second-source-two-models.md`: environment,
source audit, per-run tables (run id, file, config, digest, bytes, sample,
attempts, finish, model outcome, issue codes, corrections, revision id and
hash, preview counts, import counts, replay result), the acceptance matrix
(§0) per configuration and table, coverage per table, what each model got
right and wrong, blockers carried to #17.

## 8. Freeze and tag [10]

Feature freeze is declared at the end of day 3 regardless. The tag
`v0.1.0-rc1` is created only when: PR #40 and this issue's changes are on
main; the tested application commit equals main's tree; backend, web and
browser checks and the offline replay pass; the report and fixtures are
merged. The tag names that commit; an existing tag is never moved. Board
items are marked Done only when complete; blockers go to #17 with links.

## 9. Cost

The half-day estimate does not hold with the isolation, audit, replay and
export requirements: one day. Tonight: plan, pre-checks, audit script; day 4
morning: runs, replay, report, tag.
