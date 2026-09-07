# Mapping DSL v1

A mapping is a JSON document that tells AgentScope how to read one source
format into its target schema (sessions, model calls, tool calls). The mapping
is data, not code: the import engine interprets it with a closed set of
operations, so a mapping proposed by an LLM or edited by a user can never run
anything. Decisions behind the design are in
[ADR-004](../adr/ADR-004-mapping-dsl-v1.md); the machine-readable contract is
[`mapping-dsl-v1.schema.json`](../../backend/src/agentscope_app/domain/mapping/mapping-dsl-v1.schema.json);
the worked example is [`backend/mappings/tracelab-v1.json`](../../backend/mappings/tracelab-v1.json).

## Document

```json
{
  "dsl_version": 1,
  "target_schema_version": 1,
  "name": "tracelab-v1",
  "source": "tracelab",
  "input_format": "jsonl",
  "rules": [
    {
      "id": "model_call",
      "entity": "model_call",
      "select": "$",
      "where": [{"path": "$.role", "op": "eq", "value": "assistant"}],
      "native_key": ["external_id"],
      "fields": {
        "session_external_id": {"path": "$.session_id"},
        "external_id": {"path": "$.trace_key"},
        "started_at": {"path": "$.timing_events[*].timestamp", "timestamp_format": "iso8601", "bounds": "min"},
        "input_tokens": {"paths": ["$.usage.input", "$.input_tokens"], "on_missing": "null"}
      }
    },
    {
      "id": "tool_call",
      "entity": "tool_call",
      "select": "$.tools[*]",
      "parent": "model_call",
      "fields": {
        "tool_name": {"path": "$.tool_name", "on_missing": "reject"},
        "wall_latency_ms": {"path": "$.latency", "unit": {"from": "s", "to": "ms"}}
      }
    }
  ],
  "unmapped": [{"path": "$.round_id", "reason": "not unique upstream"}],
  "notes": "free text for maintainers"
}
```

The stored mapping record (logical id, revision, parent revision, content
hash, who proposed it) lives around this document in the database; the
document itself carries only what the engine needs.

## Target schema

| Entity | Field | Type | Unit | Required | Meaning |
| --- | --- | --- | --- | --- | --- |
| session | external_id | string | | yes | Native session identifier in the source |
| session | agent | string | | | Harness or agent label (claude-code, codex, ...) |
| session | repo | string | | | Repository or project label |
| session | user | string | | | Pseudonymous user identifier |
| session | started_at, ended_at | timestamp | | | Bounds declared by the source; observed bounds are computed by the reducer |
| model_call | session_external_id | string | | yes | Session the call belongs to |
| model_call | external_id | string | | | Claimed native identifier |
| model_call | sequence | integer | | | Order inside the session |
| model_call | provider, model | string | | | Labels as given by the source |
| model_call | token_semantics | string | | | Accounting-semantics tag for the token fields (what the source counts); `unknown` when unvalidated. Token values are only comparable within one tag |
| model_call | started_at, ended_at | timestamp | | | First and last timestamp of the invocation |
| model_call | input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, reasoning_tokens | integer | tokens | | Token counts; null when the source has none |
| model_call | is_error | boolean | | | Marked failed by the source |
| model_call | error_message | string | | | Error text |
| tool_call | session_external_id | string | | yes* | *Optional when the rule declares a `parent`; then copied from it |
| tool_call | external_id | string | | | Claimed native identifier |
| tool_call | sequence | integer | | | Order as given by the source |
| tool_call | tool_name | string | | yes | Tool name |
| tool_call | started_at, ended_at | timestamp | | | Emitted and result timestamps |
| tool_call | wall_latency_ms | integer | ms | | Wall-clock latency observed in the trace |
| tool_call | internal_latency_ms | integer | ms | | Runner-reported latency, kept separate |
| tool_call | is_error | boolean | | | Tool call failed |
| tool_call | exit_code | integer | | | Process exit code |
| tool_call | status | string | | | Status label |

Sessions are derived: every rule with `entity: session` contributes to the
session named by `external_id`, and the reducer merges contributions (first
non-null value wins, later different values are reported as conflicts) and
computes `observed_start_at` / `observed_end_at` from the children.

Session identity is scoped by source (one mapping, one source namespace) and
by whatever the mapping puts into `external_id`. If a source reuses session
ids across harnesses, the mapping must make the id harness-specific (TraceLab
already prefixes ids with `claude:` / `codex:`); the reducer cannot do it,
because model calls and tool calls carry no harness field. Two session
contributions with the same id but a different `agent` are kept as one session
with a `conflicting_value` diagnostic so the collision stays visible.

## Paths

Grammar: `("$" | "@root") ("." name | "[" n "]" | "[*]")*`, at most 16 segments.

- `$` is the current item: the root record for a rule whose `select` is `$`,
  or one element of the selected array otherwise.
- `@root` is always the root record, useful to read the session id from a
  nested tool.
- `[n]` indexes lists (negative indexes count from the end); `[*]` fans out and
  is allowed only in `select`.
- A missing key or out-of-range index yields *absent*, never an error.

## Rules

| Key | Meaning |
| --- | --- |
| `id` | Unique name of the rule, matching `[A-Za-z_][A-Za-z0-9_-]*`; it becomes the emission path prefix in provenance (`tool_call[3]`), which is why brackets are not allowed |
| `entity` | `session`, `model_call` or `tool_call` |
| `select` | Path of the items the rule emits from; default `$` |
| `where` | Conditions, all of which must hold: `{path, op, value}` with `op` in `eq`, `ne`, `in`, `not_in`, `exists`, `not_exists` |
| `parent` | Only on `tool_call` rules: id of a `model_call` rule declared earlier whose `select` is `$`; the tool links to that call and inherits its session. A tool that maps a different session than its parent is rejected (`conflicting_relationship`) |
| `native_key` | Fields whose values form the claimed native identity, kept as an ordered tuple of parts (never joined into one string); defaults to `["external_id"]` when mapped |
| `fields` | Target field → field mapping |

## Field mappings

| Option | Default | Meaning |
| --- | --- | --- |
| `path` / `paths` / `literal` | one required | Single path, ordered coalesce (first present wins), or constant |
| `transforms` | `[]` | Ordered allowlist: `trim`, `lower`, `upper`, `json_decode`, `{"enum_map": {"mapping": {...}, "unmapped": "keep" \| "null" \| "reject"}}` |
| `type` | schema type | Optional; must equal the target schema type |
| `timestamp_format` | `iso8601` | `iso8601`, `epoch_s` or `epoch_ms`; timestamp fields only. Naive ISO values are taken as UTC |
| `unit` | none | `{"from": "s", "to": "ms"}`; only for `ms` fields, `to` must be `ms`; units `ns`, `us`, `ms`, `s`, `min`. Conversion happens before type coercion and never rounds: a result that is not a whole millisecond is invalid |
| `empty_as_missing` | `false` | Treat an empty string as missing |
| `on_missing` | `null` | `null` (store null, warn), `default` (use `default`), `reject` (reject the whole emission) |
| `default` | | Required when `on_missing` is `default`. A default is written in canonical terms: it skips `transforms` and `unit` (those describe the source encoding) but is still coerced to the target type; a timestamp default is always ISO-8601 whatever the source `timestamp_format`. Measurement fields (tokens, milliseconds) accept only a `null` default: a number would turn a missing value into a measured one |
| `on_invalid` | `reject` | What to do when a transform or conversion fails: `null` (store null, warn) or `reject` |
| `bounds` | none | `min` or `max`: timestamp fields only, with a `path` containing `[*]`; takes the earliest or latest of the selected timestamps (null entries ignored). This is the only extraction over a nested collection the DSL allows, because event arrays are not guaranteed to be chronological |

Conversions are strict: booleans never become numbers, `12.5` never becomes
an integer, unknown enum values are not silently kept unless the mapping says
so. Negative token or latency values are rejected. Duration arithmetic is done
in exact decimals (numeric strings are parsed as decimals, never through a
binary float), so `1.001 s` is `1001 ms`; a value that cannot be converted
exactly, overflows or underflows is `invalid_value` (`precision_loss`), and
converted durations beyond 10^19 target units are `out_of_range`. A `literal` of `null` counts as a
missing value and follows `on_missing`.

## Validation stages

1. **Schema**: the JSON Schema checks shapes, enums and path syntax.
2. **Semantic**: `parse_mapping` checks target entities and fields, type and
   unit compatibility, parent references, native keys, required fields, and
   that every `unmapped` entry has a reason. It reports every problem with a
   location (`rules[1].fields.model`), a code and an explanation; unknown keys
   are warnings, everything else is an error.
3. **Preview**: `apply_mapping` runs on a bounded sample without persisting
   anything and shows emissions, rejects and warnings.
4. **Import**: the same interpreter runs on every record; preview success does
   not certify unseen records.

A draft may carry errors so it can be discussed and corrected; only an
executable mapping (no errors) can be previewed or imported.

## Codes

Warnings (value stored as null, emission kept): `absent`, `null`, `empty`,
`invalid_value` (with `on_invalid: null`), `parent_unavailable`.

Rejects (emission dropped, explained): `missing_value` (`on_missing: reject`),
`invalid_value` (including `precision_loss` and `out_of_range` conversions),
`missing_required`, `missing_relationship`, `conflicting_relationship`,
`negative_measure`, `reversed_interval` (ended_at before started_at),
`selector_limit`, `predicate_too_deep`, `internal_error`.

Reducer diagnostics: `conflicting_value`, `implicit_session`.

## Parquet values

Parquet rows reach the DSL as JSON-typed objects keyed by column name, converted
from the Arrow schema without loss (`infrastructure/readers/parquet.py`).
Locators are `row:N`, zero-based over the whole file. Values that JSON cannot
carry directly are wrapped in objects with an `_arrow` kind and plain member
names, so ordinary paths reach them:

| Arrow type | Payload |
|---|---|
| integers (incl. uint64), bool, string, decimal128/256 | native; decimals stay `Decimal` |
| float | finite: shortest round-trip decimal; NaN / ±Inf: `{"_arrow": "float", "value": "NaN"}` — a non-numeric value, so the field's `on_invalid` policy applies |
| binary | `{"_arrow": "binary", "base64": "…"}` |
| timestamp | `{"_arrow": "timestamp", "iso": "2026-06-01T12:00:00.000000000Z", "unit": "ns", "tz": "UTC", "value": 1748779200000000000}`; `iso` keeps the unit's full precision; years outside 0001 to 9999 render with their full digits (ISO parsers refuse them, so the field follows `on_invalid`); naive timestamps have no `Z` |
| date | `"YYYY-MM-DD"` |
| duration | `{"_arrow": "duration", "seconds": 1.500, "unit": "ms"}` — exact decimal seconds |
| time of day | `{"_arrow": "time", "seconds": 45296.5, "unit": "us"}` |
| list, struct | `list`, `dict`; a null struct is `null`, `[]` and `[null]` stay distinct |
| map | `[{"key": k, "value": v}, …]`, order and duplicate keys preserved |
| UUID / JSON extension | canonical UUID string / the JSON text |

A null value in a wrapped column keeps the wrapper with null members, so
`$.latency.seconds` reports `null`, not `absent`. Durations are always decimal
seconds whatever unit the file used, so a mapping converts with a static unit:

```json
"wall_latency_ms": {"path": "$.latency.seconds", "unit": {"from": "s", "to": "ms"}},
"started_at": {"path": "$.ts.iso", "timestamp_format": "iso8601"}
```

Mapping a `time` wrapper to a duration is a modelling mistake the DSL cannot
detect; the `_arrow` kind is there to make it visible in previews. Timestamps
with more than microsecond precision parse with a `precision_reduced` warning
(the canonical value is microsecond); timestamps without a zone parse as UTC
with a `naive_timestamp` warning. Refused files: duplicate column names at any
level, a struct field named `_arrow`, unsupported extension types, more than 64
columns or nesting deeper than 8, a footer row count above 100,000, or more
than 256 MiB of decoded data.

## How the assistant sees your file

The mapping assistant (ADR-005) never reads the file. It reads a **field
profile**: for every path the DSL can address, how many of the inspected
records have it (`records`, `missing`), how many values were observed and how
many were null (`values`, `nulls`; array elements count one each, so a null
rate is `nulls / values` and coverage is `records / inspected`), the JSON
types seen, the number of distinct values (exact up to 50), up to five short
examples, exact minimum and maximum, string and array lengths, and hints
computed from the values themselves (`iso8601`, `epoch_seconds`,
`epoch_millis`, `uuid`, `identifier`, `enum`, `free_text`). Parquet wrappers
are reported by kind with their observed units and time zones and the
accessors that address their payload (`$.created_at.iso`, `$.latency.seconds`).
Keys the grammar cannot address (dots, spaces, leading digits, non-ASCII) are
listed as unaddressable rather than flattened into a path that would point at
a different value.

Limits, all reported when they apply: 2,000 records inspected, 400 paths,
depth 8, 200 elements per array (lengths stay exact), 200,000 visited values,
keys up to 200 characters. Sample records, when you choose to send them, are
at most 20, chosen to cover every path, and projected to depth 8 and 20 array
items.

Everything that leaves the server goes through the redactor first, examples
included, before anything is cut short: private-key blocks, known credential
shapes (OpenAI/OpenRouter/Anthropic keys, GitHub, Slack, AWS and Google
tokens, JWTs, `Bearer …`, `api_key=…` assignments), URL user info, e-mail
addresses, home-directory paths, IP addresses, and any text longer than 200
characters, each replaced by a placeholder that keeps the shape (`<email>`,
`<token>`, `<path>`, `<text 1,234 chars>`). Keys are never rewritten: a key
that would be redacted is withheld together with its subtree and reported as
such. Identifiers, UUIDs and digests are kept on purpose: a mapping needs them
intact, and a generic "long random string" rule would destroy `call_…` and
`round_…` ids. This is exposure control, not anonymisation: it removes the
well-known shapes of secrets and personal locators; an opaque secret with no
recognisable shape is not detected, and nothing here claims that what remains
identifies nobody.

The exact text that would be sent, and its digest, is shown by
`POST /api/assistant/prepare` before any model is called; the run refuses a
digest that no longer matches. See `docs/api/v0.1.md`.

## What the DSL cannot do, on purpose

No expressions, regular expressions, arithmetic, joins across records, grouping
or aggregation, recursion, or code of any kind. Sessions bounds and every
dashboard number are computed by the application from the emitted entities.
Sources that need more than this are reported as partially supported, with the
unmapped paths and rejects explaining what was left out.
