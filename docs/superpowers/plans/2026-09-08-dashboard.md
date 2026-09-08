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

### Metric-layer handoff verified on merged main

Issue #10 is merged on `origin/main` at `eb92b8c` (D2-03). This branch was
rebased onto that commit before this revision, and the contracts below were
re-checked there, including the final bounded UTC day-drill behavior. The path
named in the issue brief, `application/metrics/`, does not exist; the definition
registry is actually `backend/src/agentscope_app/domain/metrics.py`, and typed
application query contracts are in
`backend/src/agentscope_app/application/metric_queries.py`.

The plan depends on these exact merged #10 contracts:

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
   `[started_from, started_before)`. The client forwards a returned drill scope
   verbatim; the server may derive the destination grain's witness fields from
   it. Rebuilding a drill from a label is not equivalent.

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

Facet options remain page-owned data. `Overview` and `Sessions` load them and
pass complete `Dimension[]` values through `useScopeBar` into the existing
`ShellApi`; `ShellContext` does not fetch, cache or invent options. An active
URL value absent from the response is added as one temporary option before the
array reaches `ScopeBar`, so a pasted deep link remains visible and selectable.

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

The SQL repository selects IDs through `TraceQuery.session_ids(scope, ...)`.
On merged #10 that method really orders by `SESSION_VIEW.id`; #11 deliberately
changes its `ORDER BY` to
`observed_start_at DESC NULLS LAST, id` before applying `limit`/`offset`, which
matches the existing list route rather than claiming the order is already
retained. It hydrates those sessions in returned order and asks
`TraceQuery.session_metrics(replace(scope, session_ids=...))` for row counts
and usage. Thus a model/tool/day/quality drill filters both which sessions are
listed and each row's model/tool/token measures; cached all-time counts never
appear beneath a narrower scope.

### 3. Shared scope and chip contract with issue #46

The coordinator settled the post-review ownership and merge order on
2026-09-08. This is the shared contract, verbatim:

#11 OWNS every change to the shared presentation files web/src/components/{primitives,charts,bars}.tsx, web/src/scope.ts (incl. SCOPE_KEYS with model and period and the drill envelope in the scope identity), web/src/shellContext.tsx and the Model cell activation on web/src/pages/Session.tsx; #46 is sequenced AFTER #11 merges and will rebase onto it, owning settings, dates, ScopeCell/ScopeChips rendering, format.ts and the number-locale migration.

For #11, that contract means:

- `SCOPE_KEYS` becomes exactly
  `['source', 'agent', 'model', 'period'] as const`; those are the four base
  keys, while the validated drill is a separate part of the same URL scope
  identity.
- #11 implements `SCOPE_LABELS`, `formatScopeValue`, `patchScope`, `toggle`,
  `remove`, `scopeHref`, and all `useScope` changes in `scope.ts`. #46 consumes
  those exports after rebasing; it does not reopen `scope.ts`.
- `patchScope(params, changes)` is the one pure URL-patch primitive. It
  preserves all untouched base keys and a valid `drill`, deletes `offset`, and
  canonicalises output. A Period change is the explicit exception: it removes
  the drill because the envelope's witnesses describe the prior period.
- The current `ScopeBar` renders the one derived drill chip through
  `ScopeChip({ label, value, onRemove })`. #11 adds the established visible
  `.has-tip`/`data-tip` treatment without changing its accessible removal name.
  After #11 merges, #46 owns the new `ScopeChips` renderer; its agreed props
  include an explicit derived-drill slot, and it builds clearing/toggling and
  `ScopeCell` links on #11's URL helpers so a base-cell action cannot drop a
  drill. The derived drill counts as active for Clear-all visibility, and
  Clear all removes both the four base keys and the drill.
- #11 makes non-null Model values in `Session.tsx` active links to
  `/sessions`, using `scopeHref` to set only `model`, keep the drill and other
  base filters, and reset pagination. Unknown model values remain non-active
  `Unavailable` text. #46's later generic `ScopeCell` may replace the markup,
  but not this behavior.
- `source`, `agent`, and `model` use those exact URL/API names. `period` is
  UI-only and is never forwarded as an unknown server parameter.

The period options are `all` (omitted), `7d`, `30d`, and `90d`. For `Nd`, with
`today = floorUTCDay(browserNow)`, `resolvePeriod` returns
`started_from = today - (N - 1) days` and
`started_before = today + 1 day`, i.e. the half-open interval covering N UTC
calendar days through the browser's current UTC day. For example, at any time
on 2026-09-08, `7d` resolves to
`[2026-09-02T00:00:00Z, 2026-09-09T00:00:00Z)`. The browser clock is the
reference; a skewed browser clock therefore changes the query. Because the URL
stores the relative token, a shared or bookmarked `?period=7d` intentionally
resolves again on a later day. The bar labels the control `Period (UTC)`, and
the receipt prints the resolved evidence, e.g.
`2026-09-02 -> 2026-09-09 UTC`, so the applied window is never implicit. Tests
pin instants immediately before and at UTC midnight and prove local timezone
does not change the result. A returned chart drill wins over the newly derived
period bounds until Period itself changes.

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

`readScope` reads and validates both the base values and the envelope.
`scopeKey` includes a stable canonical serialization of the envelope as well
as every `SCOPE_KEY`; therefore setting, replacing or removing a drill changes
the memoised scope identity and reissues every dashboard request. `scopeSearch`,
`link`, `scopeHref`, `patchScope` and `clear` likewise carry or intentionally
remove the validated envelope. This is what makes reload, Back, middle-click,
chart-to-`/sessions` navigation and a session-detail return path retain the
exact scope.

`useScope()` exposes `drill`, `setDrill(envelope)` and `removeDrill()`. The
envelope is JSON encoded by `URLSearchParams` under `drill`, size-limited and
strictly allowlisted on read; malformed/unknown versions are ignored rather
than forwarded. API calls start from the envelope's scope when present, then
overlay the current Source/Agent/Model base values and clear their mutually
exclusive unknown flags; removing its one chip restores the four base filters.
This is still one URL-owned scope and one chip component—there is no
component-local drill state or alternate filtering API.

Only one chart/quality drill envelope is active at a time in v0.1. A new drill
replaces the old envelope with the new server-returned scope, which already
contains the old predicates where they remain applicable. The chip therefore
describes the latest drill step; Clear removes base and drill state. This
restriction avoids pretending independent witness fields can be safely
decomposed and recombined in the client.

`ScopeBar` renders complete Source/Agent/Model `<select>` options from the
facets response, keeps an unknown pasted URL value as a temporary option, and
adds the fixed Period select. Source/Agent/Model changes preserve the drill
while overriding only that predicate, matching the shared `toggle/remove`
contract.
A Period change removes the drill envelope because its server-generated date
witnesses describe the prior period. Every edit resets pagination and issues
one fresh scoped dashboard/session request.

All exact dashboard text and shared component signatures land in #11 first.
#46 then rebases onto the #11 merge and performs its settings/date,
`ScopeCell`/`ScopeChips`, and remaining number-locale work through those
interfaces. In particular, #46 never locale-formats a transport exact-text
line. There is no unordered "second branch" merge and no parallel edit to a
shared presentation file.

The #11 amendment to ADR-006 records both owner-approved structural decisions:
four primary KPI cards plus two subordinate headline tiles, and the versioned
`drill` URL envelope as the single carrier of a validated server-returned scope.
It states the base-filter overlay rule once and makes clear that the envelope
is part of the one global URL scope, not component state or a second drill
mechanism. #46's later settings amendment must append to, not rewrite, this
decision.

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

The canonical abbreviation is produced from the decimal string by a
dashboard-local `abbreviateDecimalText` helper (integer/decimal-string
arithmetic, including values above `Number.MAX_SAFE_INTEGER`); the exact line
always prints `valueText` verbatim. #11 does not route authoritative text
through `format.ts`'s numeric `abbreviate`. Per the coordinator contract,
#46 owns `format.ts` and the later locale migration for non-authoritative
generic numbers.

For input/output usage, the definition popover also includes the
`cache_read_tokens` result and its coverage/reason. It renders `Unavailable`
outside the supported accounting semantics rather than silently omitting the
capability.

The subordinate `HeadlineTile` uses the same exact display model but a smaller
visual treatment. Scheduled cost always shows schedule version, ordinary call
coverage, exact token-weighted priced coverage, and “estimate, not an invoice”
copy from the definition. The shipped TraceLab fixture's raw model IDs do not
match the namespaced schedule keys. That model-id repair is filed as D2-03b and
is out of #11; the tile therefore renders `Unavailable` and the visible reason
exactly `no rate for this model id`. #11 neither aliases model IDs nor changes
the schedule. The popover still carries the server's aggregate priced coverage,
schedule version and definition caveat.
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
   buckets are vertical bars. A null day is not plotted as a fake date; when
   present, its exact result and returned `drill_scope` feed the quality strip.
   Under a period, `excluded_unknown_timestamps` supplies the “N undated
   observations cannot be placed in the range” count and an unbounded
   `unknown_timestamps` query provides the matching action scope. Activating a
   day stores that bucket's
   complete `drill_scope` and navigates to `/sessions`. The chart renders every
   returned day in server order. Fourteen bars fit the normal viewport; longer
   all-time ranges get a width derived from bar count inside a horizontally
   scrolling panel, with no document overflow or silent top-N/truncation. The
   hidden exact table remains complete.
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
- **Unknown timestamps** uses the activity query's null-day bucket as the
  authoritative displayed count and List scope whenever that bucket exists.
  Under a Period filter, where a null bucket cannot be inside the range, the
  authoritative displayed count is `excluded_unknown_timestamps`; the client
  separately loads `unknown_timestamps` without direct date bounds but under
  the same non-time base/drill predicates because the API correctly forbids
  `timestamp_missing` plus date bounds. The List action is enabled only when
  that result's exact count equals `excluded_unknown_timestamps`, and then uses
  the result's returned effective scope verbatim. If the two server
  computations diverge under a witness-heavy drill, the strip keeps the
  excluded count, disables List and says that the undated population cannot be
  reconciled to a session list under the active drill. It never opens a
  differently sized population. The ordinary period detail says exactly that
  those rows cannot be placed inside the selected range.
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

The broader source-by-capability matrix and its third `Unprofiled` state are
explicitly deferred: merged #10 exposes metric coverage/reasons but no
source-by-capability contract, and issue #11's accepted surface is the four-item
quality strip. This plan will not infer `Unprofiled` from absence. A follow-up
must first define that server result; until one is filed, the omission remains
visible in Risks rather than being silently claimed complete.

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

`ReceiptValues` becomes
`{ sessionsText?: string | null; modelCallsText?: string | null; importsText?: string | null; resolvedPeriodText?: string | null }`.
`ScopeReceipt` prints those strings verbatim and appends the resolved UTC range;
`App.tsx` passes the renamed props explicitly rather than spreading a
number-shaped object. `useScopeBar` and `ShellApi` continue carrying the typed
receipt and page-owned facet dimensions; they do not convert either one.

## Files touched

Implementation is limited to this exhaustive tracked-file set on merged #10.
The ownership annotation also records one forced downstream file that #11 must
design around but, by coordinator decision, must not edit. If a reviewed change
needs another file, the plan is revised before implementation rather than
silently widening the surface.

### Backend

- `backend/src/agentscope_app/application/dto.py` — typed `ScopeFacets` DTO.
- `backend/src/agentscope_app/application/ports.py` — change
  `TraceRepository.list_sessions` to take `TraceScope`.
- `backend/src/agentscope_app/application/use_cases/queries.py` — richer
  `ListSessions` scope and `ListScopeFacets` composition; pass full scope to
  summary.
- `backend/src/agentscope_app/infrastructure/db/repositories.py` — hydrate the
  session IDs and scoped row metrics selected by `TraceQuery`.
- `backend/src/agentscope_app/infrastructure/db/trace_query.py` — change the
  current ID-ascending `session_ids` order to observed-start descending,
  nulls-last, ID tie-break order before stable pagination.
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

No metric definition, SQL view, migration or price file is changed here; those
remain #10's surface. The fixture/schedule model-ID mismatch is D2-03b, not a
reason to edit price data in #11.

### Web

- `web/src/api/types.ts` — final #10 metric/definition/query types, complete
  summary, `ApiTraceScope`, `ScopeFacets`, and lossless session metric shape.
- `web/src/api/index.ts` — allowlisted scope serialization plus definitions,
  generic metric query and facets clients.
- `web/src/api/index.test.ts` — exact repeated-dimension and public-scope query
  serialization, including refusal of `session_ids`.
- `web/src/scope.ts` — Model/Period base keys and labels, UTC period resolver,
  canonical drill-bearing identity, URL patch/link helpers and API-scope
  resolution that #46 consumes after rebasing.
- `web/src/scope.test.ts` (new) — pure period, URL identity, patch/preservation,
  malformed-envelope and pagination-reset tests.
- `web/src/shellContext.tsx` — authoritative-text `ReceiptValues`; facet
  dimensions continue to travel through `ShellApi`.
- `web/src/App.tsx` — pass the renamed receipt fields explicitly to
  `ScopeReceipt`.
- `web/src/components/bars.tsx` — three facet selects, Period select and
  exact-text/resolved-period receipt; render the derived drill chip and add its
  visible tooltip while keeping the leaf's public signature/accessibility.
- `web/src/components/primitives.tsx` — exact/mixed `KpiTile`, subordinate
  `HeadlineTile`, exact `QualityStrip`, and richer definition popovers.
- `web/src/components/charts.tsx` — exact chart points, token dual series,
  server-scope selection and accessible fallback tables.
- `web/src/components/index.ts` — production exports for the dashboard chart
  and headline components.
- `web/src/pages/Overview.tsx` — complete Console layout, resources, filters,
  drill navigation, states and first eight scoped sessions.
- `web/src/pages/Sessions.tsx` — use the resolved full API scope and exact
  receipt and preserve drill state in navigation.
- `web/src/pages/sessionsTable.tsx` — canonical exact input usage/coverage only;
  expose stable cell contracts for #46's later Source/Agent/date work.
- `web/src/pages/Session.tsx` — activate non-null Model cells with #11's
  scope-preserving `/sessions` link behavior.
- `web/src/pages/Definitions.tsx` — registry-driven anchored definition table.
- `web/src/pages/Gallery.tsx` — adapt gallery KPI/chart examples to the new
  text and `onSelect(point)` contracts so development typechecking stays green.
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
- `web/e2e/smoke.spec.ts` — update registry-label locators, select/deep-link
  behavior and real TraceLab fixture assertions for comparable counts and
  non-comparable token partitions.

### Documentation and sequenced dependency

- `docs/api/v0.1.md` — facets response, complete summary/sessions scope list,
  period-to-date client rule, dashboard recipes and reject-attribution limit.
- `docs/adr/ADR-006-ui-design-direction.md` — record four primary KPI cards plus
  two subordinate headlines and the versioned URL drill envelope as the single
  carrier of an allowlisted server-returned scope.
- `web/src/format.ts` — forced by the cross-plan number audit but **not edited by
  #11**. #11 uses its dashboard-local decimal-text abbreviation; #46 owns this
  file and rebases afterward to perform the generic number-locale migration.

`web/src/scopeDimensions.ts` is left in place for merge compatibility but is
no longer imported by Overview/Sessions after the complete facets endpoint is
available. `web/src/shellHooks.ts` needs no edit: its existing typed
`useScopeBar(dimensions, receipt, loading)` already transports the revised
`ReceiptValues` and `Dimension[]`. #46 owns settings, dates, `ScopeCell` and
`ScopeChips` rendering after it rebases; #11 owns the Model activation behavior
that the later renderer must preserve. The listed smoke spec is in #11 scope;
the rest of issue #12's end-to-end expansion is not.

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
- `test_session_ids_order_and_offset_are_stable`: #11's changed
  `TraceQuery.session_ids` orders by `observed_start_at DESC NULLS LAST, id`,
  and concatenating offset pages reproduces that exact order without gaps or
  duplicates. All merged #10 `session_ids` tests in
  `backend/tests/infrastructure/test_trace_query.py` must still pass after
  their ID-order expectations are deliberately updated.
- `test_session_rows_use_scoped_counts_and_usage`: a cross-grain filter cannot
  leak cached all-time model/tool counts or tokens into the row.
- `test_unknown_timestamp_count_equals_the_population_its_list_action_opens`:
  compare the null-day/excluded count with the returned unknown-time drill
  population for no scope, Period only, Source+Period and an active drill.
- Existing #10 `test_day_drill_round_trip_preserves_original_tool_witness` and
  `test_returned_scopes_round_trip_after_every_grain_switch` stay green and
  are treated as contract tests, not rewritten.

### Web named tests

- `scope.test.ts`: `resolvePeriod` produces the literal N-day UTC half-open
  bounds for 7/30/90 days at instants immediately before/at midnight and is
  local-zone independent; Model/Period encode and Back/Clear/reset offset
  correctly; a valid drill envelope round-trips every allowlisted field;
  malformed/oversized/session-ID envelopes are ignored;
  `clearing_a_base_filter_keeps_the_drill_and_a_period_change_removes_it`; and
  `patchScope`/`scopeHref` preserve the drill on chart-to-sessions links.
- `dashboardData.test.ts`:
  `loadDashboard_uses_the_documented_metric_recipes_and_full_scope`,
  `mixed_tokens_keep_exact_partitions_without_a_pooled_total`,
  `null_measure_is_unavailable_not_zero`,
  `chart_geometry_never_replaces_exact_text`,
  `bucket_keys_not_labels_drive_drills`, and
  `rejects_are_unavailable_when_the_scope_cannot_attribute_them`.
- `components.test.tsx`: four KPI states (count zero, comparable exact,
  all-null unavailable, mixed partitions); definition Escape/focus return and
  registry link; cache-read result/reason;
  `scheduled_cost_is_unavailable_with_zero_priced_coverage_and_the_server_reason`
  pins visible `no rate for this model id`; observed-span caveat; quality
  expansion/action boundary; day/horizontal/token bars expose exact text to
  tooltip/focus/hidden table and activate with click, Enter and Space.
- `App.test.tsx`:
  `renders_four_owner_kpis_two_subordinate_headlines_and_three_charts`,
  `shows_output_tokens_or_unavailable_in_the_token_panel`,
  `source_agent_model_period_filter_every_request_and_receipt_together`,
  `day_model_semantics_and_tool_bar_clicks_open_matching_sessions`,
  `a_drill_change_reissues_every_dashboard_request`,
  `tool_and_day_drills_keep_cross_grain_dashboard_totals_consistent`,
  `session_model_cell_opens_sessions_with_the_full_scope`,
  `quality_drills_only_attributable_session_populations`,
  `late_old_scope_responses_never_replace_new_scope_data`,
  `core_metric_failure_never_leaves_stale_dashboard_numbers`, and
  `definitions_page_renders_every_server_definition_and_anchor`.

### End-to-end fixture smoke

`web/e2e/smoke.spec.ts` remains a serial real-browser import smoke and is part
of #11. Its dashboard assertions use `Sessions`, `Model-call observations`,
`Tool-call observations`, and `Input usage by accounting group`, and retain
the comparable fixture totals: 80 sessions, 4,770 model-call observations and
5,723 tool-call observations. The spec's `TOTALS`/response helper reads
authoritative `value_text`/partition fields rather than legacy numeric aliases.
The mixed input-token total `553,447,877` is a
reference arithmetic sum across two non-comparable accounting groups, so the
smoke intentionally refuses it as a KPI value and negatively asserts it is not
rendered there. Instead it asserts the reason
`not comparable: 2 token semantics in selection`, the exact
`tracelab-claude` partition `186,454,781` with coverage 1,583 / 1,583 calls,
and the exact `tracelab-codex` partition `366,993,096` with coverage
3,187 / 3,187 calls. The filter path uses `selectOption`; a separate pasted
unknown-value deep link proves that a temporary option survives navigation.
The chart drill assertion proves the encoded envelope changes requests and is
still present after chart -> Sessions -> Session -> Sessions navigation.

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
pnpm --dir web e2e
```

Before handoff, run the app on the imported TraceLab fixture and record a local
visual review at desktop and 900 px: four dominant cards, two quieter
headlines, exact mixed accounting splits, chart hover/focus parity, dark
theme, no document-level horizontal scroll, and chart click -> scoped session
rows. The Scheduled-cost headline is inspected in its expected fixture state:
`Unavailable`, zero priced coverage, and visible reason
`no rate for this model id`. Screenshots remain untracked and go to the
coordinator; no dataset or upload is committed. #11 owns the dashboard/scope
updates to the existing Playwright smoke; issue #12 owns further journey
expansion beyond that spec.

## Acceptance checks mapped to the issue's tasks

| Issue task / result | Acceptance evidence |
|---|---|
| KPI tiles with coverage and definition popovers | Exactly four registry-marked KPI cards render Sessions, Model-call observations, Tool-call observations and Input usage. Component/App tests pin count-zero, unavailable and mixed states, exact text, same-element coverage, complete popover metadata and Definitions links. The token panel visibly supplies Output tokens and its unavailable state. |
| Three charts with drill-down to session list | Activity day, model/accounting token and exact tool bars come from the documented metric recipes. Each carries the server bucket/partition `drill_scope`; component tests cover mouse/keyboard and exact fallback data; API/App tests assert the resulting Sessions IDs and per-row scoped measures. |
| Filter bar wired to the query spec | Source/Agent/Model options come from `/metrics/facets`; Period resolves to tested UTC bounds; summary, every metric query, the first-eight list and full Sessions list receive the same resolved `TraceScope`. URL reload/Back/Clear and strict 400 tests pin round trips. |
| Quality strip and definitions page | Four stable items render. Missing usage, unknown timestamps and unlinked tools use registry metrics and exact session drills; Rejects names its pre-canonical attribution boundary and is unavailable under filters it cannot support. Definitions renders every `/metrics/definitions` row with all trust metadata. |
| Four KPI cards plus two headline tiles layout decision | Visual/App assertions distinguish the four primary cards from the subordinate Cost/Observed span strip; output stays in the token panel. Review of this plan is the owner checkpoint requested by `MERGED.md` section 4. |
| Exactness, coverage and unavailable rules | No canonical display consumes `Metric.value`; transport-text tests include a value above `Number.MAX_SAFE_INTEGER`; mixed totals refuse visibly; all-null is Unavailable; measured count zero stays zero; cost uses text priced coverage. |
| Real-fixture smoke | Playwright asserts 80 sessions, 4,770 model calls and 5,723 tool calls; refuses `553,447,877` as a mixed KPI value; and asserts the two exact accounting partitions, coverages and refusal reason. It also exercises selects, an unknown pasted option and drill-preserving chart-to-session navigation. |
| CI and architecture | Full backend/web command matrix, including `pnpm --dir web e2e`, is green; import-linter confirms the facets composition and scope parser introduce no dependency inversion; no data, secret, price, migration or metric-definition file is changed. |

## Risks

- **#10 drift after merge.** This plan is based on merged main at `eb92b8c`.
  Any later endpoint/field rename or missing drill field is a compile/test
  failure, not a client fallback to legacy numbers.
- **The twelve-insight catalogue is wider than the published registry.** A
  cache reconciliation panel needs a server result that validates
  read/create/uncached accounting; tool error rate needs a known-status
  denominator; round bins need a session distribution definition; MERGED
  section 1.5's excluded cost-component volumes need a result field; and the
  capability matrix needs a source-by-capability contract with an explicit
  `Unprofiled` state. #11 renders the aggregate priced coverage and the
  definition caveat, which names Codex prefix, cache creation and reasoning,
  but does not compute excluded component volumes or capability states
  client-side. Follow-up server contracts must land before those surfaces.
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
- **Issue #46 is sequenced, not parallel on shared files.** #11 owns all shared
  presentation/scope edits and the Session Model activation, then merges.
  #46 rebases onto it and owns settings, dates, `ScopeCell`/`ScopeChips`,
  `format.ts` and the number-locale migration. Its full web/e2e suite must prove
  that later rendering preserves #11's drill identity and exact-text contract.
- **Scheduled cost is expected to be unavailable on the fixture.** Raw fixture
  model IDs do not match schedule keys. D2-03b owns that mismatch; #11 shows
  `Unavailable` plus `no rate for this model id`, never aliases a model or
  fabricates cost. D2-03b also owns the stale `docs/api/v0.1.md` statement that
  a production snapshot is DNS-blocked even though the schedule file is now
  committed; #11 does not fold that unrelated correction into its API docs
  edit.
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

The merged #10 gate is closed as of 2026-09-08. After adding the forced files,
real-fixture smoke, ADR amendment, scope-identity work and ordering change, the
#11 implementation estimate is **23-32 engineering hours**: 5-7 hours for
full-scope backend/session/facets wiring and tests; 4-5 hours for web DTOs,
exact adapters, shell receipt and scope/drill URL state; 6-8 hours for KPI,
headline, quality, definitions and chart presentation; 4-6 hours for page and
drill integration including the Session Model cell; and 4-6 hours for focused
tests, Playwright, visual review, docs and the full verification matrix. Reserve
3-5 hours for review fixes; there is no #10 contract reserve now that
`eb92b8c` is merged.

### Dated critical path to the 2026-09-11 sprint end

- **2026-09-08:** #10 merge verified; this review revision and the #11/#46
  ownership contract are committed. Begin the full-scope backend, scope
  identity and exact DTO work only after plan approval.
- **2026-09-09:** finish backend ordering/facets/routes and scope/shell tests;
  land the exact presentation primitives and dashboard data adapters.
- **2026-09-10:** integrate Overview, Sessions, Session Model activation,
  charts, quality and Definitions; update Gallery/unit/App tests and the real
  Playwright smoke. Run the complete matrix and target #11 merge by end of day.
- **2026-09-11:** #46 rebases onto the merged #11 contract. Reserve the day for
  combined #11/#46 acceptance, 1280/1920/900 visual checks, Playwright and
  review fixes; #46 must not bypass the rebase by duplicating shared changes.

This schedule has no slack at the high end of the estimate. If #11 slips, cut
in this order and only at a coordinator checkpoint: (1) defer the facets
endpoint and temporarily feed the selects from `scopeDimensions.ts` while
retaining pasted values; (2) defer the two subordinate headline tiles,
including the expected unavailable cost tile; (3) reduce the Definitions table
to the required definition/unit/semantics/comparability/coverage fields while
keeping the complete response accessible in disclosure. Never cut exact-text
rendering, drill identity/navigation, session ordering, accessibility, the
four KPI/three-chart/quality-strip core, or the updated e2e assertions. If those
cuts do not preserve a green #11 by 2026-09-10, #46 moves beyond the sprint;
the merge order is not relaxed. No paid API call, network dataset, new runtime
service or dependency is required.

## Revision after review

This revision answers the Claude-side BLOCK against merged main at `eb92b8c`.
Finding numbers below match
`docs/superpowers/plans/2026-09-08-dashboard-review-claude.md`.

1. **P1 — accepted.** `web/e2e/smoke.spec.ts` is now in #11's exhaustive
   surface and `pnpm --dir web e2e` is in Full verification. The smoke moves to
   the four registry labels, uses `selectOption`, covers a pasted unknown URL
   value, retains 80 / 4,770 / 5,723, and replaces the invalid mixed-token
   assertion with the two exact accounting partitions, their coverages, the
   refusal reason and a negative KPI assertion for `553,447,877`.
2. **P1 — accepted.** `readScope`, `scopeKey`, `scopeSearch`, `patchScope`,
   `scopeHref`, `link` and `clear` now explicitly carry the canonical validated
   drill. The drill is part of the memoised identity, so changing/removing it
   refetches the dashboard and chart-to-sessions/detail navigation retains it.
   The named request-reissue test is included.
3. **P1 — accepted with the coordinator's final boundary.** The contract
   section contains the coordinator decision verbatim. #11 owns all changes to
   `primitives.tsx`, `charts.tsx`, `bars.tsx`, `scope.ts`, `shellContext.tsx`
   and the `Session.tsx` Model activation. #46 is explicitly after #11 and
   rebases to add settings, dates, `ScopeCell`/`ScopeChips`, `format.ts` and
   locale migration without rewriting exact transport text.
4. **P1 — accepted.** The exhaustive surface now accounts for all six forced
   files: `shellContext.tsx`, `App.tsx`, `Gallery.tsx`, `smoke.spec.ts`,
   `format.ts`, and ADR-006. It also adds the coordinator-required
   `Session.tsx`, `api/index.test.ts` and the new `scope.test.ts`. The list
   names the receipt shape and the page -> `useScopeBar` -> `ShellApi` facet
   path. `format.ts` is listed as a forced sequenced dependency but is not
   edited by #11 because the coordinator assigned it to #46; #11 uses a
   decimal-text helper instead.
5. **P2 — accepted under the settled ownership.** #11 supplies the single pure
   `patchScope` primitive and drill-preserving toggle/remove/href behavior;
   #46's later `ScopeCell` and `ScopeChips` rendering must consume it and accept
   the explicit derived-drill slot. The requested base-clear/period-change test
   is named.
6. **P2 — accepted.** The plan now says `TraceQuery.session_ids` currently
   orders by ID and that #11 changes it to
   `observed_start_at DESC NULLS LAST, id` before pagination. A stable
   order/offset test is named, and the merged #10 test file must remain green
   with deliberately updated order expectations.
7. **P2 — accepted.** The N-day formula, browser clock, moving bookmark
   consequence, exclusive upper bound and visible resolved receipt are literal
   in the scope design. Tests cover before/at UTC midnight and local-zone
   independence.
8. **P2 — resolved by coordinator decision.** The schedule-key/model-ID
   mismatch is outside #11 and filed as D2-03b. The Scheduled-cost tile keeps
   its subordinate slot, renders `Unavailable` with zero priced coverage and
   the visible reason `no rate for this model id`, and is pinned in component
   and manual visual checks. #11 does not alias IDs or edit price data; D2-03b
   also owns the stale API-doc snapshot/DNS sentence noted by the review.
9. **P2 — accepted.** The existing real-fixture Playwright smoke is the
   automated oracle: comparable totals remain 80 sessions, 4,770 model calls
   and 5,723 tool calls; mixed tokens are checked through exact partitions and
   refusal semantics, including the negative pooled-total assertion.
10. **P2 — accepted.** The null-day bucket is authoritative when present. Under
    Period, `excluded_unknown_timestamps` is authoritative and the List action
    is offered only if the separately returned unknown-time population has the
    same exact count; otherwise the UI explains the mismatch and opens no
    differently sized list. The four requested scope cases are named in the
    backend test.
11. **P2 — accepted.** MERGED section 1.5's excluded-component volumes are now
    an explicit server-contract gap. #11 shows aggregate priced coverage and
    the registry caveat, and never reconstructs component volumes in the
    browser.
12. **P2 — accepted.** ADR-006 is in the file list and gets an amendment for
    the four-KPI/two-headline structure and the versioned envelope as part of
    the one global URL scope, including its base-filter precedence.
13. **P2 — accepted.** The estimate is revised to 23-32 engineering hours plus
    3-5 hours of review reserve. The dated path covers the merged #10 gate and
    2026-09-08 contract, targets #11 merge on 2026-09-10, reserves 2026-09-11
    for #46 rebase/combined acceptance, lists optional cuts in order, and never
    trades away exactness or e2e coverage. It also states when #46 must move
    beyond the sprint instead of violating the merge order.
14. **P3 — accepted.** The stale round-trip claim is replaced with the actual
    contract: the client forwards a returned scope verbatim and the server
    derives destination-grain witnesses. The named App test covers internally
    consistent cross-grain totals under one tool drill and one day drill.
15. **P3 — partially accepted.** Cache-read tokens are added to the token
    popover, and the activity null-day bucket's own returned scope drives the
    quality action when available. The capability-matrix expansion is declined
    for #11: merged #10 has no source-by-capability/`Unprofiled` result, and
    inferring it from missing rows would violate the trust rule. The gap is now
    explicit in Design and Risks and requires a server-contract follow-up.
16. **P3 — accepted.** The stale sibling-worktree references are replaced by
    merged `eb92b8c`, while retaining the useful correction that
    `application/metrics/` does not exist. Activity by day now renders every
    returned bucket in a contained horizontally scrolling plot above the
    normal 14-bar width, with no top-N and a complete hidden table.
