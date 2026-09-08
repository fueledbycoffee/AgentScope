# Metric definitions and query layer

`domain/metrics.py` owns the immutable definition data, aggregation vocabulary, coverage
interpretation and accounting comparability. `application/metric_queries.py` owns typed
scope, specification, aggregate rows and response assembly. `TraceQuery` lives alongside
other ports in `application/ports.py`; SQLAlchemy and SQLite stay in infrastructure.

## Canonical fields and views

Each view has one row per stored canonical entity. Child views join only their owning
session. `session.source` is authoritative for source filters across all grains; ingestion
tests assert child sources agree. View tables use private SQLAlchemy metadata, never
`Base.metadata`. All timestamp columns bind through `UtcDateTime`, including comparisons
with offset-aware bounds. UTC day grouping is SQLite `date(started_at)` and returns an ISO
date string or null. Day drills use timezone-aware UTC midnight and next midnight,
intersected with any existing partial-day range. Before adding a day, the assembler
checks the representable limit: `9999-12-31` ends inclusively at `datetime.max` via
`started_through`, while `0001-01-01` starts at `datetime.min` without subtracting a day.
SQL applies `<=` to inclusive bounds and `<` to exclusive bounds; both can constrain a
drill, including a single-instant interval. UTC normalization rejects out-of-range
bounds with a typed input error. Inclusive bounds are also preserved in sibling witnesses
(`witness_started_through`) and cleared from the current grain for missing-time exclusions.

| Grain | Canonical field | View column |
| --- | --- | --- |
| model_call | input_tokens | metric_model_calls_v1.input_tokens |
| model_call | output_tokens | metric_model_calls_v1.output_tokens |
| model_call | cache_read_tokens | metric_model_calls_v1.cache_read_tokens |
| model_call | cache_creation_tokens | metric_model_calls_v1.cache_creation_tokens |
| model_call | reasoning_tokens | metric_model_calls_v1.reasoning_tokens |
| tool_call | wall_latency_ms | metric_tool_calls_v1.wall_latency_ms |
| tool_call | internal_latency_ms | metric_tool_calls_v1.internal_latency_ms |
| tool_call | exit_code | metric_tool_calls_v1.exit_code |

The registry's projected-measure allowlist is validated against `TARGET_SCHEMA` for
integer type and canonical unit. `exit_code` has count units. The allowlist is narrower
than the mapping schema: session declared `started_at`/`ended_at` are unresolvable metric
measures, and are never aliased to observed bounds. Identity/provenance columns
`id`, `session_id`, `import_id`, `source`, session `agent`, and derived `linked`/`started_day`
are storage dimensions, validated separately from mapping targets. Adding a count/sum
definition over these projected measures requires registry data only; new primitives or
fields require an explicit extension.

## Counting and exactness

Filters run before aggregation. Cross-grain predicates use correlated `EXISTS`, so
sibling tools, model calls and provenance contributions cannot multiply measures.
Equal-valued calls remain separate observations; `SUM(DISTINCT value)` is never a repair.
Import counts use the union of distinct contributing import IDs, not audit report totals.
Session-only scopes include session contributions; child-filtered scopes include eligible
child observations. Duplicate attempts with no contributions count zero. An explicit
activity grain limits the child populations used for imports-in-scope.

SQLite's `exact_int_sum` accumulates Python integers and returns decimal text; the adapter
converts it back to an exact Python integer across the port. The engine factory registers
it on every SQLite connection and rejects other dialects. An external unregistered
connection fails loudly with `no such function`; there is no float/native SUM fallback.
Individual stored values retain SQLite's existing signed-integer storage limit.

Coverage is known contributors / eligible rows, independently for every measure and
partition. Zero is known; all-null sums are unavailable. Empty counts are zero with 0/0
coverage, whose ratio is undefined. Per-session counts and input tokens are batched in
three grouped queries using the same scope and definitions as the summary.

## Accounting and #11 handoff

Null and empty accounting tags normalize to `unknown` before grouping. Empty accounting
is explicitly unvalidated: this is a metric-specific exception to the general rule that
an empty string is a present value. Storage and ingestion can retain empty tags. Session
detail preserves the raw tag for provenance; it can therefore differ from a metric's
normalized partition label.

Only one known, non-unknown accounting tag permits a comparable canonical token total.
All-null foreign partitions affect coverage but not comparability. Mixed or unknown
contributing accounting has a null canonical total and exact per-partition values.
Legacy numeric `value` and known-only `by_semantics` remain for compatibility;
`recorded_sum_text` exposes their exact but unvalidated sum. Use `value_text` and
`semantics_partitions` for new displays.

The default TraceLab input-token KPI has mixed accounting. Show the exact partition
values and reason for mixed/unknown contributing usage. Reserve `Unavailable` for no
known usage; do not collapse mixed/full-coverage and absent-usage states into one label.

| Overview indicator | Registry/query recipe |
| --- | --- |
| Sessions and imports | sessions; imports_in_scope with the same scope |
| Model calls, tool calls | model_calls; tool_calls |
| Input/output and cache detail | input_tokens; output_tokens; cache_read_tokens; cache_creation_tokens; reasoning_tokens |
| Activity by day | model_calls grouped by started_day |
| Input tokens by model | input_tokens grouped by model; render semantics_partitions |
| Tool calls by tool | tool_calls grouped by tool_name |
| Latencies | tool_wall_latency_ms; tool_internal_latency_ms, separately in ms |
| Missing usage | missing_usage (null input_tokens), drill with usage_missing |
| Unknown timestamps | unknown_timestamps (null model started_at), without a date bound |
| Unlinked tools | unlinked_tools, drill with tool_is_unlinked; linked dimension supports both buckets |
| Rejects | Existing import report/reject-summary API; pre-canonical rejects have no fabricated session drill |

Query responses carry effective scope and each bucket/partition's drill scope. Drills
include all eligible rows, including null-measure coverage rows. Day drills carry an
explicit witness-time override, preserving the original time bounds/missing-time predicate
for other-grain sibling witnesses while narrowing the activity grain to the bucket day.
Without it, a model-day drill under an existing tool filter could silently lose sessions
whose tool happened on a different day. #11 must forward `witness_time_override`,
`witness_started_from`, `witness_started_before`, `witness_started_through`,
`witness_timestamp_missing`, and `witness_required` from the
returned scope. All child queries normalize their activity grain before population predicates are applied.
A switch retains the previous grain as a required sibling witness, even without model/tool
label filters; `witness_required` records that requirement in the returned scope.
This includes `unknown_timestamps` and every overall, bucket and accounting-partition scope.
Ordinary filters retain the same-row time rule for all required witnesses.
An independent original-population oracle and an HTTP round-trip test guard this case.
Null labels are distinct from literal `unknown` labels. The session-ID port paginates deterministically by ID;
`session_metrics(scope)` accepts richer scope for #11's session-list wiring. This issue
keeps existing summary/session HTTP filters at source/agent; #11 owns richer wiring and
all Overview/definitions UI changes.

## Phase 3 mathematical primitives and local prices

The existing views already project every field needed by the owner decisions. No ingestion
adapter, mapping, canonical schema or migration changes are needed. The query compiler now
supports generic observed-span, distribution and cost operations in addition to count/sum;
it does not dispatch on metric IDs. New definitions over these supported operations remain
registry data. Diagnostic definitions are explicitly non-executable.

`exact_int_samples` retains original known integer samples per SQL group, including zero,
and returns JSON for the typed port. Application assembly merges samples across buckets;
`domain/distributions.py` computes nearest-rank p90 and exact averaged even-n medians.
Memory is proportional to selected distribution observations. Observed spans read eligible
sessions' imported bounds, use integer microseconds internally, and sum exact fractions
of milliseconds. The port permits integers and exact rational values; `domain/numbers.py`
serializes terminating decimals without relying on floating point or Decimal context
precision. Cost products likewise remain exact. Legacy summaries still accept integers only.

`domain/pricing.py` owns explicit billing rules and the immutable price schedule vocabulary.
`infrastructure/prices.py` loads the pinned, user-owned local JSON schedule only when needed;
`SqlAlchemyTraceQuery` also accepts an injected `PriceSchedule` for offline tests. Cost
queries stream eligible model-call usage through the same scope predicates and merge per
accounting group; they never join sibling facts. Aggregate rows carry schedule version,
priced/total token counts and ordinary known/total row counts. A missing schedule yields
unavailable cost and zero priced coverage with a reason, without any runtime network call.
The standalone fetch script and [schedule workflow](../../backend/prices/README.md) own public
rate acquisition and provenance. The first real snapshot remains blocked by sandbox DNS.

The four KPI definitions are sessions, model-call observations, tool-call observations and
input usage by accounting group (`headline_kpi=true`), coverage each. The additional
`observed_span_ms` headline must carry the definition caveat. Reasoning totals/distributions
require known model groups and compatible semantics; the ratio is a diagnostic definition
only. Latencies retain all values and carry the instrumentation question. Definition
quantile rules and display precision travel with every query report. See the
[API contract](../api/v0.1.md#owner-decisions-kpi-span-quantiles-reasoning-and-prices) for #11
rendering and drill requirements. Prefix reuse, timelines and repeat-after-error remain deferred.

## Migration convention

Revision `0010`, parent `0005`, creates the three non-materialized views. Future Alembic
batch alterations of **sessions, model_calls or tool_calls must drop all metric views
first and recreate them last**, using `drop_metric_views(connection)` and
`create_metric_views(connection)` in `infrastructure/db/metric_sql.py`. SQLite validates
views during table rename; omitting this sequence breaks batch migrations. Preserve
version-one helper semantics; changed projections need a versioned helper/migration.
Tests exercise upgrade from populated 0004, repeated upgrade, connection reopen,
downgrade and a throwaway batch alteration using this sequence.

The migration chain is linear: `0004` (upload profiles), `0005` (cross-file claims),
then `0010` (metric views). Claims and import diagnostics remain provenance metadata;
metric views count every canonical observation, including equal cross-file claims.
The claims backfill never deduplicates or changes metric totals. `run_migrations`
upgrades to the single `head`. See [import architecture](import-pipeline.md) for
claims comparison, backfill and the separately budgeted assistant context.
