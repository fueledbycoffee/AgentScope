# Unseen-structure rehearsal (D4-01, issue #17)

Status: complete (2026-09-08). Gate: the reserved Trace Commons native file
imports wholly or partially through the UI with explained limitations;
unsupported records and unsafe proposals are explained, not silently dropped.

## The file

Reserved unseen since 2026-09-07 (`docs/datasets/README.md`): Trace Commons
`sessions/claude_code/07b57159-218e-4330-a64e-0ec4b4355056.jsonl`, revision
`112ebd4d…`, 1,556,737 bytes, SHA-256 `f0f3711c…`, re-downloaded at the pinned
revision and hash-checked before use; gitignored under `data/reserved/`. Nobody
on the project had opened it before run R1. Claude Code's native session log:
one JSON object per line, 682 records, mixed record kinds under `$.type`,
nested `message`, `toolUseResult` and `attachment` objects.

Runs use the verification harness (`web/e2e/verify-second-source.mjs`, one
isolated backend per run under `data/verification/runs/<run>/`) with the
owner's configuration: OpenRouter, `inclusionai/ling-3.0-flash-fin:free`,
reply budget 32,768 tokens, deadline 240 s, JSON mode auto.

## Runs

| Run | What happened | Outcome |
| --- | --- | --- |
| R1-reserved-cold | Upload and profile fine (682 records, **234 fields**). `POST /api/assistant/prepare` answered **413 context_too_large**: 88,621 bytes after the three trimming stages against a fixed 64 KiB budget; the field list alone did not fit and no stage could reduce it. The page showed the sizes and nothing else. | Blocker found. Fixed the same day as D3-01b (#47, PR #48): examples removed, then nested fields omitted deepest and rarest first with the count per parent path in the document; `AGENTSCOPE_LLM_CONTEXT_BYTES` configurable. |
| R1 (harness) | Two harness defects: the fuzzy label lookup for "Source" matched the evidence rail's example buttons (`$.promptSource`, `$.attachment.source_uuid`), and the notice watcher looked only at the last notice, which was the unsent-draft panel, so it waited 600 s on a 413 that was on screen. | Fixed in PR #48. |
| R2-reserved-cold | With the fix: context 63,128 bytes, `truncated: {examples_reduced, examples_removed, fields_omitted: 67}`, 58 long-text and 3 path redactions. Reply in 86 s over two calls (JSON mode negotiated off). Draft with three rules on the right columns: session (`$.sessionId`, agent `$.entrypoint`, user `$.userType`, repo `$.cwd`), model_call where `$.message.model exists` with the four usage counters and `token_semantics: unknown`, tool_call where `$.toolUseResult exists` with latency and exit code from the attachment. Five questions and seven ambiguities, all pertinent (enum values of `$.type`, role discrimination, whether `toolUseResult.type` is a tool name, the single timestamp, what `userType` is). Not executable: six issues of one kind, the native key's source column copied in as an extra target field (`sessionId`, `messageId`, `uuid`) and named in `native_key` instead of `external_id`; plus `tool_call.ended_at ← $.timestamp` (the interval fabrication seen on SWE-chat too). | Editable draft; corrections recorded in R3. |
| R3-reserved-corrected (×2) | Same run with the reviewer corrections scripted in the editor (`--delete-field` × 4, `native_key` → `external_id` on every rule, notes). Ling answered **`assistant_failed` on both runs** (the first `malformed` twice; the second a 502 after one run request): no draft to correct. Both runs also exposed harness defects on the no-draft path: the first tried to apply corrections to an empty editor and crashed; the second skipped them but then clicked a disabled Validate and timed out (fixed: a run that ends without a draft records the notice and stops). | Owner decision: switch model for the rehearsal. |
| R4-reserved-dots3 | `dots-studio/dots-3-note-preview:free`, same file, same scripted corrections. Context 63,174 bytes, 67 fields omitted. **Executable draft in two calls, zero issues**: dots-3 did not make the native-key mistake, so only two corrections applied (`tool_call.ended_at` removed, notes). Saved as `trace-commons-claude-code-v1` revision 1; preview 125 accepted / 75 ignored of 200 sampled, 0 rejected, 158 `absent` warnings; **import committed: 440 of 682 records accepted, 0 rejected, 242 ignored** (rows matching no rule: progress, attachment and summary records). One session, model calls and tool calls on the dashboard. | **Gate met**: partial import through the UI with the limits explained (ignored rows are counted, not dropped silently). One defect left in the imported revision: `session.ended_at ← $.timestamp` and `model_call.ended_at ← $.timestamp` (the first session shows `ended_at == started_at`); R5 removes every `ended_at`. |
| R5-reserved-dots3-corrected (×2) | R4 plus `--delete-field` on `session.ended_at` and `model_call.ended_at`. First attempt: dots-3 wrote every field mapping as a bare string (`"external_id": "$.sessionId"`), twenty `not_an_object` issues the built-in repair did not fix; no import. Second attempt: draft with one issue (`invalid_type` on `notes`, an object where a string belongs), a session rule without predicate; corrections applied: `session.ended_at` removed, notes replaced; **executable, saved as revision 1, preview 181 accepted / 19 ignored of 200, import committed: 633 of 682 records accepted, 0 rejected, 49 ignored**. No `ended_at` anywhere in the imported revision. | Gate met a second time, with no fabricated interval left. |

## Findings so far

0. **Model choice matters more than prompt tuning on an unseen file.** Ling
   (the owner's default) answered on one of four runs; dots-3 answered
   executable on the first. Both had the same context (67 fields omitted).
   For the rehearsal the owner switched to dots-3; the configuration guide
   should say that a reasoning free model is a poor default for the first
   contact with a new structure (follow-up on `docs/llm/configuration.md`).

1. **Wide native files exceed the assistant context.** 234 fields against a
   64 KiB budget. The trimming order had no field stage; now the deepest and
   rarest fields go first and the document says how many per parent path.
   Whether the omitted 67 are the ones that matter is the open question for
   the follow-up (a field picker, filed if R3 shows a mapping that needs one).
2. **Native keys.** Both models seen so far (Ling here, dots-3 and nemotron on
   SWE-chat) tend to name the source column in `native_key`; the DSL wants
   the target field name (`external_id`). The validator catches it
   (`unknown_field`, `native_key_unmapped`), the fix is mechanical, and the
   contract text could say it once more.
3. **One timestamp is not an interval.** Third dataset in a row where a model
   copies the row timestamp into `ended_at`. Recorded as a rule for the
   reviewer checklist; the domain could refuse `started_at` and `ended_at`
   from the same path (follow-up).
4. **The page tells the truth on 413 but not the way out.** The message now
   names the omitted and kept counts and the configurable budget.

## What this shows, and what it does not

- An unseen native structure (Claude Code's session log, 234 fields) goes
  from upload to a committed import through the UI with a model draft and
  a handful of recorded reviewer corrections, twice, with two different
  drafts (440 and 633 of 682 records; the difference is the session rule's
  predicate). Ignored rows are counted and named, never dropped silently.
- The limits are explained where they arise: 67 fields omitted from the
  context and counted per parent; `absent` warnings per field; ignored rows
  in the report; the 413 that no longer happens says what to do when it does.
- Not shown: that the omitted 67 fields did not matter (the drafts never
  asked for them); that the model-call and tool-call semantics are right for
  this format (`$.toolUseResult` rows as tool calls, `$.message.model` rows as
  model calls: a reviewer's reading of one file, recorded in the notes, not
  validated against the source's documentation).
- Model behaviour, five runs: Ling answered usable JSON once in four tries
  on this file; dots-3 answered executable-after-corrections twice in three.
  Neither wrote `native_key` and `ended_at` right without a reviewer.

## Follow-ups filed

- D3-01c: the assistant contract text should say three things every model
  got wrong at least once: `native_key` names target fields, one timestamp
  per row is a start and never an end, `notes` is a string.

## Failure paths (task 2)

Exercised over the HTTP API on an isolated backend (fresh database, the
compatible provider pointed at a closed port), 2026-09-08:

| Path | Input | Outcome |
| --- | --- | --- |
| Oversize file | valid JSONL of 26 MiB | `413 limit_exceeded`, "File exceeds 26214400 bytes (25 MiB)"; nothing stored |
| Malformed lines | gzip JSONL: three good rows, `{not json`, an empty line, `[1,2]` | upload `201` with the per-line preview naming the error and its line; preview `200`: 3 accepted, 2 rejected (`invalid_json` at `line:2` "Expecting property name…", `line:5` "not a JSON object"), the empty line skipped; the good rows import |
| Invalid mapping | unknown entity `sessionz`, bare path | validate `200` with `issues[0].path = rules[0].entity`, `unknown_entity`, the allowed names listed, `executable: false`; save `400 invalid_input` with the same issue as details |
| Provider outage | endpoint at a closed port | prepare `200` (needs no provider); run `503 assistant_unavailable` in under a second: "Could not reach the assistant endpoint at 127.0.0.1 (ConnectError); check AGENTSCOPE_LLM_BASE_URL"; `/api/health` stays `ok` |

Nothing is dropped silently on any of the four paths; every refusal names
the limit, the line, the path or the variable.
