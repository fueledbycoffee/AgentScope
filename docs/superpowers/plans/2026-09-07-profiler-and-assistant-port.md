# Plan: field profiler, redaction, `MappingAssistant` port and fake adapter (issue #13)

Day 3, first issue. Expected result (issue text): `ProfileFile` produces a
bounded field profile (types, null rates, examples, nesting) and a filtered
sample; the `MappingAssistant` port and a deterministic fake adapter exist;
the outgoing payload is visible before sending. ADR-005 fixes the port shape
and the configuration; this issue builds everything the adapter (#14) and the
assistant UI (#15) sit on, with no live provider call.

## 1. Field profiler (domain, stdlib only)

`domain/profile.py`: `profile_records(records: Iterable[Mapping], *, limits)
-> FieldProfile`, a pure function over decoded records (JSONL objects or the
Parquet reader's converted rows, wrappers included).

- One `FieldStat` per path, paths written in the DSL's own grammar
  (`$.usage.prompt_tokens`, `$.turns[*].role`), so a proposal can copy them
  verbatim. Nested objects recurse; arrays profile their elements under `[*]`
  and record `min/max length`.
- Per path: `present` (records where the key exists), `null`, `types` (JSON
  type histogram: object, array, string, integer, number, boolean, null,
  plus the reader wrappers by their `_arrow` kind), `distinct` (exact up to
  a cap, then "> cap"), `examples` (up to 5 distinct values, shortest first,
  strings truncated to 80 characters, never a redacted value), numeric
  `min/max`, string `min/max length`, and `looks_like` hints computed from
  values, not names: ISO-8601 timestamp, epoch seconds / milliseconds
  (magnitude bands), UUID, identifier-like (high distinct ratio, short), enum
  (few distinct values with many records), free text (long strings with
  spaces).
- Limits: at most 2,000 records, 400 paths, depth 8; over a limit the profile
  says which limit stopped it (`truncated: {records, paths, depth}`) rather
  than silently dropping.

## 2. Redaction (domain)

`domain/redaction.py`: `redact(value) -> (value, reasons)` and
`redact_record(record) -> (record, counts)`, applied to every profile example
and to the outgoing sample (ADR-005: filtering applies to strings in profiles
too), never to the stored file. The profile stored on the upload row is the
redacted one; the unredacted values exist only in the raw file. Rules, by value not by key:
emails, bearer tokens and key-looking strings (`sk-…`, `ghp_…`, long
base64/hex runs), URLs with credentials, absolute file paths and home
directories (`/Users/…`, `/home/…`, `C:\…`), IPv4/IPv6, and free text longer
than 200 characters (replaced by `<text 1,234 chars>`). Replacements keep the
shape (`<email>`, `<token>`, `<path>`) so the model still sees the type. Key
names are never redacted (they are what the mapping needs). Each redaction
counts by reason so the UI can say what left and what did not.

## 3. Port, DTOs and use cases (application)

- `MappingAssistant` port (ADR-005): `propose(context) -> MappingProposal`
  and `revise(context, message) -> MappingProposal`.
- `AssistantContext`: `profile: FieldProfile`, `sample: tuple[dict, ...]`
  (redacted, at most 20 records, chosen to cover every path at least once
  where possible), `target_schema` (the DSL target schema as data),
  `input_format`, `current_mapping: dict | None`, `history: tuple[Turn, ...]`.
- `MappingProposal`: `mapping: dict` (a DSL v1 document), `explanations:
  tuple[FieldExplanation, ...]` (target field, source path, why, confidence
  0 to 1), `ambiguities: tuple[Ambiguity, ...]` (target field, options, what
  would settle it), `questions: tuple[str, ...]`, `model: str`, `raw_text:
  str` (what the provider returned, for the diagnostics drawer).
- Use cases: `ProfileFile(upload_id) -> ProfileReport` (profile + redacted
  sample + redaction counts + the exact outgoing payload as the adapter would
  send it, serialised with `dumps_exact`); `ProposeMapping(upload_id,
  source, name, include_sample)` and `ReviseMapping(upload_id, mapping,
  message, history, include_sample)`: build the context, call the port, then
  run `parse_mapping` on the returned document. ADR-005 sends **profiles
  first**: `include_sample` defaults to false and the API only accepts true
  after the outgoing payload has been fetched for that upload (the report
  carries a `payload_sha256`; the propose request must echo it), so sample
  values never leave the server unseen; if it is not executable the use case asks the port for **one**
  repair with the issues attached (ADR-005's bounded repair) and returns the
  proposal with its issues either way. Nothing is persisted by these use
  cases: saving is `SaveMappingRevision(document, name, source)` (already
  exists as the bundled loader's path; exposed as a use case), and importing
  is the existing commit.
- Trace text is data, never instructions: the context carries records under a
  `data` key and the adapter (#14) frames them as such; the port contract
  states it so both adapters honour it.
- The profile is computed from the stored upload (same reader, same limits)
  and cached on the upload row (`uploads.profile` JSON) so the UI does not
  recompute it on every visit.

## 4. Fake adapter (infrastructure)

`infrastructure/llm/fake.py`: `FakeMappingAssistant` returning fixture
proposals keyed by the profile's path set: a TraceLab-shaped profile gets the
bundled `tracelab-v1` document with explanations; a SWE-chat-shaped profile
(the excerpt's columns) gets a hand-written `swe-chat-v1` draft with two
ambiguities (`created_at` epoch unit, per-conversation usage) and one
question; anything else gets a minimal session-only mapping plus a question
per unmapped required field. `revise` applies a small set of deterministic
edits (`treat created_at as epoch seconds`, `map tool name to …`) and
otherwise echoes. Selected by `AGENTSCOPE_LLM_PROVIDER=fake`; CI uses it
only. `openai_compatible` is #14 and, until it lands, the container refuses
to start with a clear message if that provider is selected without an
adapter.

## 5. API (interfaces)

- `POST /api/uploads/{id}/profile` → `ProfileReport` (idempotent; cached).
- `GET /api/uploads/{id}/outgoing` → `{"payload": …, "payload_text": …,
  "redactions": {reason: n}, "bytes": n}`: exactly what would be sent.
- `POST /api/assistant/propose` `{upload_id, source, name}` →
  `MappingProposal` + `issues`; `POST /api/assistant/revise` `{upload_id,
  mapping, message, history}` → the same shape.
- `POST /api/mappings` `{document}` → saves a revision (name and source from
  the document; content-hash idempotent like the bundled loader).
- Contract additions documented in `docs/api/v0.1.md`; the mapping README
  gains a "How the assistant sees your file" section.

## 6. Tests

- Profiler: nested and array paths, wrappers, limits and `truncated`
  reporting, `looks_like` hints on synthetic and fixture data (the TraceLab
  fixture's profile is snapshot-checked: 4,770 records capped to 2,000,
  known paths, `timing_events[*].timestamp` as ISO timestamp), Hypothesis
  over random JSON documents (never raises, every path is a valid DSL path,
  examples never contain a redactable value).
- Redaction: each rule, shape preservation, counts, no false positive on the
  fixture's ids and model names.
- Use cases with the fake adapter: propose on the fixture yields an
  executable mapping; a non-executable fake response triggers one repair and
  returns issues; revise applies an edit; nothing is written to the database;
  the outgoing payload equals the redacted context.
- API e2e for the four endpoints; a saved revision appears in `/mappings`.

## 7. Cost and order

1. Profiler and redaction with tests (0.4 day).
2. Port, DTOs, use cases, fake adapter, tests (0.4 day).
3. Endpoints, contract, docs (0.2 day).

About one day. Out of scope: the real adapter (#14), the assistant UI (#15),
the SWE-chat mapping's correctness (#16), persisted conversations.
