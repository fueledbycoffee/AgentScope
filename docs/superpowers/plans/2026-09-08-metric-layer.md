# D2-03 / Issue #10 — Metric layer

## Goal

Every indicator has a definition (formula, unit, scope, null handling) in the domain; the SQL query adapter matches reference calculations on small fixtures; mixed-semantics aggregates are separated or flagged.

Phase 1 delivers this plan only. Branch: `feat/10-metric-layer`; inspected baseline: `e71f3b0`. Implementation starts only after the cross-vendor review and the owner's second-run instruction. No push, PR, board changes, merge, or rebase is part of either agent run.

## Current state

Verified in this worktree:

- `backend/src/agentscope_app/domain/schema.py` defines session, model-call and tool-call fields. Tokens are nullable integers with unit `tokens`; wall and internal latency are separate nullable integer `ms` fields. `token_semantics` describes accounting, including unvalidated `unknown`.
- `domain/reducer.py` derives observed session bounds and cached child counts. Bounds describe imported observations, not active time. `docs/adr/ADR-002-identities.md` is the identity contract; the source/occurrence uniqueness constraints are visible in `infrastructure/db/models.py`. This issue counts stored observations and does not invent cross-export deduplication.
- `application/use_cases/queries.py` owns a four-entry `DEFINITIONS` dictionary and `MetricsSummary.execute(*, source, agent)`. Definitions contain prose but no executable domain formula. `application/ports.py` puts `metrics_summary(...) -> dict[str, Any]` on `TraceRepository`; no `TraceQuery` exists.
- `application/dto.py` has `Metric(value, definition, unit, coverage, by_semantics)`, `Coverage(known, total)` and four summary fields: sessions, model calls, tool calls, input tokens. Only token metrics currently carry coverage. FastAPI serializes these dataclasses directly.
- `infrastructure/db/repositories.py` implements summary aggregates with separate child queries, already avoiding a direct model-call/tool-call Cartesian join. It nevertheless returns one token sum across incompatible tags. Its Python dictionary normalizes null tags after SQL grouping, so null and literal `unknown` groups can overwrite each other. `_token_metric` separately defines session token sums and omits semantics groups. Session lists call it once per session.
- `infrastructure/db/models.py` stores `sessions(id, source, external_id, agent, observed_start_at, observed_end_at, ...)`, `model_calls(id, session_id, import_id, model, token_semantics, started_at, input_tokens, output_tokens, ...)`, `tool_calls(id, session_id, model_call_id, import_id, tool_name, started_at, wall_latency_ms, internal_latency_ms, ...)`, and typed `entity_contributions` with `import_id`. Import totals are audit snapshots, not analytic facts.
- `infrastructure/db/unit_of_work.py` wires `SqlAlchemyTraces`; `infrastructure/db/engine.py` registers SQLite connection setup and runs Alembic. Latest migration is `0004_upload_profile.py`; no metric SQL views exist.
- `interfaces/api/routers.py` exposes `GET /api/metrics/summary` with source/agent filters. `GET /api/sessions` has the same two filters; the session-detail route flattens the summary DTO. `interfaces/api/container.py` wires these use cases.
- `web/src/pages/Overview.tsx` renders Sessions, Model calls, Tool calls and Input tokens through `KpiTile`, followed by `SessionsTable`. Its comment defers charts, output tokens and comparability to #10/#11. `web/src/api/types.ts` expects numeric legacy metric values and `coverage.known/total`.
- The cited sprint plan §5 requires four KPIs and three charts but does not name them. The design of record, `research/design/claude/3-console/README.md` and `mockup.html`, supplies the target: Sessions, Model calls, Input tokens, Output tokens; Activity by day (model calls), Tokens by model (input), Tool calls by tool. Keep tool-call summary data for the secondary count and current UI. The mockup's semantic claims are examples, not authority to validate unknown accounting.
- `docs/adr/ADR-003-nulls-and-units.md` requires coverage for every metric, visible unknown timestamps, and separated incompatible accounting. ADR-006 assigns scope-parameter UI/API integration to #11. `docs/api/v0.1.md` promises additive response evolution. Existing `tests/infrastructure/test_database.py` asserts a mixed token total and exact-file re-import stability; `tests/interfaces/test_api_e2e.py` checks summary counts/coverage. Neither provides a small independent metric oracle.
- `backend/pyproject.toml` enforces inward imports and forbids frameworks in domain. `.github/workflows/ci.yml` defines backend, web, and Playwright gates.

## Design

### 1. Domain registry and evaluation contract

Add framework-free `domain/metrics.py`, using immutable dataclasses/enums and a read-only registry. A definition is declarative data, not an SQL fragment or executable expression:

```python
MetricDefinition(
    id: str, version: int, label: str, description: str,
    grain: EntityGrain,                 # session | model_call | tool_call
    operation: Aggregation,              # count | sum
    field: str | None,
    unit: str, formula: str, scope: str, null_handling: str,
    coverage_field: str | None,          # None means every eligible entity
    semantics_field: str | None,
    comparability_rule: ComparabilityRule,
)
MetricRegistry(definitions: Sequence[MetricDefinition])
MetricRegistry.get(metric_id: str) -> MetricDefinition
```

Validate duplicate IDs, version, numeric field type, field/grain membership, canonical unit, coverage field and semantics field at construction against `TARGET_SCHEMA`. `count` uses canonical entity IDs from the adapter, not native IDs or nullable columns; its unit is `count`. `sum` accepts only registered canonical integer measures. Unknown IDs/unsupported operations fail explicitly. No `eval`, SQL strings, arbitrary field paths, mutable runtime registration, or mapping-DSL changes.

Initial definitions:

| ID | Grain and formula | Unit | Coverage and null handling | Comparability |
| --- | --- | --- | --- | --- |
| `sessions` | Count distinct stored session IDs in scope | count | n/n; empty is count 0 with coverage 0/0 | Recorded identities per source; no claim of equal workload |
| `model_calls` | Count model-call observation IDs in scope | count | n/n; empty count 0 | Observations, not unique requests or equivalent effort |
| `tool_calls` | Count tool-call observation IDs, including unlinked tools | count | n/n; empty count 0 | Observations; no parent-link requirement |
| `input_tokens` | Sum known `model_call.input_tokens` | tokens | known calls / eligible calls; no known values => null; measured zero contributes | Partition by normalized token semantics |
| `output_tokens` | Sum known `model_call.output_tokens` | tokens | Same rule, independently measured coverage | Same partition rule; no inference from input/reasoning fields |

Coverage is `n_with_value / n_total`, both from the same filtered grain before grouping away missing values. Store integer numerator and denominator; ratio is undefined for denominator zero, never 100% or a fabricated zero. Preserve the existing public names `known` and `total` as aliases. Definitions say canonical null excludes a contributor; upstream diagnostics retain why it was missing. This layer does not reclassify ingestion diagnostics.

Normalize null/empty token tags to `unknown` **before** SQL grouping, without rewriting other tags. Return each partition with its own value and coverage, including partitions whose values are all null. Domain result assembly returns `comparability = not_applicable | comparable | mixed | unknown`, plus a human-readable reason. Only one non-unknown tag among known contributors permits a comparable token total. Multiple known tags produce `mixed`; any unknown contributing usage produces `unknown` with a reason that also records mixed tags if present. Missing values still affect coverage, but an all-null foreign-tag partition cannot make known usage incomparable. Even one `unknown` partition is not certified comparable across sources.

The new canonical result's token value is null for mixed/unknown accounting, with available values in partitions. Retain legacy `value`/`by_semantics` numeric summary fields for compatibility, explicitly flagged and described as a sum of recorded values with unvalidated cross-group comparability. Do not use that legacy sum as the canonical value for #11. Session-level token results use the same definitions and flags.

Adding a definition over an existing canonical integer field with count/sum and supported dimensions changes registry data only, not adapter branches or view DDL. Prove this by injecting a test-only output/cache/latency definition. #28 may require new mathematical primitives or new source fields; those legitimately need a separately reviewed extension. This is not a promise to interpret arbitrary future formulas.

### 2. Application-owned query specification and port

Add `application/metric_queries.py` for typed input/output contracts, validation and definition-to-request resolution:

```python
TraceScope(source: str | None = None, agent: str | None = None,
           model: str | None = None, tool: str | None = None,
           started_from: datetime | None = None,
           started_before: datetime | None = None,
           import_id: str | None = None,
           session_ids: tuple[str, ...] | None = None,
           activity_grain: EntityGrain | None = None,
           token_semantics: str | None = None,
           model_is_unknown: bool = False,
           agent_is_unknown: bool = False,
           timestamp_missing: bool = False)
MetricQuerySpec(definition: MetricDefinition, scope: TraceScope,
                group_by: tuple[Dimension, ...] = ())
TraceQuery.aggregate(spec: MetricQuerySpec) -> AggregateRows
TraceQuery.session_ids(scope: TraceScope, *, limit: int, offset: int) -> Sequence[str]
```

`AggregateRows` contains exact Python integer aggregates, known/total counts, typed group keys (including null), and semantics partitions. Domain owns interpretation/comparability; the application owns request validation and DTO assembly. Add `UnitOfWork.trace_query: TraceQuery`, wire `SqlAlchemyTraceQuery` and a recording fake. Remove `metrics_summary` from the write-oriented `TraceRepository` after migrating its callers. Keep repository entity/provenance operations intact. No SQLAlchemy objects cross the port.

Allowlisted dimensions initially: source, agent, model (model-call grain), UTC started day (model/tool-call grain), tool name (tool-call grain). Validate incompatible grain/dimension combinations and reversed or timezone-naive date bounds. Dates are half-open `[started_from, started_before)` UTC. No implicit local timezone or observed-end fallback. `session_ids=None` is unfiltered; an empty tuple is an empty scope.

Scope semantics, shared by aggregates and the port's session drill-down:

1. Source/agent restrict sessions. Import selects observations by their recorded import and sessions with contributions or children in that import; reconciled sessions count once. Duplicate import attempts have no new observations. Do not silently substitute their earlier import; #11 can link the original report.
2. Model restricts model-call rows directly; tool restricts tool-call rows directly. When querying the other child grain, use correlated `EXISTS` for matching children in the same session. Combined model/tool filters mean session co-occurrence, not an implied tool-to-model parent relationship. Document this meaning in the filter contract.
3. Time bounds restrict the current child grain's `started_at`. For session counts/drill-down, require at least one qualifying child: when model is specified, a matching model call must meet the time bounds; when tool is specified, a matching tool call must meet them; with neither, either child grain may qualify. Model/tool predicates must match the same row as their own time bounds, not different children. Import restrictions apply inside each witness predicate.
4. Sessions without children remain countable with only session-level filters. They disappear only when a requested child predicate needs a witness. Nullable labels use explicit null buckets, distinct from literal strings such as `unknown`.
5. Time-filtered-out missing timestamps are reported as an excluded-unknown count from the same non-time scope. Without time bounds, null timestamps remain in the population and appear as an explicit unknown-day bucket. A day drill is the same one-day UTC interval, with chart grain included in the session witness selection; return that grain in drill metadata so a tool timestamp cannot accidentally match a model-activity drill.

`activity_grain` accepts only child grains; chart-generated scope sets it. It constrains time witnesses on session drill-down, not the underlying canonical session identity. Missing model/agent buckets drill with `model_is_unknown`/`agent_is_unknown`, never a literal label pretending to be a source value. These flags are mutually exclusive with the corresponding exact-value filter. An unknown-day drill uses `timestamp_missing=true` with an explicit activity grain, mutually exclusive with time bounds. A semantics partition drill adds `token_semantics` (including the normalized literal `unknown`); this is a model-call witness predicate and follows the same row/import/time rules as model. For every chart bucket, the drill selects its eligible population, including null-measure rows counted in coverage, rather than only known-value contributors. Required tool names and sources cannot have null buckets in valid canonical data.

### 3. SQL views and query adapter

Migration `0010_metric_views` (file `0010_metric_views.py`, `down_revision='0004'` on this baseline) creates three non-materialized views with one row per canonical entity. Use an issue-specific revision identifier to avoid another agent choosing `0005`; the coordinator resolves any resulting multiple-head integration, not this worktree.

| View | Columns |
| --- | --- |
| `metric_sessions_v1` | `id, source, external_id, agent, observed_start_at, observed_end_at` |
| `metric_model_calls_v1` | `id, session_id, import_id, source, agent, provider, model, started_at, ended_at, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, reasoning_tokens, token_semantics, is_error` |
| `metric_tool_calls_v1` | `id, session_id, model_call_id, import_id, source, agent, tool_name, started_at, ended_at, wall_latency_ms, internal_latency_ms, is_error, exit_code, status` |

Child views join only their owning session (many-to-one). Model view normalizes `token_semantics`. Views never join sibling children, contributions, rejects or imports into the fact population. `EXISTS` handles import provenance/session eligibility. Never repair a fan-out with `SUM(DISTINCT value)`: equal-valued calls are separate observations. Never substitute cached all-time session counts for filtered counts.

`infrastructure/db/trace_query.py` binds allowlisted SQLAlchemy view columns, compiles the specification and uses `COUNT(*)`, `COUNT(value)`, exact integer sum and `GROUP BY`. No metric-ID switch or formulas in HTTP/chart code. Apply filters before aggregate/group operations; order group keys deterministically and preserve null groups. Query all semantics partitions in one grouped operation. Batch per-session metrics for session lists, rather than issuing one query per row; reuse the same path for detail.

SQLite integer `SUM` can overflow across individually valid rows. Add an adapter-owned `exact_int_sum` SQLite aggregate, registered on every connection by `engine.py`, accumulating Python integers and returning decimal text (null when no known inputs). SQL adapter parses it back to `int`; no `TOTAL`, float cast or silent truncation. Register it in a separate `metric_sql.py` helper to keep engine setup small. Test both JavaScript-safe-boundary and signed-64-bit aggregate overflow cases. Existing storage limits for a single value are unchanged.

Downgrade drops only the three views. Upgrade tests cover an empty database and a populated database at revision 0004, repeated migration invocation and reopening a connection. No materialized totals, import snapshot changes, or canonical schema rewrites.

### 4. Use cases, HTTP contract and #11 handoff

- `MetricsSummary` requests the five initial definitions through `uow.trace_query`, replacing the untyped repository dictionary and application prose dictionary. Retain existing four fields and add `output_tokens`. Add unit, coverage, metric ID/version, comparability/reason and exact text fields for all metrics.
- New `ListMetricDefinitions.execute()` returns registry metadata; `QueryMetric.execute(metric_id, scope, group_by)` resolves and validates definitions before calling the port. Wire them in `container.py` and add metric routes only in `routers.py`.
- `GET /api/metrics/definitions` returns the registry definitions, formula, grain, unit, scope, null and comparability rules, and supported dimensions.
- `GET /api/metrics/query?metric_id=input_tokens&group_by=model` returns `metric_id`, definition metadata, effective scope, overall coverage, unknown-time exclusions and bucket results with semantics partitions and drill scope. Repeated `group_by` allows at most two supported dimensions. Scope parameters are `source`, `agent`, `model`, `tool`, `started_from`, `started_before`, `import_id`, `activity_grain`, `token_semantics`, `model_is_unknown`, `agent_is_unknown`, and `timestamp_missing`; session IDs remain internal. Invalid IDs/spec combinations return the established `400 invalid_input`; malformed HTTP dates/enums return 422. No caller-supplied SQL/formula.
- All new result values and coverage counts cross HTTP as decimal text or null; every numeric display has an authoritative `value_text`, `known_text`, `total_text`. Legacy numeric summary aliases remain additive-compatible for existing consumers, and are explicitly deprecated for exact display; new canonical result DTOs contain no lossy number aliases. #11 must consume text for exact values and may derive approximate chart geometry separately. Legacy mixed `value` remains flagged; new canonical `value_text` is null for incomparable totals and each partition has its own exact text. Also provide `recorded_sum_text` for the flagged legacy sum, so no numeric alias is required to inspect it exactly.
- Session token DTOs receive the same additive trust metadata; existing counts, detail rows and provenance links stay intact. Repository `_token_metric`/`_summary` delegate to the common adapter and assembler, eliminating their independent formula/definition.
- Chart requests are data-driven uses of the same definitions: activity = `model_calls` by UTC started day; tokens = `input_tokens` by model and mandatory semantics partition; tools = `tool_calls` by tool name. Null model/agent/day buckets carry explicit labels and null keys. No default top-N truncation or invented zero-filled usage. Empty observed activity buckets may be presented as zero counts only when #11 supplies an explicit date range.
- #11 owns changes to `OverviewPage`, `KpiTile`, `SessionsTable`, frontend API types, scope chips, quality strip, definitions page and `/api/sessions` scope-parameter wiring per ADR-006. This plan supplies their exact query contract and session-ID port; it does not edit those surfaces. #11 will also thread the shared `TraceScope` through the summary route's additional scope parameters. Current source/agent summary calls remain supported here. Review must align these handoff names before implementation to avoid competing edits to shared DTO/router/UoW sections.

## Files touched (exhaustive)

Phase 1 commit changes only `docs/superpowers/plans/2026-09-08-metric-layer.md`.

Planned implementation surface; paths below are relative to `backend/` unless explicitly prefixed otherwise:

| Path | Change |
| --- | --- |
| `src/agentscope_app/domain/metrics.py` | New definition registry, validation, coverage/comparability rules |
| `src/agentscope_app/application/metric_queries.py` | New scope/spec/result contracts and shared metric DTO assembler |
| `src/agentscope_app/application/ports.py` | TraceQuery and UoW property; remove repository metric method |
| `src/agentscope_app/application/dto.py` | Additive summary/session metric trust and exact-text fields; output tokens |
| `src/agentscope_app/application/use_cases/queries.py` | Registry-backed summary plus definition/query use cases |
| `src/agentscope_app/infrastructure/db/trace_query.py` | Generic view adapter and shared scope compiler |
| `src/agentscope_app/infrastructure/db/metric_sql.py` | Exact integer SQLite aggregate and registration helper |
| `src/agentscope_app/infrastructure/db/engine.py` | Register exact aggregate on each SQLite connection |
| `src/agentscope_app/infrastructure/db/alembic/versions/0010_metric_views.py` | Versioned view upgrade/downgrade |
| `src/agentscope_app/infrastructure/db/unit_of_work.py` | Wire TraceQuery |
| `src/agentscope_app/infrastructure/db/repositories.py` | Remove old summary query; reuse common session token path, batch list metrics |
| `src/agentscope_app/interfaces/api/container.py` | Wire metric use cases |
| `src/agentscope_app/interfaces/api/routers.py` | Add definitions/query routes; limit edits to metric imports/handlers |
| `tests/application/fakes.py` | Recording TraceQuery fake and UoW property; retire old metric stub |
| `tests/domain/test_metrics.py` | Registry, formula, units, null/comparability tests |
| `tests/application/test_metric_queries.py` | Request validation, port invocation and DTO assembly tests |
| `tests/metric_reference.py` | Synthetic records, explicit expected values, independent pure-Python oracle |
| `tests/infrastructure/test_trace_query.py` | SQL/oracle matrix, view migration and integer exactness tests |
| `tests/infrastructure/test_database.py` | Update existing metric assertions to check flagged compatibility and canonical partitions |
| `tests/interfaces/test_api_metrics.py` | New HTTP contract tests and existing-field compatibility |
| `docs/api/v0.1.md` (repository root) | Metric routes, exact-text/legacy fields, scope semantics and #11 handoff |

No frontend, dataset, mapping, dependency, lockfile, CI, ingestion, raw upload, or assistant changes. Shared backend files receive only the issue-specific changes listed above; coordinator integration handles ownership conflicts.

## Tests

Use generated in-memory synthetic records, not new dataset files. The reference calculator operates on plain Python fixture rows using loops/sets and independent filtering, not the SQL compiler or production aggregate helpers. Hand-written expected numbers anchor the oracle so two implementations cannot simply agree on the same mistaken formula.

Named cases to implement:

- `test_registry_has_complete_definitions_for_summary_and_chart_metrics`: every published indicator has formula/unit/grain/scope/null/coverage/comparability metadata.
- `test_registry_rejects_duplicate_ids_bad_fields_and_units`: invalid target, tokens-as-ms, and wall/internal substitution are rejected; valid distinct wall/internal definitions remain separate.
- `test_new_definition_runs_without_adapter_changes`: inject a new ID summing an existing canonical field, compare reference and SQL without changing adapter/view code.
- `test_null_zero_and_empty_populations`: token values `[10, 0, None]` => sum 10, coverage 2/3; all-null => null; no rows => count 0 and coverage 0/0; count coverage n/n.
- `test_semantics_partitions_and_unknown_normalization`: two incompatible tags never yield a comparable canonical total; null, empty and literal unknown merge without losing contributions; all-null partitions survive and measured zero is a known contributor.
- `test_join_multiplication_and_equal_values`: one session has two 10-token calls, three tools, multiple contributions, and a reject; expect sessions 1, calls 2, tools 3, tokens 20, coverage 2/2. `SUM(DISTINCT ...)` would incorrectly give 10 and must fail.
- `test_source_agent_model_tool_import_filters_after_join`: two sources share a native session ID; sessions have matching and nonmatching siblings across models/imports. Compare source, agent, model, tool, import and intersections to literal expected populations; unmatched siblings cannot leak into same-grain sums or denominators.
- `test_time_and_child_predicates_require_same_witness`: a matching model on day A and a different model on day B cannot satisfy model-plus-day-B; multiple contributions cannot multiply session IDs.
- `test_chart_drill_scope_matches_session_ids`: every day/model/tool bucket's emitted scope selects exactly its eligible session IDs (paginated deterministically), including unlinked tools, missing model/agent/day labels, semantics partitions, null-measure coverage rows and chart-grain time witnesses.
- `test_unknown_timestamps_and_utc_boundaries`: null day bucket, excluded-unknown count under a range, inclusive start/exclusive end, explicit UTC midnight, no endpoint fallback; unrelated tool time cannot satisfy model-day drill.
- `test_sql_matches_reference_for_every_definition_and_scope`: parameterized initial definitions, groupings and filters, including empty intersections; compare values, numerator, denominator, partitions and flags.
- `test_exact_sum_exceeds_js_and_sqlite_integer_ranges`: totals above `2**53-1` and `2**63-1` stay exact as text; all-null aggregate remains null; no float conversion or SQLite overflow.
- `test_metric_views_upgrade_downgrade_and_connection_reopen`: correct views/grain from empty and populated 0004; no fact mutations; exact aggregate registered on fresh connections.
- `test_metric_use_cases_use_trace_query_and_reject_invalid_specs`: fake captures application spec; no old repository aggregate call; unsupported dimensions/time bounds fail before execution.
- `test_metrics_http_metadata_coverage_and_exact_text`: summary's legacy keys/types remain; output tokens and definitions/query routes return documented metadata, partitions and exact strings, including zero versus null and invalid-input behavior.
- `test_session_metrics_match_summary_definition_and_partitions`: per-session totals/coverage/flags match the same scoped metric query; a session list batches token retrieval.

Retain the existing API upload/preview/commit/re-import tests and database idempotency checks. No re-import or join change may inflate stored observations.

Implementation verification, after focused cases pass: `uv --directory backend run pytest -q`, `uv --directory backend run ruff check src tests`, `uv --directory backend run ruff format --check src tests`, `uv --directory backend run mypy src`, `uv --directory backend run lint-imports`; then the CI-wide Ruff/script checks from `.github/workflows/ci.yml`, `pnpm --dir web lint`, `pnpm --dir web typecheck`, `pnpm --dir web test`, `pnpm --dir web build`, and `pnpm --dir web e2e`. Report actual results; failures outside this ownership surface go to the coordinator, not unrelated fixes. The coordinator alone opens a PR after all gates are green.

Phase 1 validation: check paths/current behavior, review this document against every task, run `git diff --check`, verify only the plan is staged, and commit with the required trailer. Runtime tests are not claimed for a documentation-only plan.

## Acceptance checks mapped to the issue's tasks

| Issue task / expected result | Reviewable evidence |
| --- | --- |
| Metric definitions registry in domain with coverage (`n_with_value / n_total`) | Registry contains all five summary definitions used by four target KPIs and three charts; named completeness, null/zero, unit and per-session consistency tests pass; definitions HTTP output derives from registry |
| TraceQuery port with application-owned query spec; SQL views in adapter | Typed spec and port have no SQLAlchemy dependency; UoW wiring uses the new adapter; three migrated entity-grain views are verified; import-linter and recording-fake tests pass |
| Join multiplication | Two equal-valued calls/three tools/multiple provenance rows remain 2 calls, 3 tools, 20 tokens; reference matrix agrees |
| Missing-as-zero | `[10, 0, None]` yields 10 with 2/3 coverage; all-null value is null; empty count and undefined coverage ratio are distinguished |
| Unit mistakes | Schema-aware registry rejects mismatched units; latency examples remain ms and wall/internal never substitute; exact sums do not cast to float |
| Filter correctness after join | Scope/filter and same-witness tests verify numerator, denominator, partitions and drill session IDs across multiple siblings/imports and UTC bounds |
| SQL adapter matches reference calculations | Independent oracle plus literal expected fixtures agrees for every initial metric and supported grouping |
| Mixed-semantics aggregates separated or flagged | New canonical values partition; legacy mixed totals carry explicit status/reason and exact recorded sum; unknown never becomes comparable |
| #28 extensibility | Test adds a definition using existing primitives/fields with zero adapter/view edits; explicit unsupported primitive error avoids silent approximation |
| #11 integration | Documented chart recipes, scope/witness rules, additive summary metadata, authoritative decimal text and ownership handoff; no frontend implementation in #10 |

## Risks

- #28 can change priorities or require a new primitive; this plan supports new definitions over the existing count/sum vocabulary without claiming arbitrary formulas are free. Do not wait for those answers to centralize existing metric definitions.
- The current UI and the Console target have different fourth tiles. Keep current response keys and add output tokens; #11 chooses the target layout. Count 0 remains a valid empty-population result; UI must distinguish that from a missing measure.
- Legacy numeric aliases can be lossy in JavaScript and legacy mixed sums can mislead. The explicit compatibility fields are transitional; #11 must render canonical text/partitions and comparability before the combined dashboard is accepted. New endpoints use text exclusively. No silent interpretation of numeric aliases as authoritative exact values.
- Model/tool/date scope rules can surprise users across heterogeneous traces. The precise co-occurrence and chart-grain witness semantics are a review checkpoint with #11, with tests anchoring the agreed behavior. Avoid adding unrelated quality filters in this issue.
- Shared UoW/DTO/router/repository hunks and migration heads need coordinator sequencing. The implementation stays on its assigned branch and never resolves cross-branch integration by merging/rebasing itself.
- Exact sums use a SQLite Python aggregate instead of native `SUM`; this avoids overflow but adds per-row Python work. Queries remain bounded by imported data and aggregate in SQL without loading full traces. Assess representative existing fixtures; optimize only if measured execution is unacceptable, preserving exactness.
- Existing databases may have single numeric values outside SQLite's supported storage range rejected during import; changing storage/ingestion is outside #10. Aggregating valid stored integers must remain exact.
- Identical native IDs in overlapping exports remain distinct observations unless ingestion already reconciled them. Do not turn the sprint's aspirational overlap gate into an undocumented metric-layer dedup heuristic.

## Cost estimate

Phase 1: about 45–75 minutes for repository inspection, contract design, plan checks and commit. Implementation after review: 12–18 engineering hours — 2–3 domain/contracts, 4–6 adapter/views/exact aggregation, 2–3 use cases/API/compatibility, 4–6 reference fixtures/regressions/full validation and documentation. Reserve 2–3 additional hours for #11 contract alignment and cross-vendor review corrections. No paid model/API calls, dataset downloads or new runtime service are required.

## Revision after review

This section supersedes conflicting text above. All 19 findings are accepted. Implementation is
now authorized by Phase 2; no frontend changes are required or planned.

1. **P1 — executed unit/column tests.** Ship `tool_wall_latency_ms` and
   `tool_internal_latency_ms`. Execute SQL against an independent Python oracle with wall=1500,
   internal=400 on one tool, and input=10, output=7, cache-read=3 on one model call. Assert the
   separate literal totals as well as oracle equality; no latency fallback or conversion.
2. **P1 — time types.** Explicit view tables use `UtcDateTime` for every time column (never
   reflection or bare DateTime). Test equivalent `+02:00` and `Z` bounds on real SQLite, and
   UTC-aware midnight/next-midnight drill bounds.
3. **P1 — complete indicators.** Add cache-read, cache-creation, reasoning tokens and the two
   latency sums; add `unlinked_tools` (tool count with null model_call_id), `missing_usage`
   (model calls with null input_tokens), and `unknown_timestamps` (model calls with null
   started_at). Add `tool_is_unlinked` and `usage_missing` scope flags and `linked` tool dimension.
   Add `imports_in_scope`: distinct import IDs contributing sessions or eligible child
   observations in scope, never duplicate attempts without contributions. A session-only scope
   includes session contributions; child-filtered scopes require eligible child observations.
   Quality rejects deliberately remain the existing import report/reject-summary API: rejects
   are pre-canonical records, cannot truthfully be attributed to canonical sessions, and do not
   acquire a fabricated session drill. Document these recipes and test registry completeness,
   imports-in-scope and unlinked-tool drill behavior.
4. **P2 — validation.** Every invalid query (ISO date, enum, dimension, ID, scope combination)
   returns 400 `invalid_input`, with `{path, message}` details. Preserve the existing handler;
   assert the envelope in HTTP tests. No 422 contract is introduced.
5. **P2 — coverage compatibility.** Keep `Coverage` exactly `{known, total}` with integer counts.
   Exact text applies to aggregate values/partition values only; no coverage text twins.
6. **P2 — resolvable fields.** The registry owns an explicit allowlist of projected canonical
   measures/dimensions; TARGET_SCHEMA validates measure type/unit only. Adapter mapping:
   model-call input/output/cache-read/cache-creation/reasoning field names map identically to
   their view columns; tool wall/internal latency and exit_code map identically. Identity and
   provenance `id/session_id/import_id/source`, session `agent`, derived `started_day/linked`
   and internal `session_id` grouping are storage dimensions, not mapping targets.
   `session.started_at/ended_at` are unresolvable: declared bounds are never observed bounds.
   Reject unresolvable fields during registry construction. Extensibility covers projected
   canonical integer fields only (including exit_code with unit count).
7. **P2 — legacy partitions.** `by_semantics` remains `dict[str, int]`, known contributors only.
   New `semantics_partitions` contains all partitions, including null values, exact text,
   and independent coverage. Canonical query results use that name too.
8. **P2 — scoped row counts.** Provide a batched per-session adapter operation accepting
   TraceScope that computes model/tool counts and tokens under that scope. Repository lists
   use it for their existing source/agent scope; #11 can pass the richer scope through this
   same operation. Test scoped counts alongside summary/partition consistency. Cached all-time
   counts are no longer the repository summary implementation.
9. **P2 — migration safety.** Ship shared create/drop view helpers. Future batch alterations
   of sessions/model_calls/tool_calls must drop all metric views first, recreate them last.
   Document this in `docs/architecture/metric-layer.md` and exercise a throwaway batch column
   alteration with this convention after upgrade.
10. **P2 — migration integration.** `revision='0010'`, `down_revision='0004'` is a deliberate
    branch placeholder. The coordinator must author an explicit Alembic merge revision if
    other branches add heads, before startup/merged tests. Keep upgrade target `head` unchanged;
    this branch's green tests do not validate a future merged migration graph.
11. **P2 — realistic import fixtures.** Import-scope, contribution fan-out and re-import tests
    use synthetic JSONL through StoreUpload/CommitImport (existing `_tracelab_line` pattern).
    Direct ORM fixtures are limited to arithmetic, boundary, and filter edge cases.
12. **P2 — mixed presentation.** The default TraceLab input-token canonical total is null
    because its accounting is mixed. #11 must show per-partition exact values plus the reason
    for mixed/unknown contributing accounting. Reserve `Unavailable` for no known usage;
    comparability, coverage and partitions distinguish these cases in the response.
13. **P3 — days.** SQLite `date(started_at)` returns ISO date string keys (null stays null).
    Drill converts a known key to UTC-aware midnight and next midnight. Test exactly midnight
    and 23:59:59.999999 on the same day and the exclusive next midnight.
14. **P3 — empty semantics.** Empty accounting tags are explicitly unvalidated and normalize
    to unknown for metrics, a measure-specific exception to general empty-string handling.
    No storage constraint forbids empty tags; do not assume ingestion excludes them. Preserve
    raw tags and test empty/null/literal unknown merging.
15. **P3 — raw rows.** Session detail retains raw token_semantics for provenance; API docs
    explain why metric normalization can label a raw null/empty tag unknown.
16. **P3 — source.** Session.source is authoritative across all views/filters. Assert ingested
    child sources agree with their owning session.
17. **P3 — port home.** TraceQuery Protocol and UnitOfWork.trace_query live in ports.py;
    metric_queries.py contains typed specs/results, validation and assembly, without ports imports.
18. **P3 — metadata.** View Table objects use private MetaData, never Base.metadata.
19. **P3 — exact aggregate failure.** Register only via the SQLite connect hook; explicitly
    reject non-SQLite engines at factory setup. Unregistered external connections fail loudly
    with no such function; never fall back to SUM or float aggregation.

Additional exhaustive file-list entry: `docs/architecture/metric-layer.md` for field mapping,
view migration convention and #11 recipes. Existing planned test files cover the added cases;
Coverage's unchanged shape requires no edits to test_api_e2e.py. No ADR or web/src files are owned
or changed by this implementation. PR_BODY.md is a local, uncommitted coordinator artifact.

## Revision after the owner's decisions

Phase 3 is authorized on 2026-09-08. This supersedes conflicting KPI, quantile and
no-currency statements above. Source: `/Users/sean/.claude/jobs/fcddadde/tmp/wave1/decisions-28.md`;
context: `research/insights/MERGE-DRAFT.md:347`. Already-so file:line references below
refer to the inspected phase-2 baseline `3be51ce`, before phase-3 line shifts.

| Question | Registry | Query port / execution | API | Docs |
| --- | --- | --- | --- | --- |
| Q1 Prices | Add scheduled USD cost, priced tokens × exact per-token rates, by accounting group. | Extend typed results with token-weighted priced coverage and schedule version. Generic cost primitive uses canonical fields and validated billing rules. Codex prefix input stays unpriced. | Cost definition/query with per-semantics split, priced coverage and schedule version. | Add `backend/prices/` versioned JSON and provenance, `scripts/fetch_openrouter_prices.py`, one real keyless GET of the models endpoint; keep only public model IDs/rates, model count, fetch/revision date and response hash. Document unknown rates and partial pricing. No test/runtime network fetch. |
| Q2 Prefix reuse | Already absent: `backend/src/agentscope_app/domain/metrics.py:249`. | Nothing to build; raw evidence already retained: `backend/mappings/tracelab-v1.json:74`. | No new reuse endpoint. | State deferred prefix metric; Claude-only cache panel remains the caching view. |
| Q3 KPI slots | Existing IDs already so: `backend/src/agentscope_app/domain/metrics.py:249`; clarify labels and four-KPI metadata. | Already so: shared summary at `backend/src/agentscope_app/application/use_cases/queries.py:177`; coverage assembly at `backend/src/agentscope_app/application/metric_queries.py:291`. | Preserve sessions/model_calls/tool_calls/input_tokens keys and expose KPI metadata. | Explicitly name sessions, model-call observations, tool-call observations, input usage by accounting group, coverage each. |
| Q4 Observed span | Add fixed label “observed span in imported data” with caveat: neither active time nor task duration; overlapping spans may overlap in real time. | Exact sum of known per-session observed end minus start, coverage known bounds / eligible sessions. Child filters select sessions; bounds remain their complete imported bounds. | Queryable span with exact milliseconds, scope, coverage and caveat. | Explain whole-session scope and mandatory headline caveat. |
| Q5 Incompatible semantics | Change refusal reason to “not comparable: N token semantics in selection”; unknown never compatible. | Already refuses canonical sums and preserves partitions: `backend/src/agentscope_app/domain/metrics.py:194`, `backend/src/agentscope_app/application/metric_queries.py:319`. Add mixed-scope regression. | Visible reason plus per-semantics split; legacy recorded aliases stay noncanonical. | Require visible refusal and split control in #11. |
| Q6 Quantiles | Declare nearest-rank quantiles, averaged even-n median and display precision in every definition; generic distribution operation. | Carry mergeable exact samples; overall quantiles use original observations, never bucket quantiles. | Exact distribution text with rules and precision through definitions. | State sample population, null/zero policy, and display rounding separately from exact transport. |
| Q7 Timeline | Nothing to build. | Existing detail reads: `backend/src/agentscope_app/application/use_cases/queries.py:153`. | Call/tool evidence remains in detail; timeline deferred. | No timeline in v0.1.0; ordered table belongs to #11. |
| Q8 Repeat-after-error | Already absent: `backend/src/agentscope_app/domain/metrics.py:249`. | Nothing to build; no adjacency aggregate. | Nothing published. | Deferred beyond v0.1.0. |
| Q9 Reasoning | Total already so: `backend/src/agentscope_app/domain/metrics.py:49`, `:258`; add distributions by compatible model group; ratio only a diagnostic definitions entry. | Reuse distribution primitive and refusal; model grouping for reasoning reports; reject execution of diagnostic-only definition. | Totals/distributions carry scope, model/semantics groups and coverage; no ratio query/trend. | Explain diagnostic limitations; no trend finding. |
| Q10 Latencies | Zero already included: `backend/src/agentscope_app/domain/metrics.py:242`; definition names instrumentation question (timer resolution, absent instrumentation, or real elapsed time?). | No value-based exclusion; test zero/one-ms rows and coverage. | Definition caveat goes to #11 tool table. | All recorded latencies remain until source evidence supports a validity rule. |

Implementation order: small KPI/refusal/latency deltas; observed span; quantiles/reasoning;
pricing; final API/architecture docs and local `PR_BODY.md` rewrite covering phases 2 and 3
with the existing footer. Commit this revision alone first. Every implementation commit runs
ruff format, ruff check src tests, mypy src, lint-imports, pytest -q.

Additional files: domain pricing/distribution helpers, infrastructure price loader, focused
metric/API/fetch-script tests; extend existing query DTO, adapter and SQLite helper files.
No ingestion adapter, canonical schema, frontend or ADR changes. PR_BODY.md stays an
uncommitted coordinator artifact. Exact model IDs only; no speculative aliases. Missing cache
rates and cache creation remain unpriced. Codex total input cannot be treated as prompt because
its prefix component is unvalidated. Quantile samples use memory proportional to observations;
exact decimal products/medians must avoid rounding. A denied required public fetch is BLOCKED.
Never push, gh, board, list processes, merge or rebase.
