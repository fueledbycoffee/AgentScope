# Plan: second source through the UI and two-model verification report (issue #16)

Day 3, last issue; feature freeze at its end. Expected result (issue text):
SWE-chat is imported through a mapping created in the UI; the same workflow is
completed with two distinct model configurations; the report under
`docs/verification/` records models, endpoints, proposals, corrections and
outcomes without secrets; saved mappings replay with the provider disabled.

## 0. What already exists

- The SWE-chat excerpt (`scripts/sample_swe_chat.py`, gitignored
  `data/samples/swe-chat-1/`: 12 sessions, 518 conversation rows, two
  Parquet files).
- The assistant (#13, #14, #15): profile → prepare → run through the UI
  (`/import/assist/:uploadId`), the compatible adapter, `scripts/llm_smoke.py`.
- Live evidence (ADR-005 log): `dots-studio/dots-3-note-preview:free`
  produced an executable TraceLab proposal; `liquid/lfm-2.5-2.6b:free`
  completed the workflow with an editable draft. Both are OpenRouter free
  models from distinct vendors.

## 1. Two configurations

| | Config A | Config B |
| --- | --- | --- |
| Endpoint | OpenRouter `https://openrouter.ai/api/v1` | OpenRouter (same endpoint; distinct vendor) or a local server if one is running on the machine at run time (LM Studio `http://localhost:1234/v1` or Ollama `http://localhost:11434/v1`) |
| Model | `dots-studio/dots-3-note-preview:free` | `liquid/lfm-2.5-2.6b:free` (fallback: another free model that answers that day; the report names what was tried and what answered) |
| JSON mode | `auto` | `auto` (the report records whether the negotiation fell back) |

ADR-005 asks for two distinct models completing the workflow; "completing"
means profile → prepare → run → a returned proposal (executable or an editable
draft) → validate → save → preview → import, with the corrections a person
made in between recorded. A model whose reply needed manual corrections still
completes the workflow; the report says exactly what was corrected.

## 2. Procedure (scripted where possible, reproducible from the report)

1. **Files**: `data/samples/swe-chat-1/sessions.parquet` and
   `conversations.parquet` (manifest digest recorded).
2. **Per config**, per file, through the UI with the browser (Playwright
   script `scripts/verify_second_source.mjs`, not a CI test: it needs the
   live provider and the local excerpt):
   upload → "Draft a mapping with the assistant" → identity
   (`swe-chat-sessions-v1` / `swe-chat-conversations-v1`, source `swe-chat`)
   → sample off first, then on for one run → payload drawer (digest and byte
   count recorded) → send "Propose a mapping for this file" → outcome
   (model, attempts, adapter notes, executable, issue codes, ambiguities,
   questions recorded) → up to two revision messages if needed (recorded
   verbatim) → manual edits in the editor (recorded as a diff) → validate →
   save (mapping id, revision) → preview (counts, rejects) → import (report
   id, committed counts).
3. **Replay**: restart the backend with `AGENTSCOPE_LLM_PROVIDER=fake`, upload
   the same files, import them with the saved revisions from step 2 (the
   Import page, not the assistant), and record that the outcomes are
   identical (same record counts, same entity counts) and that no assistant
   request was made (request log). A pytest under `backend/tests/` does the
   same over the API with the synthetic SWE-shaped Parquet fixtures and the
   saved documents committed as fixtures under `backend/tests/verification/`.
4. **Report** `docs/verification/2026-09-08-second-source-two-models.md`:
   environment (commit, date, endpoint hosts, model ids, JSON mode, timeouts,
   never a key), per run a table (file, config, digest, bytes, sample on/off,
   attempts, finish, executable, issue codes, corrections, revision id,
   preview counts, import counts), the two saved mapping documents (as
   committed under `backend/mappings/swe-chat-*.json` only if they are
   reviewed and executable; otherwise under `docs/verification/` as
   evidence), what each model got right and wrong, and the replay result.
   Redaction counts from the prepare responses are quoted; no payload text
   is pasted (its digest is).

## 3. Product changes allowed today (small, in service of the run)

- `scripts/verify_second_source.mjs` (Playwright, local only) and
  `scripts/llm_smoke.py --file` runs for a quick per-model check before the
  UI pass.
- If the SWE-chat mapping needs a DSL feature the interpreter lacks, the
  limit is recorded and the field left unmapped with a reason; no DSL change
  on freeze day.
- Bugs found in #15's page during the run are fixed only if they block the
  run; otherwise filed.

## 4. Freeze

At the end: tag `v0.1.0-rc1` on main, board items for day 3 Done, day-4
issues (#17 rehearsal, #18 docs, #19 observations and release) ready with
what the report learned appended to #17.

## 5. Cost

Half a day: 0.15 scripting, 0.2 runs and corrections (free models are slow and
sometimes unavailable; the report says so), 0.15 report and replay test.
