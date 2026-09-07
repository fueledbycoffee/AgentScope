# Plan: field profiler, redaction, `MappingAssistant` port and fake adapter (issue #13)

Revision 2, after the Codex review
(`2026-09-07-profiler-and-assistant-port-review-codex.md`, 12 findings, all
folded in; the numbers in brackets refer to them).

Day 3, first issue. Expected result (issue text): `ProfileFile` produces a
bounded field profile (types, null rates, examples, nesting) and a filtered
sample; the `MappingAssistant` port and a deterministic fake adapter exist;
the outgoing payload is visible before sending. ADR-005 fixes the port shape
and the configuration; this issue builds everything the adapter (#14) and the
assistant UI (#15) sit on, with no live provider call.

## 0. Prerequisite: the SWE-chat excerpt script [12]

`scripts/sample_swe_chat.py` converts the sessions table with `to_pylist()`,
which fails on `timestamp[ns, tz=UTC]` (Arrow refuses the lossy conversion to
`datetime`). Fix: keep selection on plain columns (`session_id`, `agent`,
counts) read as Python values, then write the selected sessions by filtering
the Arrow table with `pc.is_in` instead of rebuilding it from Python. Run it
once locally (`per_agent=1` and the default) and record the row counts in the
PR; the excerpt itself stays under gitignored `data/`. CI never needs it: all
Parquet tests build synthetic files with `tests/parquet_support.py`.

## 1. Field profiler (domain, stdlib only) [5] [6] [7]

`domain/profile.py`: `profile_records(records, *, limits) -> FieldProfile`, a
pure function over decoded records as the readers return them (JSONL objects
or Parquet rows with `_arrow` wrappers). It never imports a reader.

Observation units, defined once and used everywhere:

- `inspected`: records the profiler looked at (at most `limits.records`).
- Per path: `records` (inspected records in which the path yields at least
  one value, null included), `values` (values observed at the path across all
  records; array elements count one each), `nulls` (values that are JSON null
  or a wrapper whose `value` is null), `missing = inspected - records`.
  Rates in the report are `records / inspected` (coverage) and
  `nulls / values` (null rate); the denominators travel with the numbers.
- Types per value: `object`, `array`, `string`, `integer` (int, never bool),
  `number` (float or Decimal that is not integral), `boolean`, `null`, and
  the wrapper kinds `arrow:timestamp | duration | time | binary | float`. A
  wrapper is classified by its `_arrow` kind, not as `object`; its children
  are not profiled.
- Paths use the DSL grammar and are produced by `parse_path` round trips: a
  key that does not match `[A-Za-z_][A-Za-z0-9_-]*` (dots, spaces, digits
  first, non-ASCII) is not flattened into a path; it is listed under
  `unaddressable` with the parent path, the literal key and the reason. Array
  evidence is stored as `selector` + `relative` (`$.tools[*]` and `$.tool_name`)
  and displayed joined; a field path with `[*]` is only valid as a
  `timestamp_format` bounds path, and the report says so.
- Per path also: `distinct` (exact up to 50, then `">50"`), `examples` (up to
  5 distinct scalar values, chosen after redaction, shortest first, strings
  cut to 80 characters after redaction, never for containers), numeric
  `min/max` as exact values, string `min/max length`, array `min/max
  length`, and `hints` computed from values only: `iso8601`,
  `epoch_seconds`, `epoch_millis`, `uuid`, `identifier` (distinct ratio above
  0.9 and length under 64), `enum` (at most 12 distinct over at least 20
  values), `free_text` (median length above 120 with spaces).
- Limits (all reported under `truncated` with the count that hit them):
  `records` 2,000; `paths` 400; `depth` 8; `array_items` 200 inspected per
  array (length still measured exactly); `nodes` 200,000 visited values per
  profile; `key_length` 200 (longer keys are unaddressable); `distinct` 50
  per path. Traversal stops when `nodes` is exhausted and the profile says so.

## 2. Redaction (domain) [2] [4]

`domain/redaction.py`: `redact_text(text) -> (text, reasons)` and
`sanitize(value) -> (value, counts)` for any JSON value (recursive, keys kept,
wrappers kept). Applied to the **whole value before** example selection or
truncation, so a 500-character trace is `<text 500 chars>` and never an
80-character excerpt, and a token is recognised whole.

Rules, by value, in this precedence:

1. Private-key blocks (`-----BEGIN … PRIVATE KEY-----`) → `<private-key>`.
2. Known credential shapes → `<token>`: `sk-` / `sk-or-` / `sk-ant-` keys
   (20+ chars), GitHub `ghp_|gho_|ghu_|ghs_|ghr_|github_pat_`, Slack `xox[abp]-`,
   AWS `AKIA[0-9A-Z]{16}`, Google `AIza…`, JWTs (`eyJ` + two dot-separated
   base64url parts), `Bearer <token>`, `Authorization:`/`api[_-]?key=`
   assignments with their value.
3. URLs with userinfo → credentials replaced (`https://<credentials>@host/…`).
4. Emails → `<email>`.
5. Absolute paths (`/Users/x`, `/home/x`, `/root`, `C:\Users\x`, `~/…`) →
   `<path>`; relative repository paths (`src/app.py`) are kept.
6. IPv4 and IPv6 literals → `<ip>` (loopback and `0.0.0.0` kept).
7. Free text longer than 200 characters → `<text N chars>`.

No generic base64/hex-run rule: it collides with `call_…` tool ids, `round_…`
ids, session ids, UUIDs and sha256 digests in both datasets, which the
assistant needs intact to propose identities. Replacements keep the shape so
the model still sees the type. Key names are never redacted: they are the
structure the mapping addresses, and the profile says so in its
`redaction.policy` text. Counts are per reason and per outgoing document.
Redaction is exposure control, not anonymisation (ADR-005), and the docs say
that in the same words.

The same sanitizer runs over the complete outgoing context: profile examples,
sample records, the current mapping document (including `notes`), the user
message and the history, so nothing reaches the adapter unsanitised.

## 3. Prepared context: prepare and send are two operations [1] [2] [5] [8]

The client never sends free-form context to the assistant. Every assistant
call is a two-step: **prepare** freezes the exact outgoing context and returns
it with its digest; **send** re-prepares from the same inputs and refuses if
the digest differs.

- `AssistantRequest` (application DTO): `kind: propose | revise`,
  `upload_id`, `mapping_identity: {name, source}`, `include_sample: bool`
  (default false, ADR-005 "profiles first"), `current_mapping: dict | None`,
  `message: str | None`, `history: tuple[Turn, ...]` (roles limited to
  `user` and `assistant`; anything else is `invalid_input`).
- `PrepareContext.execute(request) -> PreparedContext`: loads the cached
  profile (computing it if needed), builds the sanitised document
  `{version, kind, upload: {filename, format, sha256, records}, identity,
  target: {dsl_schema_version, target_schema_version, entities}, profile,
  sample?, current_mapping?, message?, history?, redaction: {counts,
  policy}, truncated}`, serialises it with the exact JSON codec (sorted keys,
  no float rounding), and returns `PreparedContext(text, bytes, sha256,
  redactions, truncated, sample_included)`. Sample selection is
  deterministic: the first 20 inspected records that add an unseen path,
  in record order. A byte budget of 64 KiB applies to the serialised text:
  over budget, sample records are dropped from the end, then examples are
  reduced to 2 per path, then history turns are dropped oldest first; each
  step is recorded in `truncated`. The digest covers the final text, so what
  is previewed is what is sent, byte for byte.
- Digest inputs are therefore: upload bytes (via sha256), sample selection,
  identity, current mapping, message, history, profiler version, sanitizer
  version and context version. Any change re-prepares to a different digest.
- `RunAssistant.execute(request, context_sha256) -> AssistantOutcome`:
  re-prepares, compares digests (`409 stale_context` on mismatch, `400
  invalid_input` when `include_sample` is true without a digest), then calls
  the port. A server can prove the client fetched the exact text it sends,
  not that a human read it; the API doc says that too.
- What the preview is: the exact **data context** the model sees. The adapter
  (#14) adds only a fixed, versioned instruction preamble that contains no
  upload content, and must include `prepared.text` verbatim as the data
  message; its tests assert the request body contains the text byte for byte.
  The `prompt_version` is part of the context digest so a preamble change
  invalidates stale previews.

## 4. Port, failure model and the bounded repair [8] [9]

- Port (`application/ports.py`):

  ```python
  class MappingAssistant(Protocol):
      def complete(self, prepared: PreparedContext, *, repair: RepairRequest | None) -> AssistantReply: ...
  ```

  `AssistantReply(text, model, finish: "stop" | "length" | "refusal")`.
  Adapters raise `AssistantError(kind: unavailable | timeout | provider |
  malformed, message)` (application-owned, sanitised: no SDK exceptions, no
  headers, no keys). `RepairRequest(candidate_text, issues)` carries the
  previous candidate and its structured validation issues.
- The **application** owns parsing and repair. `RunAssistant` parses the
  reply as a JSON object `{mapping, explanations, ambiguities, questions}`,
  stamps `name`, `source`, `input_format`, `dsl_version` and
  `target_schema_version` from the request (the model cannot rename or
  retarget a mapping), runs `parse_mapping`, and on `finish == "length"`,
  malformed JSON or a non-executable document calls `complete` **once more**
  with a `RepairRequest`. At most two generation calls per user operation,
  enforced and tested by exact call counts. The second result is validated
  the same way and returned with its issues either way; refusal, timeout or
  provider errors are never turned into a mapping.
- `AssistantOutcome(proposal: MappingProposal | None, issues, attempts,
  diagnostics: {finish, model, raw_text (capped at 32 KiB), error})`.
  `MappingProposal(mapping, explanations: (target, path, why, confidence),
  ambiguities: (target, options, what_settles_it), questions, model,
  executable: bool)`.
- Executable means it passes the mapping contract, not that it succeeds on
  the records: the UI keeps `PreviewImport` as the next stage, and a test
  covers a parse-valid proposal whose identity path is absent on every
  record (preview rejects, proposal still returned).

## 5. Adapters and wiring [3] [12]

- `infrastructure/llm/fake.py`: `FakeMappingAssistant`, deterministic, keyed
  by the prepared profile's path set as produced by the production readers:
  - TraceLab shape → the bundled `tracelab-v1` document with explanations.
  - SWE-chat **sessions** shape (`session_id`, `agent`, `created_at` as
    `arrow:timestamp` ns UTC, token columns, `duration_seconds`) → a session
    draft mapping `created_at.iso` with `iso8601`, one ambiguity (per-session
    token totals have no `model_call` observation) and one question.
  - SWE-chat **conversations** shape (`turn_id`, `session_id`, `role`,
    `timestamp` as `arrow:timestamp` us UTC, `tool_name`, `tool_call_id`) →
    a model_call + tool_call draft using `timestamp.iso`, with the
    accounting semantics left visibly unresolved as an ambiguity.
  - A synthetic scalar-epoch shape (`ts` as a bare integer) → a draft with an
    epoch-unit ambiguity; `revise` with "treat ts as epoch seconds" resolves
    it. This is the only epoch case; the typed Arrow timestamps never get one.
  - Anything else → a session-only draft plus one question per unmapped
    required field.
  - Scripted behaviours for tests, selected by a field in the fake's
    constructor: reply `length`, `refusal`, malformed JSON, non-executable
    then valid, non-executable twice, raise `timeout`.
- `infrastructure/llm/unavailable.py`: `UnavailableMappingAssistant` raises
  `AssistantError("unavailable", "No assistant adapter for provider
  'openai_compatible' yet (#14)")`. The container wires it when the provider
  is not `fake`; every other service starts normally, so the default
  configuration keeps upload, saved-mapping replay and dashboards working.
  `AGENTSCOPE_LLM_PROVIDER=fake` selects the fake explicitly; production
  never substitutes it silently. Tests: startup with default settings, a
  spy adapter that fails on any call during preview and import.

## 6. Persistence [10] [11]

- Exact JSON codec moves inward: `domain/jsonx.py` (`dumps_exact`,
  `loads_exact`, `content_hash`), stdlib only; `infrastructure/jsonx.py` is
  removed and its importers updated. import-linter, Ruff and mypy stay as
  they are and run in the completion checks.
- `SaveMappingRevision` application use case (`MappingRepository`,
  `UnitOfWorkFactory`, `Clock`): validates the document (non-executable
  documents are refused with issues; replay needs executable revisions),
  stamps `revision = 1 + max(same name)`, `created_by` from the caller
  (`bundled` for the loader, `user` for the API), content-hash idempotent
  (the same document returns the existing record, no new revision).
  Revisions are immutable; imports keep their `mapping_id` bindings. The
  bundled loader calls this use case. Assistant provider/model metadata is
  audit-only and is not part of the saved document (the UI shows it on the
  proposal; a persisted provenance column is #17's concern and listed there).
- Migration `0004_upload_profile`: `uploads.profile` (JSON, nullable) and
  `uploads.profile_version` (int, nullable). `UploadRepository.get_profile /
  set_profile`. `ProfileFile` computes on first call, stores the sanitised
  profile with the profiler version, and recomputes when the version differs;
  it survives restarts. Existing rows are unaffected (nullable columns);
  downgrade drops them.
- Allowed writes, asserted by table row counts in tests: `ProfileFile` →
  `uploads.profile*` only; `PrepareContext` and `RunAssistant` → none;
  `SaveMappingRevision` → `mappings` only. Raw preview payloads are already
  stored unredacted on `uploads.preview` by the upload use case; this issue
  does not change that and the docs describe it accurately.

## 7. API (interfaces) [1] [11]

- `POST /api/uploads/{id}/profile` → `ProfileReport` (cached; `404` unknown
  upload).
- `POST /api/assistant/prepare` body `AssistantRequest` → `{context_sha256,
  bytes, payload_text, payload, redactions, truncated, sample_included}`.
- `POST /api/assistant/run` body `AssistantRequest + context_sha256` →
  `AssistantOutcome`; `409 stale_context`, `400 invalid_input`, `503
  assistant_unavailable`, `502 assistant_failed` (timeout, provider,
  malformed after repair), `200` with `proposal: null` for refusal or a
  still-invalid draft (diagnostics carry why).
- `POST /api/mappings` body `{document}` → `201` with the mapping summary,
  `200` when the content hash already exists, `400` with issues when not
  executable.
- All five routes, request and response schemas, error examples and the
  "what the digest proves" note go into `docs/api/v0.1.md`; the mapping
  README gains "How the assistant sees your file" (units, limits, redaction
  policy in ADR-005's words).

## 8. Tests

- Profiler: nested and array paths, wrappers (including null-valued
  timestamps), mixed present/missing/null elements, empty arrays, big
  integers, fractional decimals, unaddressable keys (dots, spaces, digits,
  Unicode), literal-dot versus nested collisions, every limit and its
  `truncated` entry, large array and wide object with assertions on visited
  nodes; TraceLab fixture snapshot (inspected 2,000 of 4,770, known paths,
  `timing_events[*].timestamp` hinted `iso8601`); Hypothesis over random JSON:
  never raises, every reported path parses, no example contains a redactable
  value, node limit respected.
- Redaction: each rule, precedence, shape preservation, counts; negatives
  from both sources (tool_call_id, round_id, session_id, UUID, model names,
  ISO timestamps, sha256); credentials crossing the 80-character boundary;
  secrets in mapping notes and history; instruction-like trace content stays
  text.
- Prepared context: profile-only default; sample without digest refused;
  another upload's digest refused; changed message or history refused; byte
  budget trimming order and reporting; digest equality between prepare and
  run using a recording adapter (byte for byte).
- Assistant run with the scripted fake: valid first; invalid then valid;
  invalid twice; refusal; length; malformed; timeout; exact call counts;
  identity stamping (non-default name/source honoured, model renaming
  ignored); parse-valid but preview-failing proposal.
- Persistence: migration upgrade on a populated database, cache survives a
  container rebuild, recompute on profiler version change, no-write
  assertions, save idempotence, invalid save, edited revision, bundled loader
  through the use case.
- API: all five routes through the error envelope; SWE-chat synthetic
  Parquet cases for both fakes; startup with the default provider.

## 9. Cost and order

1. Script fix, codec move, `SaveMappingRevision`, migration (0.15 day).
2. Profiler and redaction with tests (0.35 day).
3. DTOs, prepare/run use cases, port, fakes, unavailable adapter (0.3 day).
4. Routes, docs, e2e (0.2 day).

About one day. Out of scope: the compatible adapter (#14), the assistant UI
(#15), SWE-chat mapping correctness (#16), persisted conversations, a
provenance column (#17).

## 10. Revision 3: decisions after the second Codex pass

The second pass (`…-review-codex-2.md`, 18 findings, still BLOCK) is folded
into the implementation under the round-cap rule; these are the decisions.

- **Digest semantics (1, 13).** The digest is over the final outgoing text
  and nothing else: content equivalence, stated as such in the API doc. What
  the run acts on is only what the text contains, so the document carries
  `sample_included`, `sample_count`, the identity (`name`, `source`,
  validated as slugs so they are never redactable), the upload's
  `input_format`, and all versions (`context`, `profiler`, `sanitizer`,
  `prompt`) as fields. `context_sha256` is required for every run. The
  acknowledgement authorises one derived repair that adds only a sanitised,
  bounded (16 KiB candidate, 4 KiB issues) rendering of the model's own
  reply and the parser's issues, marked as data; no new raw evidence enters
  during repair, and the recording-adapter tests inspect both calls.
- **Sensitive keys (2).** A key whose text the redactor would change is
  withheld with its whole subtree and reported as `withheld: [{parent,
  reason}]` without the key; an unaddressable key is redacted and cut before
  it is reported. Executable paths are therefore never rewritten. Redaction
  counts: the cached profile keeps the counts of its own examples; the
  context builder trims first and sanitises the final document once, so the
  other counts describe exactly the retained content.
- **Budget (5).** Trim order: sample records from the end, examples to 2 per
  path, history oldest first (the `message` and the current mapping are never
  trimmed); if the text is still over 64 KiB the prepare fails with
  `413 context_too_large` and no port call happens. Request bounds live in
  the schemas: message 4,000 characters, 20 history turns of 4,000, current
  mapping 64 KiB. Sample records are projected before sanitising (depth 8,
  20 array items, 5,000 nodes per record) and the projection is reported.
- **Profile (7, 15).** Wrapper payload member per kind: timestamp `value`,
  duration/time `seconds`, binary `base64`, float `value`. Integral Decimals
  are `integer`. Distinct values are tracked exactly up to 5,000 for the
  identifier ratio and reported capped at 50; a saturated path gets no
  cardinality hint. Wrapper paths carry `wrapper: {kind, units, tz,
  accessors}` so an adapter knows to address `.iso` or `.seconds`, and the
  DSL reference sent with the context explains the wrappers.
- **Contract and stamping (8).** The document carries the resolved contract:
  upload format, DSL and target versions, entities with required fields, and
  a compact DSL reference text. `name`, `source` and `input_format` are the
  user's and are set on the reply from the request and the upload; versions
  are validated, never rewritten (a wrong version is a contract issue and
  goes to repair). Revise requires `current_mapping` to carry the requested
  identity, else `400 invalid_input`.
- **Transitions (9, 16).** `refusal` → terminal, no candidate. `length` →
  one repair; a candidate born from a `length` reply is never executable;
  `length` again → `502 assistant_failed {kind: truncated}`. Envelope
  failure (not an object with a `mapping` object) → one repair; again →
  `502 {kind: malformed}`. Non-executable mapping → one repair; again →
  `200` with the editable candidate, `executable: false` and its issues.
  Adapter `AssistantError` → terminal: `503 assistant_unavailable` or `502
  assistant_failed {kind}`. Stale digest → `409 stale_context`. Every
  non-2xx keeps the `{error: {code, message, details}}` envelope through
  `application/errors.py` subclasses and the ordered status map.
- **Port return type (14).** The port returns `AssistantReply(text, finish,
  model)`; envelope parsing, validation and the repair counter live in the
  application so both adapters share them. ADR-005 gets an amendment
  paragraph saying so.
- **Hash compatibility (17).** `content_hash` keeps the legacy canonical
  form byte for byte (a test pins the bundled document's stored id); the
  context digest uses the exact codec with sorted keys, a separate contract.
- **Save races (18).** The repository translates an integrity failure into
  `ConflictError`; the use case then re-reads by hash and returns the winner,
  or retries the revision allocation (bounded, five times, re-reading the
  revisions each time) before surfacing `409 conflict`.
