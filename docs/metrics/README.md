# Metric definitions and comparability

This reference covers the four values returned by
`GET /api/metrics/summary?source=&agent=` at repository freeze
`2a351e90bd67dc7fd51aa5a16b8cf27cbddb0dc2`. Model and period filters, cost,
latency, output-token and rate metrics are not part of this response.

## Source of truth

The `DEFINITIONS` map in
[`application/use_cases/queries.py`](../../backend/src/agentscope_app/application/use_cases/queries.py)
is the single source of metric wording. The API sends those strings with every
value, and the running [Definitions page](http://127.0.0.1:8000/definitions)
renders them from the summary response rather than keeping another UI copy.

These are the current strings, verbatim:

| API key | Definition |
| --- | --- |
| `sessions` | Distinct sessions in scope (reconciled by source and external_id). |
| `model_calls` | Recorded model-call observations in scope; one source row can be one observation. |
| `tool_calls` | Recorded tool-call observations in scope. |
| `input_tokens` | Sum of input_tokens over model calls that have a known value, in scope. Coverage is the number of calls with a known value over all calls in scope. Values are only comparable within one token_semantics tag; by_semantics splits the sum accordingly. |

The API reference shows the same strings as an example contract, but does not
own them. When wording changes in code, update the API example and this
reference in the same change.

## Metrics

| Name / API key | Population and formula | Unit | Scope | Missingness and coverage | Comparability | Drill target |
| --- | --- | --- | --- | --- | --- | --- |
| Sessions / `sessions` | `COUNT(sessions.id)` after scope filters. A session is one reconciled `(source, external_id)` row, not a raw record. | sessions | Optional exact `source` and `agent` filters. | Always a measured count, including zero; no coverage object. | Reconciliation is source-scoped. The same real-world activity imported under two sources is not deduplicated across them. | `/sessions` with the same query filters; then `/sessions/:id`. |
| Model calls / `model_calls` | `COUNT(model_calls.id)` joined through the filtered sessions. Each row is a recorded source observation with unique `(source, occurrence_key)`. | observations | Optional exact `source` and `agent` filters inherited from sessions. | Always a measured count, including zero; no coverage object. | An observation is not guaranteed to be a unique provider API invocation. Source mappings decide which rows emit model calls. | `/sessions` with the same filters; individual calls appear under `/sessions/:id`. There is no standalone model-call collection route. |
| Tool calls / `tool_calls` | `COUNT(tool_calls.id)` joined through the filtered sessions. Each row is a recorded source observation with unique `(source, occurrence_key)`. | observations | Optional exact `source` and `agent` filters inherited from sessions. | Always a measured count, including zero; no coverage object. | Source mappings decide which rows are calls; a result row must not be counted again as a call. A tool may have no parent model call. | `/sessions` with the same filters; individual tools appear under `/sessions/:id`. There is no standalone tool-call collection route. |
| Input tokens / `input_tokens` | `SUM(model_calls.input_tokens)` over non-null values after joining through filtered sessions. | tokens | Optional exact `source` and `agent` filters inherited from sessions. | `coverage.known` is calls with non-null input tokens; `coverage.total` is all model-call observations. `value` is `null` when `known` is zero; otherwise it can legitimately be zero. | Compare or add values only inside one `token_semantics` tag. `by_semantics` supplies a sum per tag and uses `unknown` when the stored tag is null. The top-level sum crosses tags and therefore is not automatically comparable. | `/sessions` with the same filters; session details expose call values and tags. There is no token-only drill route. |

## Missingness, zero and transport

`null` means the measure is unavailable. The UI renders it as **Unavailable**;
it must never substitute `0` or a dash. Zero means the population was measured
and the result really was zero. Coverage belongs beside the token value so a
partial sum cannot look complete.

The current metrics response serialises integer values as JSON numbers. The
committed TraceLab acceptance values are within JavaScript's safe-integer range,
but the contract does not yet provide a lossless text companion for larger
aggregates. Do not extend this surface to unsafe integers without adding one.
For source records, the shipped lossless path is already
`GET /api/raw-records`: the server returns `payload_text`, and the UI displays
that text rather than reserialising a potentially rounded browser value.

## Example shape

```json
{
  "sessions": {"value": 80, "definition": "Distinct sessions in scope (reconciled by source and external_id)."},
  "model_calls": {"value": 4770, "definition": "Recorded model-call observations in scope; one source row can be one observation."},
  "tool_calls": {"value": 5723, "definition": "Recorded tool-call observations in scope."},
  "input_tokens": {
    "value": 553447877,
    "definition": "Sum of input_tokens over model calls that have a known value, in scope. Coverage is the number of calls with a known value over all calls in scope. Values are only comparable within one token_semantics tag; by_semantics splits the sum accordingly.",
    "unit": "tokens",
    "coverage": {"known": 4770, "total": 4770},
    "by_semantics": {
      "tracelab-claude": 186454781,
      "tracelab-codex": 366993096
    }
  }
}
```
