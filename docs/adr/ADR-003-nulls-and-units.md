# ADR-003: Missingness, canonical units and metric coverage

## Status

Accepted — 2026-09-07.

## Context

Trace sources report different measurements under superficially similar names.
Unavailable token counts and durations cannot be treated as zero without
misleading totals and comparisons. Parsing errors must remain distinguishable
from a source deliberately reporting no value.

The [verified dataset notes](../datasets/README.md#schema-caveats-and-redistribution-review)
confirm all three TraceLab `claude_*` accounting fields are null on all 216,823
Codex rows. They also show `session_file` absent everywhere, `project` absent
on Codex rows and tool `input` omitted from the fixture. Verified release data
wins over planning examples or database columns: do not fabricate those fields.

## Decision

Distinguish four source states in profiles and execution diagnostics:

| State | Example | Interpretation |
| --- | --- | --- |
| Absent key | `{}` when reading `tokens` | The source did not supply the field. |
| Explicit null | `{"tokens": null}` | The field exists without a value. |
| Empty string | `{"tokens": ""}` | A present textual value, not implicitly null or zero. |
| Failed conversion | `{"tokens": "many"}` parsed as integer | A supplied value violates the declared conversion. |

A mapping declares per-field `on_missing: null | default | reject` (default
`null`; `default` needs a `default` value), `on_invalid: null | reject` (default
`reject`), and `empty_as_missing: bool` (default `false`). `required` belongs to
the target schema, not the mapping: `session.external_id`,
`model_call.session_external_id`, `tool_call.tool_name`, and
`tool_call.session_external_id` unless a parent is declared.
Preserve source-state distinctions in diagnostics (warning codes `absent`,
`null`, `empty`, `invalid_value`) and raw provenance even when the canonical
result is null. An explicit default is not permission to invent a missing
measurement. **Missing is never zero.**

Use these canonical representations:

- Timestamps: UTC instants, with source timezone or epoch unit declared by the
  mapping; do not silently use the importing machine's timezone.
- Durations and latencies: integer milliseconds with explicit source and target
  units; invalid or unrepresentable conversions produce diagnostics rather than
  silent truncation. Reject negative elapsed measurements.
- Tokens: non-negative integers or null; reject negative and fractional token
  values rather than rounding them into apparently valid usage.

Carry a token-accounting semantics tag per source through its mapping to the
observations. Distinguish harness-specific semantics within a source when
needed. The tag describes what is counted; a shared unit alone does not establish
comparability. Unvalidated semantics remain explicitly unknown.

Keep different measurements separate:

| TraceLab source measurement | Canonical treatment |
| --- | --- |
| `tools[].tool_wall_latency_ms` | Tool `wall_latency_ms`, already milliseconds. |
| `tools[].tool_internal_latency_ms` | Separate tool `internal_latency_ms`; never a fallback for wall latency. |
| `input_tokens_total` | Input total under the source's declared accounting semantics. |
| `prefix_tokens` / `newly_append_tokens` | Preserve separately in source evidence; do not relabel as cache/output or sum into input without a validated accounting definition. |
| `claude_*` accounting fields | Map only their documented meanings; Codex nulls remain unavailable. |

The [committed TraceLab fixture](../../fixtures/tracelab/tracelab-sample.jsonl.gz)
contains `output_tokens` and `reasoning_output_tokens`. This verified field
presence overrides the earlier Claude plan's claim that no `output_tokens`
field exists; presence alone does not validate accounting semantics.
Do not infer output tokens from newly appended tokens. Fields without a supported
canonical equivalent remain in raw provenance with an explained unmapped path.
SWE-chat session and conversation token columns have unvalidated accounting and
reconciliation semantics; do not combine them as interchangeable call usage.

Report **coverage next to every metric**: the contributing population and total
eligible population under the same filters, with missing or invalid contributors
explained. For token totals, show known-value calls over eligible calls. If none
have known usage, display **Unavailable**, not zero; measured zero remains valid.
Unknown timestamps must be visible rather than silently disappearing from
time-based summaries. Separate incompatible accounting groups in comparisons.

## Consequences

Canonical storage stays simple while provenance and diagnostics retain why a
value is missing. Metrics require explicit denominator, unit, scope, null rules
and comparability definitions; the domain owns these definitions, not chart code.

Coverage makes partial evidence visible. Some attractive totals remain unavailable
until the source's measurement semantics are validated, which is preferable to
publishing a precise-looking value with an invented meaning.

## Alternatives considered

- Coerce absent, null and empty values to zero: confuses lack of evidence with measured zero.
- Keep only canonical null without diagnostics: loses the difference between missing data and failed conversion.
- Treat all token or latency columns as interchangeable: shared units do not imply shared semantics.
- Let charts decide conversions and coverage: produces inconsistent definitions across views.
