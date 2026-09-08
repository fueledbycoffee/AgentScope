# Plan: trustworthy dashboard, scoped charts and definitions (issue #11)

## Goal

Expected verifiable result (verbatim):

> Dashboard shows sessions, model-call observations, input tokens, output tokens (Unavailable when no coverage); activity by day, tokens by model, tool counts; filters by source, agent, model, period; clicking a chart lists matching sessions; quality strip shows rejects, missing usage, unknown timestamps, unlinked tools.

The result is verifiable from `#/overview`: every displayed value is under the
same URL scope, carries coverage and a definition, preserves authoritative
decimal text, and reaches the same matching population on `#/sessions` when a
chart bar is activated. `#/definitions` renders the server's complete metric
registry rather than a second client-owned glossary.

## Current state

### Implemented Console shell and dashboard primitives

- `docs/adr/ADR-006-ui-design-direction.md` makes Console the design of record:
  one sticky Source / Agent / Model / Period scope, one chip-based drill
  mechanism, exact values beside abbreviations, coverage in the same element,
  `Unavailable` rather than a fabricated zero, and definition controls one
  step from a metric. The standing owner rule also prefers icon-only secondary
  controls with an accessible name and visible tooltip.
- `research/design/claude/3-console/README.md` fixes the Overview budget at
  four KPI cards, three charts, one quality strip and eight session rows. It
  also fixes the chart keyboard contract: focused bars expose the same exact
  value as hover, Enter/Space drills, and a hidden exact-value table remains
  available to assistive technology.
- `web/src/pages/Overview.tsx` currently requests
  `GET /api/metrics/summary?source=&agent=` plus the first eight sessions. It
  renders four `KpiTile`s (Sessions, Model calls, Tool calls, Input tokens) and
  the session table. It has no charts, headline tiles, quality strip or scoped
  definitions request.
- `web/src/pages/Definitions.tsx` manually constructs four rows from the
  summary. It does not consume the definition registry and cannot display
  formula, population, null handling, comparability, quantile rules or
  diagnostic-only entries.
- `web/src/pages/Sessions.tsx` sends only Source/Agent and paginates with
  `offset`; `web/src/pages/sessionsTable.tsx` uses the current row DTO's legacy
  numeric `input_tokens.value`.
- `web/src/scope.ts` has `SCOPE_KEYS = ['source', 'agent']`, URL parsing,
  stable identity, `set`, `clear`, pagination reset and scope-preserving links.
  `web/src/scopeDimensions.ts` derives suggestions from the one loaded session
  page, so its list is not a complete facet source.
- `web/src/components/bars.tsx` has a URL-controlled text/datalist `ScopeBar`,
  a `ScopeReceipt`, and the shared presentation component
  `ScopeChip({ label, value, onRemove })`. The chip's close button is already
  named and titled `Remove {label} {value}`.
- `web/src/components/primitives.tsx` has `KpiTile`, `Popover` and
  `QualityStrip`, but their values are JavaScript numbers. `KpiTile` cannot
  represent “mixed but known, show partitions and refuse the total”, and
  `QualityStrip` cannot consume authoritative text.
- `web/src/components/charts.tsx` has single-series `DayBars` and `HBars`.
  They parse and format numbers in JavaScript, use exact numeric values only,
  and select by the displayed category name rather than by the server-returned
  `drill_scope`. They are deliberately not re-exported yet.
- `web/src/styles/base.css` already supplies Console grids, KPI, chart,
  quality, popover, focus, dark-theme and reduced-motion primitives. Recharts
  3.10.1 is already locked in `web/package.json`; no new chart library is
  needed.
- `web/src/App.test.tsx`, `web/src/components/components.test.tsx` and
  `web/src/test/fixtures.ts` cover the current four cards, Source/Agent query
  synchronization, stale-request suppression, popovers and chips. The two
  primitive chart orientations appear only in `web/src/pages/Gallery.tsx`;
  there is no automated chart, dashboard-recipe or scope unit test.

### Owner decisions applied to the layout

- `research/insights/MERGED.md` section 4 Q3 supersedes the older four-card
  wording in issue #11: the four primary KPI slots are **Sessions**,
  **Model-call observations**, **Tool-call observations**, and **Input usage by
  accounting group**. Q1 and Q4 add Scheduled cost and **observed span in
  imported data** as subordinate headline values.
- This plan resolves the open layout point in `MERGED.md` section 4 as follows:
  keep exactly those four visually dominant KPI cards, then place Cost and
  Observed span in a quieter two-column `headline-strip` immediately below.
  They use smaller type, retain their coverage/schedule/caveat in the tile,
  and are not counted as KPI cards. Output tokens remain visible as the
  overall headline and second series of **Tokens by model**, satisfying the
  issue result without displacing the owner-selected Tool calls card.
- The three charts remain Activity by day, Tokens by model, and Tool calls.
  The default mixed TraceLab token population does not become `Unavailable`:
  its input/output accounting partitions and the refusal reason are visible.
  A genuinely all-null token measure is `Unavailable` with coverage.
- The registry currently supports the dashboard portions of merged insights
  sections 1.1 through 1.7: navigation counts, coverage, activity, tokens,
  cost, span and reasoning definitions. The inspected #10 contract does **not**
  publish the reconciled cache panel from section 1.8, an error-rate metric for
  section 1.9, or the per-session round bins from section 1.11. This issue will
  not recreate those domain definitions in chart code. Their absence is an
  explicit contract risk below, not a licence to invent a residual, denominator
  or histogram.

### Metric-layer handoff inspected in worktree 10

The #10 worktree was inspected at committed head `f301194`, including its
current uncommitted review fixes. It is not merged. The path named in the issue
brief, `application/metrics/`, does not exist there; the definition registry is
actually `backend/src/agentscope_app/domain/metrics.py`, and typed application
query contracts are in
`backend/src/agentscope_app/application/metric_queries.py`.

The plan depends on these exact #10 contracts and will re-check them after #10
lands:

1. `GET /api/metrics/summary` returns `sessions`, `model_calls`, `tool_calls`,
   `input_tokens`, and `output_tokens`. Every entry carries `metric_id`,
   `version`, `definition`, `unit`, `coverage {known,total}`, authoritative
   `value_text`, `recorded_sum_text`, `comparability`, `reason`, and
   `semantics_partitions`. The legacy numeric `value` and `by_semantics` are
   never authoritative UI inputs.
2. `GET /api/metrics/query` accepts `metric_id`, repeated `group_by`, and the
   public `TraceScope` fields: `source`, `agent`, `model`, `tool`,
   `started_from`, `started_before`, `started_through`, `import_id`,
   `activity_grain`, `token_semantics`, `model_is_unknown`,
   `agent_is_unknown`, `timestamp_missing`, `tool_is_unlinked`,
   `tool_is_linked`, `usage_missing`, `witness_time_override`,
   `witness_required`, `witness_started_from`, `witness_started_before`,
   `witness_started_through`, and `witness_timestamp_missing`.
   `session_ids` is internal and must never be sent by the browser.
3. A metric query returns `metric_id`, full `definition`,
   `supported_dimensions`, effective `scope`, `group_by`, `overall`,
   `excluded_unknown_timestamps`, and `buckets`. Each bucket carries ordered
   `keys`, a `MetricResult`, and the authoritative `drill_scope`; each
   semantics partition also carries its own `drill_scope`. Values,
   distributions and token-weighted priced coverage use text fields. A chart
   may derive an approximate number only for SVG geometry.
4. `GET /api/metrics/definitions` returns all registry metadata: `id`,
   `version`, `label`, `description`, `grain`, `operation`, `field`, `unit`,
   `formula`, `scope`, `null_handling`, coverage/semantics fields,
   comparability rule, population, supported dimensions, `headline_kpi`,
   `caveat`, quantile/median/display rules, `diagnostic`, and
   `model_group_required`.
5. Dashboard recipes are registry-backed: `model_calls` grouped by
   `started_day`; `input_tokens` and `output_tokens` grouped by `model`, then
   rendered by semantics partition; `tool_calls` grouped by `tool_name`;
   ungrouped `missing_usage`, `unknown_timestamps`, `unlinked_tools`,
   `imports_in_scope`, `observed_span_ms`, and `scheduled_cost_usd`.
6. `MetricResult.value_text` is null for mixed or unknown accounting even when
   `recorded_sum_text` exists. `semantics_partitions` and `reason` are the
   visible result in that state. `priced_coverage.known_text/total_text` is
   authoritative. Ordinary row coverage remains integer counts.
7. Date bounds are timezone-aware UTC and half-open
   `[started_from, started_before)`. Returned witness fields must round-trip
   unchanged when a chart changes grain; rebuilding a drill from a label is
   not equivalent.

The current #10 `web/src/api/types.ts` contains `MetricDrillScope`,
`MetricDistribution`, `MetricPartition` and `MetricResult`, but its `Scope`,
`Metric`, and `MetricsSummary` declarations still lag its backend/docs. This
issue owns the final web type alignment after merge.

## Design

### 1. One typed dashboard data module

Add `web/src/dashboard/dashboardData.ts` as the single place that names the
queries above and adapts their transport objects to view data. It exports:

```ts
export interface DashboardData {
  summary: MetricsSummary
  definitions: Record<string, MetricDefinition>
  activity: MetricQuery
  inputByModel: MetricQuery
  outputByModel: MetricQuery
  tools: MetricQuery
  missingUsage: MetricQuery
  unknownTimestamps: MetricQuery
  unlinkedTools: MetricQuery
  importsInScope: MetricQuery
  observedSpan: MetricQuery
  scheduledCost: MetricQuery
  rejectQuality: RejectQuality
}

export function loadDashboard(scope: ApiTraceScope): Promise<DashboardData>
export function activityPoints(query: MetricQuery): ChartPoint[]
export function tokenRows(input: MetricQuery, output: MetricQuery): TokenRow[]
export function toolPoints(query: MetricQuery): ChartPoint[]
```

`loadDashboard` runs independent HTTP calls concurrently. Core metric/chart
failure rejects the resource so stale or partially scoped numbers are not
shown as one dashboard. Reject accounting is isolated: it may return an
explicit unavailable `RejectQuality` without hiding otherwise valid canonical
metrics.

The adapter keeps `valueText` intact for labels, hidden tables, exact lines
and drill assertions. `Number(valueText)` is stored separately as
`plotValue`; it is used only by Recharts for relative geometry. Null metric
values do not become zero bars. Counts with `value_text === '0'` remain real
zeroes. Category keys use the API's ordered bucket keys, never a display label,
so a literal `unknown` remains distinct from a null model/day bucket.

### 2. API client, facets and full-scope backend wiring

Extend the web API types with the inspected #10 DTOs and add:

```ts
getMetricDefinitions(): Promise<MetricDefinition[]>
queryMetric(metricId: string, groupBy: MetricDimension[], scope: ApiTraceScope): Promise<MetricQuery>
getScopeFacets(scope: ApiTraceScope): Promise<ScopeFacets>
```

All query construction is allowlisted. Booleans are sent only when true;
null/undefined values and internal `session_ids` are omitted; repeated
`group_by` retains its order. Returned drill scopes are validated/normalised
against `MetricDrillScope` before they can enter a URL.

Add `GET /api/metrics/facets` as a small application composition over #10's
query use case, not a new SQL definition. It returns:

```json
{"sources":["swe-chat","tracelab"],"agents":["claude-code","codex"],"models":["claude-opus-4","gpt-5.5-codex"]}
```

For each facet, the use case clears that dimension from the incoming scope and
queries the appropriate count (`sessions` grouped by `source` or `agent`,
`model_calls` grouped by `model`). It excludes null buckets from these
free-text values; null model/agent chart buckets still drill through the
server's explicit `*_is_unknown` flags. This replaces incomplete page-derived
suggestions without adding a storage-specific facet port.

`GET /api/metrics/summary`, `GET /api/metrics/facets`, and
`GET /api/sessions` accept the same public `TraceScope` fields as
`GET /api/metrics/query` (plus pagination only on sessions). A shared interface
parser maps HTTP strings to `TraceScope`, rejects unknown/repeated singleton
parameters through the established `400 invalid_input` envelope, and never
accepts `session_ids`.

Application/repository signatures become:

```py
ListSessions.execute(*, scope: TraceScope, limit: int = 50, offset: int = 0) -> Sequence[SessionSummary]
MetricsSummary.execute(*, scope: TraceScope) -> MetricsSummaryDTO
TraceRepository.list_sessions(*, scope: TraceScope, limit: int, offset: int) -> Sequence[SessionSummary]
ListScopeFacets.execute(scope: TraceScope) -> ScopeFacets
```

The SQL repository selects IDs through `TraceQuery.session_ids(scope, ...)`,
which retains the existing newest-observed-start-first, nulls-last, ID
tie-break ordering. It hydrates those sessions in returned order and asks
`TraceQuery.session_metrics(replace(scope, session_ids=...))` for row counts
and usage. Thus a model/tool/day/quality drill filters both which sessions are
listed and each row's model/tool/token measures; cached all-time counts never
appear beneath a narrower scope.

### 3. Shared scope and chip contract with issue #46

Issue #46's parallel plan names the shared base contract. This plan adopts it:

- `SCOPE_KEYS` becomes exactly
  `['source', 'agent', 'model', 'period'] as const`.
- #46 creates `SCOPE_LABELS`, `formatScopeValue`, `toggle`, `remove`,
  `scopeHref`, and `ScopeChips`; this issue adds the exhaustive entries
  `model: 'Model'`, `period: 'Period'`, and period formatting such as
  `7d -> last 7 days` when those helpers are present. It does not create a
  competing cell-link helper.
- The shared leaf remains exactly
  `ScopeChip({ label: string, value: string, onRemove: () => void })` in
  `web/src/components/bars.tsx`. Its markup, accessible removal name and
  tooltip do not change. #46's `ScopeChips` remains the sole renderer: this
  issue only extends it to append the derived drill envelope after the four
  base-filter chips. Dashboard code never renders `ScopeChip` directly.
- `source`, `agent`, and `model` use those exact URL/API names. A cell link from
  #46 toggles only its own key, preserves the other scope, and resets `offset`.
  `period` is UI-only and is never forwarded as an unknown server parameter.

The period options are `all` (omitted), `7d`, `30d`, and `90d`. For a request,
`resolvePeriod(period, now)` produces explicit UTC midnight bounds covering
the named number of calendar days through today; the bar labels the control
`Period (UTC)`. The pure function takes `now` so the URL and API behavior are
deterministically tested. A returned chart drill always wins over the derived
period bounds.

The four base keys alone cannot losslessly represent #10's tool, quality, day,
semantics and witness fields. Preserve the server contract in one additional,
versioned URL value owned by this issue:

```ts
export interface DrillEnvelopeV1 {
  version: 1
  label: 'day' | 'tool' | 'quality' | 'accounting'
  value: string
  scope: PublicMetricDrillScope // MetricDrillScope without session_ids
}
```

`useScope()` gains `drill`, `setDrill(envelope)` and `removeDrill()`. The
envelope is JSON encoded by `URLSearchParams` under `drill`, size-limited and
strictly allowlisted on read; malformed/unknown versions are ignored rather
than forwarded. `scopeSearch` and `link` preserve it, so reload, Back,
middle-click and a session-detail return path retain the exact scope. API calls
start from the envelope's scope when present, then overlay the current
Source/Agent/Model base values and clear their mutually exclusive unknown
flags; removing its one chip restores the four base filters. #46's
`ScopeChips` renders the derived chip through the unchanged `ScopeChip`. This
is still one URL-owned scope and one chip component—there is no component-local
drill state or alternate filtering API.

Only one chart/quality drill envelope is active at a time in v0.1. A new drill
replaces the old envelope with the new server-returned scope, which already
contains the old predicates where they remain applicable. The chip therefore
describes the latest drill step; Clear removes base and drill state. This
restriction avoids pretending independent witness fields can be safely
decomposed and recombined in the client.

`ScopeBar` renders complete Source/Agent/Model `<select>` options from the
facets response, keeps an unknown pasted URL value as a temporary option, and
adds the fixed Period select. Source/Agent/Model changes preserve the drill
while overriding only that predicate, matching #46's `toggle/remove` contract.
A Period change removes the drill envelope because its server-generated date
witnesses describe the prior period. Every edit resets pagination and issues
one fresh scoped dashboard/session request.

Merge coordination is explicit: #11 owns the two new `SCOPE_KEYS` and
label/format entries plus drill-envelope helpers; #46 owns cell links,
base-filter chips and date/settings work. `ScopeChip` stays unchanged. For the
overlapping `Overview.tsx`, `Sessions.tsx`, `sessionsTable.tsx`, `scope.ts`,
`components/index.ts`, `App.test.tsx`, `components.test.tsx` and `base.css`,
the second implementation branch rebases after the first; neither plan copies
or overwrites the other's behavior.

### 4. Exact KPI and headline rendering

Refactor `KpiTile` around transport text while retaining the legacy numeric
prop for Gallery/backward compatibility during integration:

```ts
interface MetricDisplay {
  valueText: string | null
  recordedSumText: string | null
  coverage: Coverage
  comparability: MetricComparability
  reason: string
  partitions: readonly { semantics: string; valueText: string | null; coverage: Coverage }[]
}
```

Rules are pinned in component tests:

- count `0` with coverage `0/0` displays `0`;
- no known sum displays `Unavailable`, never the numeric legacy alias;
- comparable values display an abbreviation only above 99,999 and an exact
  text line without parsing/re-serialising it;
- mixed/unknown-but-known token usage displays the visible refusal reason and
  each semantics partition's exact value/coverage instead of either a pooled
  total or bare `Unavailable`;
- coverage is in the card body and repeated in the popover; and
- the `i` popover renders label, definition, formula, unit, scope, null rule,
  semantics/comparability, exact value/partitions and a link to
  `/definitions#metric-id`; the icon-only trigger keeps its accessible name
  and gains the same visible tooltip behavior as other Console icon controls.

The subordinate `HeadlineTile` uses the same exact display model but a smaller
visual treatment. Scheduled cost always shows schedule version, ordinary call
coverage, exact token-weighted priced coverage, and “estimate, not an invoice”
copy from the definition. Missing schedule/rates render the server reason.
Observed span formats its exact millisecond text into a human headline for
convenience while printing exact milliseconds below and keeping the complete
definition caveat in the tile, not only in a popover.

### 5. Three chart components and one drill path

Generalise `web/src/components/charts.tsx` to accept `ChartPoint` objects with
stable keys, display labels, exact `valueText`, approximate `plotValue`,
coverage and a `DrillEnvelopeV1`. The on-select contract becomes
`onSelect(point)`, never `onSelect(displayName)`. Exact strings drive the
tooltip, focus hint and hidden table; approximate numbers drive only SVG size.
An `AccessibleBarShape` renders each Recharts rectangle as the focusable
`role="button"` element; accessibility does not depend on `tabIndex` placed on
the `Bar` series wrapper. Every selectable rectangle has a full `aria-label`,
visible focus, and Enter/Space activation. Null results appear in the exact
table/copy as `Unavailable` and do not get a zero-length interactive bar.

1. **Activity by day (UTC).** `model_calls&group_by=started_day`; known ISO-day
   buckets are vertical bars. A null day is not plotted as a fake date. With
   no period, the `unknown_timestamps` query supplies its quality count; with a
   period, `excluded_unknown_timestamps` supplies the “N undated observations
   cannot be placed in the range” count. Activating a day stores that bucket's
   complete `drill_scope` and navigates to `/sessions`.
2. **Tokens by model.** Align `input_tokens&group_by=model` and
   `output_tokens&group_by=model` by the returned model key and semantics
   partition. Render grouped horizontal Input/Output bars for each
   model/accounting row, with no pooled mixed total and no zero-filled missing
   series. The panel header includes visible overall Input and Output usage,
   each with coverage; this is where the issue's Output tokens value renders
   `Unavailable` when coverage is zero. The mixed reason and semantics split
   controls are visible above the plot. A bar activation uses its partition
   drill scope, sets the Model selector when non-null, and keeps accounting in
   the drill chip.
3. **Tool calls.** `tool_calls&group_by=tool_name`; all returned tools render in
   server order in a contained, internally scrolling horizontal plot—no
   client top-N truncation. Activating a tool uses its returned `drill_scope`
   and navigates to matching sessions. The label remains the recorded exact
   tool name; no tool-family normalisation is introduced.

Overview calls one `activateDrill(envelope)` helper for all three charts and
the three attributable quality items. That helper writes the URL, resets
offset, and navigates to `/sessions`. There is no chart-specific session-ID
cache.

### 6. Quality strip and the reject boundary

`QualityStrip` accepts exact count text plus an optional drill envelope:

- **Missing usage** is the `missing_usage` result and drills with its effective
  returned scope.
- **Unknown timestamps** is `unknown_timestamps` without a date filter. Under
  a Period filter, the visible count is the activity query's
  `excluded_unknown_timestamps`; its List action uses an unbounded-time
  `unknown_timestamps` query under the same non-time base filters because the
  API correctly forbids `timestamp_missing` plus date bounds. The detail says
  exactly that those rows cannot be placed inside the selected range.
- **Unlinked tools** is the `unlinked_tools` result and drills with its
  returned scope.
- **Rejects** are pre-canonical source-record outcomes and cannot truthfully be
  assigned an Agent, Model, Period or session. For no scope or Source-only
  scope, load every `/api/imports` page and sum `reject_count` for matching
  import sources; label it “rejected records in matching import attempts”. If
  Agent, Model, Period or a drill is active, render
  `Unavailable — rejects cannot be attributed to this canonical scope`.
  Expanding Rejects links to `/imports`; it never offers “List these sessions”.

The strip always renders four positions. Zero is a neutral recorded result,
not a congratulatory success state. Every detail names population and reason;
the three canonical items offer `List these sessions` only when a matching
population exists.

### 7. Definitions and page states

`DefinitionsPage` fetches `/api/metrics/definitions` only. It renders one
anchored row per registry item with these columns: Metric/version, Unit/Grain,
Definition and formula, Population/scope, Null and coverage rule,
Semantics/comparability, and display/quantile rule. Caveats and
diagnostic/model-group badges are visible text. No em dash represents
unavailable metadata; optional non-applicable fields are labelled “Not
applicable”. KPI popover links land on the matching row id.

Overview has one core loading/error boundary so incompatible timestamps do not
leave stale cards beside new charts. Loading includes four KPI skeletons, two
subordinate headline skeletons, three chart placeholders, the quality line and
the session receipt. Core error replaces the metric body with one alert and
retry while the independent session preview retains its own error boundary.
An empty canonical population renders count KPIs as zero, token/cost/span
sums as Unavailable with `0/0` coverage, empty chart sentences, the four-part
quality strip, and Clear scope / Import actions. A contradictory Source/Agent/
Model combination reaches this state naturally.

The first eight session rows and the full Sessions page receive the same
resolved API scope. The scope receipt uses authoritative count text and adds
`imports_in_scope`: `N sessions · N model calls · from N imports`. Session row
input usage uses canonical text/partition state from #10, never the deprecated
numeric alias.

## Files touched

Implementation is limited to this exhaustive tracked-file set after #10 is
merged. If a reviewed change needs another file, the plan is revised before
implementation rather than silently widening the surface.

### Backend

- `backend/src/agentscope_app/application/dto.py` — typed `ScopeFacets` DTO.
- `backend/src/agentscope_app/application/ports.py` — change
  `TraceRepository.list_sessions` to take `TraceScope`.
- `backend/src/agentscope_app/application/use_cases/queries.py` — richer
  `ListSessions` scope and `ListScopeFacets` composition; pass full scope to
  summary.
- `backend/src/agentscope_app/infrastructure/db/repositories.py` — hydrate the
  session IDs and scoped row metrics selected by `TraceQuery`.
- `backend/src/agentscope_app/infrastructure/db/trace_query.py` — retain the
  existing newest-first/nulls-last session ordering while selecting IDs under
  the full metric scope.
- `backend/src/agentscope_app/interfaces/api/container.py` — wire
  `ListScopeFacets`.
- `backend/src/agentscope_app/interfaces/api/routers.py` — one shared public
  scope parser; full-scope summary/session handlers; facets route and 400
  validation.
- `backend/tests/application/test_metric_queries.py` — facet composition and
  dimension-clearing tests.
- `backend/tests/infrastructure/test_trace_query.py` — scoped session row
  ordering/count/token assertions used by the list route.
- `backend/tests/interfaces/test_api_metrics.py` — summary/facets/full-scope
  parameter and drill round-trip tests.
- `docs/api/v0.1.md` — facets response, complete summary/sessions scope list,
  period-to-date client rule, dashboard recipes and reject-attribution limit.

No metric definition, SQL view, migration or price file is changed here; those
remain #10's surface.

### Web

- `web/src/api/types.ts` — final #10 metric/definition/query types, complete
  summary, `ApiTraceScope`, `ScopeFacets`, and lossless session metric shape.
- `web/src/api/index.ts` — allowlisted scope serialization plus definitions,
  generic metric query and facets clients.
- `web/src/scope.ts` — Model/Period base keys and labels, UTC period resolver,
  validated drill envelope, API-scope resolution and drill helpers, preserving
  #46's named toggle/remove/link contract when present.
- `web/src/components/bars.tsx` — three facet selects, Period select and
  exact-text receipt; keep `ScopeChip`'s public signature and markup.
- `web/src/components/scopeLinks.tsx` — after #46 lands, append the validated
  derived drill to `ScopeChips`; preserve its base-filter and `ScopeCell`
  behavior.
- `web/src/components/primitives.tsx` — exact/mixed `KpiTile`, subordinate
  `HeadlineTile`, exact `QualityStrip`, and richer definition popovers.
- `web/src/components/charts.tsx` — exact chart points, token dual series,
  server-scope selection and accessible fallback tables.
- `web/src/components/index.ts` — production exports for the dashboard chart
  and headline components.
- `web/src/pages/Overview.tsx` — complete Console layout, resources, filters,
  drill navigation, states and first eight scoped sessions.
- `web/src/pages/Sessions.tsx` — use the resolved full API scope and exact
  receipt; retain #46's `ScopeChips` placement when merged.
- `web/src/pages/sessionsTable.tsx` — canonical exact input usage/coverage only;
  preserve #46's Source/Agent cells and date rendering when merged.
- `web/src/pages/Definitions.tsx` — registry-driven anchored definition table.
- `web/src/dashboard/dashboardData.ts` (new) — query recipe, concurrent loader,
  exact chart adapters and honest reject summary.
- `web/src/dashboard/dashboardData.test.ts` (new) — pure recipe/adaptation and
  reject-boundary tests.
- `web/src/styles/base.css` — subordinate headlines, mixed-partition KPI,
  facet controls, drill chip placement, token chart and definitions wrapping;
  Console tokens only.
- `web/src/test/fixtures.ts` — complete #10 summary, definition, bucket,
  drill-scope, facet and mixed/unavailable fixtures.
- `web/src/components/components.test.tsx` — exact KPI/headline/quality/chart,
  popover and keyboard tests.
- `web/src/App.test.tsx` — Overview/Definitions/filter/drill integration tests
  through the real router and fetch mock.

`web/src/scopeDimensions.ts` is left in place for merge compatibility but is
no longer imported by Overview/Sessions after the complete facets endpoint is
available. Issue #46 owns timestamp/settings components and the interactive
Source/Agent/Model cell implementation. `web/e2e/*` remains issue #12/#46's
surface; this issue provides the stable roles/names and API behavior they test.

## Tests

### Backend named tests

- `test_scope_facets_clear_only_their_own_dimension`: Source/Agent/Model lists
  remain complete under the other filters, omit null labels, and are stable.
- `test_summary_accepts_every_public_trace_scope_field`: a returned tool/day/
  semantics/witness scope reaches summary unchanged; `session_ids`, unknown
  keys and repeated singleton keys return `400 invalid_input`.
- `test_sessions_route_round_trips_every_metric_drill_scope`: day, model,
  semantics, tool, missing-usage, unknown-time and unlinked-tool scopes list
  exactly the session IDs selected by `metric_id=sessions` under that scope.
- `test_session_rows_use_scoped_counts_and_usage`: a cross-grain filter cannot
  leak cached all-time model/tool counts or tokens into the row.
- Existing #10 `test_day_drill_round_trip_preserves_original_tool_witness` and
  `test_returned_scopes_round_trip_after_every_grain_switch` stay green and
  are treated as contract tests, not rewritten.

### Web named tests

- `scope.ts`: `resolvePeriod` produces exact UTC half-open bounds for 7/30/90
  days; Model/Period encode and Back/Clear/reset offset correctly; a valid
  drill envelope round-trips every allowlisted field; malformed/oversized/
  session-ID envelopes are ignored; changing a base filter removes stale
  witness state.
- `dashboardData.test.ts`:
  `loadDashboard_uses_the_documented_metric_recipes_and_full_scope`,
  `mixed_tokens_keep_exact_partitions_without_a_pooled_total`,
  `null_measure_is_unavailable_not_zero`,
  `chart_geometry_never_replaces_exact_text`,
  `bucket_keys_not_labels_drive_drills`, and
  `rejects_are_unavailable_when_the_scope_cannot_attribute_them`.
- `components.test.tsx`: four KPI states (count zero, comparable exact,
  all-null unavailable, mixed partitions); definition Escape/focus return and
  registry link; scheduled-cost text coverage/version; observed-span caveat;
  quality expansion/action boundary; day/horizontal/token bars expose exact
  text to tooltip/focus/hidden table and activate with click, Enter and Space.
- `App.test.tsx`:
  `renders_four_owner_kpis_two_subordinate_headlines_and_three_charts`,
  `shows_output_tokens_or_unavailable_in_the_token_panel`,
  `source_agent_model_period_filter_every_request_and_receipt_together`,
  `day_model_semantics_and_tool_bar_clicks_open_matching_sessions`,
  `quality_drills_only_attributable_session_populations`,
  `late_old_scope_responses_never_replace_new_scope_data`,
  `core_metric_failure_never_leaves_stale_dashboard_numbers`, and
  `definitions_page_renders_every_server_definition_and_anchor`.

### Full verification

After focused tests:

```sh
uv --directory backend run ruff check src tests
uv --directory backend run ruff format --check src tests
uv --directory backend run mypy src
uv --directory backend run lint-imports
uv --directory backend run pytest -q
pnpm --dir web lint
pnpm --dir web typecheck
pnpm --dir web test
pnpm --dir web build
```

Before handoff, run the app on the imported TraceLab fixture and record a local
visual review at desktop and 900 px: four dominant cards, two quieter
headlines, exact mixed accounting splits, chart hover/focus parity, dark
theme, no document-level horizontal scroll, and chart click -> scoped session
rows. Screenshots remain untracked and go to the coordinator; no dataset or
upload is committed. Issue #12 owns the full Playwright smoke through Source
record.

## Acceptance checks mapped to the issue's tasks

| Issue task / result | Acceptance evidence |
|---|---|
| KPI tiles with coverage and definition popovers | Exactly four registry-marked KPI cards render Sessions, Model-call observations, Tool-call observations and Input usage. Component/App tests pin count-zero, unavailable and mixed states, exact text, same-element coverage, complete popover metadata and Definitions links. The token panel visibly supplies Output tokens and its unavailable state. |
| Three charts with drill-down to session list | Activity day, model/accounting token and exact tool bars come from the documented metric recipes. Each carries the server bucket/partition `drill_scope`; component tests cover mouse/keyboard and exact fallback data; API/App tests assert the resulting Sessions IDs and per-row scoped measures. |
| Filter bar wired to the query spec | Source/Agent/Model options come from `/metrics/facets`; Period resolves to tested UTC bounds; summary, every metric query, the first-eight list and full Sessions list receive the same resolved `TraceScope`. URL reload/Back/Clear and strict 400 tests pin round trips. |
| Quality strip and definitions page | Four stable items render. Missing usage, unknown timestamps and unlinked tools use registry metrics and exact session drills; Rejects names its pre-canonical attribution boundary and is unavailable under filters it cannot support. Definitions renders every `/metrics/definitions` row with all trust metadata. |
| Four KPI cards plus two headline tiles layout decision | Visual/App assertions distinguish the four primary cards from the subordinate Cost/Observed span strip; output stays in the token panel. Review of this plan is the owner checkpoint requested by `MERGED.md` section 4. |
| Exactness, coverage and unavailable rules | No canonical display consumes `Metric.value`; transport-text tests include a value above `Number.MAX_SAFE_INTEGER`; mixed totals refuse visibly; all-null is Unavailable; measured count zero stays zero; cost uses text priced coverage. |
| CI and architecture | Full backend/web command matrix is green; import-linter confirms the facets composition and scope parser introduce no dependency inversion; no e2e, data, secret, price, migration or metric-definition file is changed. |

## Risks

- **#10 is unmerged and still changing.** Its docs, Python contracts and web
  types are not currently at one committed state. Implementation starts only
  after the coordinator integrates #10. Re-check every endpoint/field listed
  in Current state; any rename or missing drill field is a compile/test failure,
  not a client fallback to legacy numbers.
- **The twelve-insight catalogue is wider than the published registry.** A
  cache reconciliation panel needs a server result that validates
  read/create/uncached accounting; tool error rate needs a known-status
  denominator; round bins need a session distribution definition. If review
  requires those Overview surfaces in #11, #10 must add those definitions and
  reference tests first. This issue will not calculate them ad hoc.
- **Four KPI wording changed after the issue was filed.** The owner decision
  makes Tool calls the third primary card and moves Output tokens into the
  token panel; Cost/Span are subordinate. The cross-review/owner approval of
  this plan is the explicit checkpoint, preventing six equal-weight cards.
- **Rejects do not share canonical scope.** The designed unavailable state
  under Agent/Model/Period is more honest than correlating rejected bytes to
  sessions. A future import-outcome metric may replace the paginated ledger
  count, but this issue does not invent one.
- **Server drill scopes are structurally complex.** A display label cannot
  reproduce witness semantics. The versioned URL envelope forwards an
  allowlisted server scope verbatim, is bounded/validated, excludes
  `session_ids`, and has round-trip tests. If review rejects an encoded
  envelope, the alternative must add first-class URL keys for every witness
  field before implementation; component state is not an acceptable fallback.
- **Issue #46 edits overlapping web files.** The named ownership contract keeps
  `ScopeChip` unchanged and assigns base-link/chip/date behavior to #46, but
  Overview/Sessions/table/test/CSS edits still require an ordered merge. The
  coordinator chooses order; the second branch rebases and reruns the full web
  suite before implementation review.
- **Many independent metric requests can partially fail or race.** One
  dashboard loader and `useResource` generation discipline make core data
  atomic per scope. Calls run concurrently; a stale generation never paints.
  If profiling shows unacceptable request/query count, add a documented batch
  endpoint in a follow-up rather than cache unlike scopes together.
- **Recharts uses floating-point geometry.** It may approximate values beyond
  safe integer range, but no label, tooltip, table, popover or request is
  derived from that approximation. Exact-string tests make that boundary
  visible.
- **Very large tool/model cardinality can make charts tall.** Do not silently
  top-N. Contain the plot with internal scrolling, keep the exact fallback
  table, and defer explicit ranked pagination until an API contract defines
  it.

## Cost estimate

Phase 1 is about 2.5-4 hours for repository/design inspection, the live #10
contract audit, #46 coordination, plan writing and commit.

Implementation after cross-review is estimated at 18-26 engineering hours:
3-5 hours for full-scope backend/session/facets wiring and tests; 3-4 hours for
web DTOs, exact adapters and scope/drill URL state; 5-7 hours for KPI/headline/
quality/definitions rendering; 4-6 hours for three accessible charts and
drill integration; and 3-4 hours for regressions, visual review and the full
CI matrix. Reserve 2-4 additional hours if #10 or #46 changes the shared
contract during review. No paid API call, network dataset, new runtime service
or dependency is required.
