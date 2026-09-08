# Recorded chat-completions responses

Two kinds of files, told apart by their prefix:

- `synthetic_*.json`: hand-written bodies shaped like the named server's replies
  (OpenRouter, LM Studio's `/v1`, Ollama's `/v1`). They drive the adapter tests
  through `httpx2.MockTransport`; they are fixtures, not evidence, and prove
  nothing about a deployed server or model.
- `captured_*.json` + `.provenance.json`: real response bodies from a local run of
  `scripts/llm_smoke.py`, request, headers and credentials stripped; the sidecar
  says when, where, which model and prompt version, and what the reply was.

Statuses and headers are set in the tests themselves; connection failures and
timeouts are injected as exceptions. CI never calls a network and never reads a
real key (`tests/infrastructure/test_openai_compatible.py`).

Synthetic bodies added 2026-09-08 (from shapes seen live on OpenRouter):

- `synthetic_openrouter_400_structured_outputs.json`: OpenRouter's 400 whose own
  message is only "Provider returned error"; the upstream reason ("does not
  support feature: structured-outputs") is a JSON string under
  `error.metadata.raw`. Drives the JSON-mode fallback and the error wording.
- `synthetic_openrouter_length_reasoning.json`: a `length` cut with empty content
  and `usage.completion_tokens_details.reasoning_tokens` close to
  `completion_tokens` (a reasoning model spent the reply budget on thinking).

Captured 2026-09-08: `captured_openrouter_ling3_2026-09-08.json` (+ provenance),
`inclusionai/ling-3.0-flash-fin:free`, executable proposal with a 32,768-token
budget; the body keeps the model's `reasoning` text about the public fixture.

Synthetic contract regressions added for #51 (prompt v2):

- `synthetic_contract_native_key.json`: source column `session_id` in
  `native_key` instead of the mapped target `external_id`; validator code
  `native_key_unmapped` names the target-field rule.
- `synthetic_contract_notes.json`: object-valued `notes`; `invalid_type`
  explains that notes must be a string.
- `synthetic_contract_field_object.json`: a bare string mapping for
  `external_id`; `not_an_object` includes the object form to use.
- `synthetic_contract_ended_at.json`: the same row `$.timestamp` mapped to
  both `started_at` and `ended_at`. This is structurally valid: the parser
  cannot establish the source column's meaning and emits no issue. The
  regression explicitly tests that limitation and checks the timestamp rule
  in the prepared contract and an explicitly requested repair. It does not
  claim that this mistake triggers automatic repair.

Each body is hand-written, contains exactly one mistake, and uses synthetic
metadata. The first three exercise validation followed by a successful repair
through `RunAssistant` and `httpx2.MockTransport`. All four verify that the
repair instruction repeats the relevant contract rule. These are not live
model results; the coordinator runs the TraceLab smoke on the host.
