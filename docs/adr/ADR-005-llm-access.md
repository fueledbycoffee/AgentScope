# ADR-005: Provider-neutral mapping assistance

## Status

Accepted — 2026-09-07.

## Context

The import assistant proposes and revises mappings from source evidence and
user feedback. Hosted and local models need to support the same review flow,
while credentials and unfiltered traces stay out of the browser/provider path.
Provider output is fallible and must not control persistence or domain rules.

The owner's decision in the
[consolidated plan](../planning/2026-09-07-consolidated-plan.md#d2-llm-adapters-chat-completions-compatible-adapter-first-plus-fake-decided-by-the-owner-on-2026-09-07)
selects the compatible adapter first, superseding earlier plans that made an
Anthropic-native adapter a release gate. Configuration names already exist in
[`.env.example`](../../.env.example).

## Decision

Define a single **`MappingAssistant` port in the application layer**. It accepts
sanitised context: field profile, bounded filtered sample when needed, current
mapping and user message. It returns an application-owned `MappingProposal`
containing mapping JSON, explanations, ambiguities and questions. Vendor response
types and SDKs stay inside infrastructure adapters.

Implement an OpenAI-compatible **chat-completions** adapter first. Configure
provider access only through these backend environment variables:

| Variable | Role |
| --- | --- |
| `AGENTSCOPE_LLM_PROVIDER` | Adapter selection: `openai_compatible` or `fake` initially. |
| `AGENTSCOPE_LLM_BASE_URL` | Endpoint root; no hard-coded provider URL in application logic. |
| `AGENTSCOPE_LLM_MODEL` | Model identifier as understood by the chosen endpoint. |
| `AGENTSCOPE_LLM_API_KEY` | Server-side credential; empty for local servers requiring no key. |

The selected targets for documented testing are OpenRouter (primary), LM Studio
and Ollama. Endpoint examples are `https://openrouter.ai/api/v1`,
`http://localhost:1234/v1` and `http://localhost:11434/v1`, respectively.
The owner uses an OpenRouter free-model identifier, set through
`AGENTSCOPE_LLM_MODEL` (`minimax/minimax-m3:free` at decision time; since
2026-09-08 `inclusionai/ling-3.0-flash-fin:free`, which `.env.example` now
names as an example, not a mandatory or hard-coded choice). The free-model
choice is configuration intent, not a guarantee of future pricing or
availability.

Advertise configurations as **tested** only with recorded live evidence; accepting
this ADR does not certify all compatible endpoints or models. Release evidence
must record two distinct models completing the workflow, either hosted/local or
two OpenRouter models from different vendors. CI never calls a provider and
never holds credentials: it runs the fake adapter and the compatible adapter
over recorded or synthetic transports only (`backend/tests/llm_recordings/`).

The adapter owns authentication, endpoints, structured-output negotiation and
refusal, truncation, timeout and malformed-response handling. Use
`response_format` for structured output where supported; otherwise request
prompt-constrained JSON. Always validate on the server through the mapping
contract stages in [ADR-004](ADR-004-mapping-dsl-v1.md). On a validation failure,
allow **one bounded repair attempt**, then return diagnostics to the user. Do
not treat partial, refused or invalid output as an executable mapping.

Send **profiles first**. Include bounded, filtered samples only after visible
redaction: show the outgoing sanitised context before sending sample content.
Filtering applies to strings in profiles as well as sample values. Treat trace
text as **data, never instructions**; embedded requests cannot override the
assistant's task, validation or user approval flow. Redaction is an explicit
exposure-control step, not a claim of comprehensive anonymisation.

Keys remain in backend configuration and never reach the browser, frontend
bundle or returned proposal. The assistant cannot write canonical records or
execute generated code. The user reviews, corrects, validates and previews a
proposal before approving import. Saved mappings replay without any LLM call;
provider/model/prompt metadata remains audit-only.

An Anthropic-native adapter is a stretch example of **add a provider = add an
adapter**. It implements the same application port; no changes to the domain,
mapping semantics or UI workflow should be required.

## Consequences

One adapter can exercise multiple hosted and local configurations, reducing
initial integration work. Compatibility still varies by endpoint and model,
so live evidence complements deterministic fake-based CI tests.

Server-side validation and bounded repair keep failures explainable. Mapping
execution stays deterministic and available independently of provider access.

## Alternatives considered

- Anthropic-native adapter as a release gate: adds initial scope against the owner's compatible-first choice.
- Vendor SDK types in application/domain code: couples business behavior to a provider and violates layering.
- Browser-held keys or direct provider calls: exposes credentials and bypasses server-side controls.
- Trust structured output or retry indefinitely: neither establishes mapping correctness nor bounds failure cost.

## Amendment (2026-09-07, issue #13): where the response envelope is parsed

The port stays a single application-owned contract, but its return value is
`AssistantReply(text, finish, model)` rather than a fully parsed
`MappingProposal`. Parsing the `{mapping, explanations, ambiguities,
questions}` envelope, validating the mapping through the ADR-004 stages and
counting the single bounded repair attempt all live in the application
(`RunAssistant`), so the fake adapter and the OpenAI-compatible adapter share
one parser and one repair policy instead of each carrying its own. Adapters
still own transport, the fixed instruction preamble and the mapping of vendor
failures to `AssistantError(kind)`. Vendor types never cross the port. The
prepared context is frozen and digested before any call; the repair call adds
only a sanitised, bounded rendering of the model's own reply and the
validation issues, treated as data.

## Tested configurations (evidence log)

Only recorded live runs count (`scripts/llm_smoke.py`; see
`docs/llm/configuration.md` for the full table):

- 2026-09-07, OpenRouter, `dots-studio/dots-3-note-preview:free`: profile-only
  context of the TraceLab fixture. First adapter build: 113 s, two generation
  calls, editable non-executable draft (reply captured as
  `backend/tests/llm_recordings/captured_openrouter_dots3_2026-09-07.json`).
  Final adapter: 78 s, two generation calls, executable proposal with session,
  model_call and tool_call rules, 26 explanations, 5 ambiguities, 4 questions.
- 2026-09-07, OpenRouter, `liquid/lfm-2.5-2.6b:free` (Liquid AI, a second
  vendor): same context, 38 s, two generation calls, editable non-executable
  draft (`native_key_unmapped`, `no_fields`). Two distinct vendors have thus
  completed the workflow; only one produced an executable proposal so far.
- 2026-09-08, OpenRouter, `inclusionai/ling-3.0-flash-fin:free` (inclusionAI, a
  third vendor; the owner's choice from this date): same context. With the
  default 8,192-token budget the reply was cut off twice with no content
  (7,913 tokens of hidden reasoning); with `AGENTSCOPE_LLM_MAX_TOKENS=32768`
  and a 240 s deadline, 75 s, two generation calls, executable proposal with
  session, model_call and tool_call rules (reply captured as
  `backend/tests/llm_recordings/captured_openrouter_ling3_2026-09-08.json`).
  The provider rejects `response_format` through a relayed error the adapter
  had not recognised; fixed the same day. Two vendors have now produced
  executable proposals.
- The owner's earlier choice `minimax/minimax-m3:free` left OpenRouter's free
  tier on or before 2026-09-07 (404 "unavailable for free"); a paid slug
  exists but was not used.
- LM Studio and Ollama: adapter paths covered by synthetic fixtures; live
  evidence pending. The two-distinct-model release evidence is issue #16.
