# Cross-review (Claude) of the #11 dashboard plan

**BLOCK**

Reviewed in the order the brief sets out: the working brief, issue #11, `research/insights/MERGED.md`
(§1.1–§1.6, §4), `docs/adr/ADR-006-ui-design-direction.md`,
`research/design/claude/3-console/README.md`, the plan
(`docs/superpowers/plans/2026-09-08-dashboard.md`, 682 lines), the #10 metric layer read-only at
`/Users/sean/dev/AgentScope-wt/10` (branch `feat/10-metric-layer`, HEAD `0f3f39b`), the sibling #46
plan and its Codex review at
`/Users/sean/dev/AgentScope/.claude/worktrees/agent-ac64bf813ff286a75/docs/superpowers/plans/`,
and the current web code in this worktree (`feat/11-dashboard`, HEAD `c9342c5`).

This is a pre-implementation review. No file outside this one was modified; no git write, no build,
no browser run. `Plan:N` means a line of `docs/superpowers/plans/2026-09-08-dashboard.md`.

The plan's reading of the #10 contract is unusually accurate — I verified every endpoint, field,
scope key and recipe it names and found only one substantive mis-statement (finding 6) and one
over-claim (finding 14). What blocks it is not the metric layer: it is that the plan will turn CI
red on a file it declares out of scope, that the drill it invents is not part of the scope identity
that drives every fetch, that its "exhaustive" file list is not exhaustive, and that its
coordination contract with #46 was written against a version of the #46 plan that its own reviewer
has since blocked. All of these are fixable in the plan document; none needs a new design.

---

## Findings

### 1. [P1] The plan breaks `web/e2e/smoke.spec.ts`, disclaims the file, and omits `pnpm --dir web e2e` from its verification matrix

**Where:** Plan:538–539 ("`web/e2e/*` remains issue #12/#46's surface"), Plan:588–602 (Full
verification), Plan:622 ("CI and architecture … no e2e … file is changed").

**What is wrong.** Three of the plan's central, correct changes each break an assertion that runs
today in CI:

- `web/e2e/smoke.spec.ts:145–155` asserts on `/overview`:
  `getByRole('region', { name: 'Input tokens' })` containing `'553.4M'`, `'exact 553,447,877'` and
  `'coverage 4,770 / 4,770 calls'`, plus `getByRole('region', { name: 'Model calls' })` →
  `'4,770'` and `{ name: 'Tool calls' }` → `'5,723'`. The plan renames those cards to the registry
  labels — `domain/metrics.py:264–268` gives `input_tokens` the label
  *"Input usage by accounting group"*, `model_calls` *"Model-call observations"*, `tool_calls`
  *"Tool-call observations"* — so all four `getByRole('region', …)` locators stop matching. The
  KPI's accessible name is `label` (`primitives.tsx:169`).
- The `553.4M` / `exact 553,447,877` assertions pass today only because `KpiTile` renders the
  deprecated numeric `Metric.value` (`primitives.tsx:163–165`, `dto.py:224`). `docs/api/v0.1.md:424`
  states plainly: *"On the TraceLab fixture the default input-token total is mixed"*, and
  `domain/metrics.py:249–254` makes `value_text` null for `mixed`. The plan's §4 rule
  ("mixed/unknown-but-known token usage displays the visible refusal reason and each semantics
  partition's exact value") therefore **must** stop rendering `553,447,877`. That is the right
  behaviour and it fails the existing spec.
- `smoke.spec.ts:172–176` does `getByLabel('Agent').fill('codex')` and `:196` asserts
  `toHaveValue('codex')` after a deep link. Plan:310 replaces the `ScopeInput` text/datalist
  (`bars.tsx:15–28`) with `<select>` elements; Playwright's `fill()` throws on a `<select>`, and the
  deep-link assertion depends on the "unknown pasted URL value as a temporary option" behaviour the
  plan mentions but does not pin.
- `smoke.spec.ts:207` asserts the popover trigger named `Definition of Input tokens`; the label
  change moves it too.

The plan's Full verification block runs `lint`, `typecheck`, `test` and `build` but **not**
`pnpm --dir web e2e`, which the working brief lists as a CI job that must be green before a PR is
opened. That omission is why the breakage is not visible in the plan.

**Evidence checked:** `web/e2e/smoke.spec.ts:12, 145–155, 172–176, 196, 205–209`;
`web/src/components/primitives.tsx:150–166, 169`; `web/src/components/bars.tsx:15–28`;
`backend/src/agentscope_app/domain/metrics.py:249–254, 264–268`;
`/Users/sean/dev/AgentScope-wt/10/docs/api/v0.1.md:424`; BRIEF.md line 15.

**Change required.** Add `web/e2e/smoke.spec.ts` to Files touched and `pnpm --dir web e2e` to the
verification matrix. Update the spec's `TOTALS`/assertions in the same commit as the KPI change:
assert the four registry labels, assert the two partition values `186,454,781` and `366,993,096`
with their coverages and the reason `not comparable: 2 token semantics in selection`, assert that
`553,447,877` does **not** appear as a KPI value, and replace `fill()`/`toHaveValue` with
`selectOption` plus an explicit deep-link-with-unknown-value case. Coordinate the edit with #12/#46
through the coordinator; do not leave the file to another issue while changing what it asserts.

---

### 2. [P1] The drill envelope is not part of the scope identity, so a drill will never refetch

**Where:** Plan:282–301 (`DrillEnvelopeV1`, `useScope()` gains `drill`/`setDrill`/`removeDrill`),
Plan:294–296 ("`scopeSearch` and `link` preserve it").

**What is wrong.** Every dashboard fetch is keyed on the memoised scope object, and that object's
identity comes from `scopeKey`, which enumerates `SCOPE_KEYS` only:

```ts
// web/src/scope.ts:26–30
export const scopeKey = (scope: ScopeValues) => {
  const params = new URLSearchParams()
  for (const key of SCOPE_KEYS) params.set(key, scope[key] ?? '')
  return params.toString()
}
// :40–42
const key = scopeKey(readScope(params))
const scope = useMemo(() => readScope(new URLSearchParams(key)), [key])
```

`Overview.tsx:21–22` then does `useResource(useCallback(() => …, [scope]))`. `drill` is a fifth URL
parameter that is deliberately **not** a `SCOPE_KEY` (Plan:254), so setting, changing or removing a
drill leaves `key` identical, leaves `scope` referentially identical, and leaves every
`useCallback`/`useResource` dependency unchanged. The URL changes, the chip renders, and not one
request is reissued. The plan never mentions `scopeKey`, `readScope` or the memo.

The same gap hits `scopeSearch` (`scope.ts:33–37`) and `link` (`scope.ts:69`), which build a query
string from `SCOPE_KEYS` alone and therefore drop `drill` on any navigation — including the
chart→`/sessions` navigation that is the issue's core acceptance path. Plan:294 asserts they
preserve it; today they cannot, and the plan does not say they are changed.

**Evidence checked:** `web/src/scope.ts:16–72`; `web/src/pages/Overview.tsx:20–24`;
`web/src/useResource.ts` usage in `Overview.tsx`/`Sessions.tsx`.

**Change required.** State explicitly that `readScope`, `scopeKey`, `scopeSearch`, `link` and
`clear` are all extended to carry the validated `drill` value, that `scopeKey` includes the
canonicalised envelope so the resource identity changes, and add the named test
`a_drill_change_reissues_every_dashboard_request` alongside the existing round-trip tests at
Plan:562–565.

---

### 3. [P1] The §3 ownership contract with #46 is written against a plan its own reviewer has blocked, and model cells belong to nobody

**Where:** Plan:250–271 and Plan:318–324 ("`ScopeChip` stays unchanged", "the second implementation
branch rebases after the first").

**What is wrong.** Two disagreements, both concrete:

1. **The "untouched" files are no longer untouched.** #11 assumes #46 does not edit
   `primitives.tsx`, `charts.tsx` or `bars.tsx` — which is what the #46 plan says
   (`2026-09-08-tables-dates-settings.md:559–562`). But the Codex review of that plan
   (`2026-09-08-tables-dates-settings-review-codex.md`) is **BLOCK**, and its P1 #1 requires #46 to
   migrate hard-coded `toLocaleString('en-US')` at exactly `components/primitives.tsx:150,158–166`
   (KPI exact value and coverage) and `components/charts.tsx:17,23,45,68` (tooltip, hidden table,
   focus hint), while its P2 #12 requires #46 to **change `ScopeChip`'s implementation** to the
   `.has-tip`/`data-tip` visible-tooltip pattern and add `bars.tsx` to its touched files. Those are
   the same lines #11 rewrites wholesale. "Neither plan copies or overwrites the other's behavior"
   (Plan:323) is no longer true, and "keeps `ScopeChip` unchanged" (Plan:651) is contradicted by
   #46's required fix.
2. **Model cells.** #46's contract table (`…tables-dates-settings.md:148`) states: *"`<ScopeCell
   dimension value target? />` … **#46**. The only way a table cell becomes a filter. **#11's Model
   column uses it with `dimension="model"` and needs no new code.**"* #11's plan has no Model column
   anywhere: `sessionsTable.tsx` has no model column (sessions have no single model), and the plan's
   only model affordances are the ScopeBar select and the Tokens-by-model bar. The one real model
   cell in the app is `web/src/pages/Session.tsx:36` (`display(call.model)` in the model-call table),
   which neither plan converts and which #11 does not list in Files touched. Codex's review of #46
   raised the same gap (its P1 #3).

**Evidence checked:** `2026-09-08-tables-dates-settings.md:132–153, 546–562`;
`2026-09-08-tables-dates-settings-review-codex.md` findings 1, 3, 12;
`web/src/components/primitives.tsx:150–166`; `web/src/components/charts.tsx:17, 23, 45, 68`;
`web/src/components/bars.tsx:45–46`; `web/src/pages/sessionsTable.tsx`; `web/src/pages/Session.tsx`.

**Change required.** Re-agree §3 against the *post-review* #46 plan, not the pre-review one, and
record the agreement in both documents: (a) name #11 as the owner of `primitives.tsx`/`charts.tsx`
number formatting and require #46's locale migration to land **through** #11's new exact-text
components (the exact line must never be locale-formatted at all — it is transport text); (b) accept
that `ScopeChip`'s implementation changes under #46 and state that #11 depends only on its props and
accessible name; (c) delete the "#11's Model column" claim from #46 and state in #11 that the model
dimension is set only by the ScopeBar select and the Tokens-by-model bar, assigning
`Session.tsx:36` to #46 or explicitly deferring it. Name the merge order the coordinator will use
rather than "the second branch rebases".

---

### 4. [P1] The "exhaustive" file list omits six files the design requires

**Where:** Plan:458–462 ("Implementation is limited to this exhaustive tracked-file set … If a
reviewed change needs another file, the plan is revised before implementation rather than silently
widening the surface").

**What is wrong.** Each of these is forced by a design decision already in the plan:

| Missing file | Forced by |
|---|---|
| `web/src/shellContext.tsx` | `ReceiptValues` is `{ sessions?: number \| null; modelCalls?: number \| null; imports?: number \| null }` (`shellContext.tsx:10`). Plan:454 requires the receipt to use "authoritative count text". The type must change. |
| `web/src/App.tsx` | `App.tsx:35` spreads `receipt` into `<ScopeReceipt {...receipt} />`; a text receipt changes that call site. |
| `web/src/pages/Gallery.tsx` | `Gallery.tsx:3, 28–29` imports `DayBars`/`HBars` and passes `onSelect={setSelected}` typed `(name: string) => void`. Plan:371 changes the contract to `onSelect(point)`; the Gallery stops type-checking. |
| `web/e2e/smoke.spec.ts` | Finding 1. |
| `web/src/format.ts` | Plan:346 keeps "abbreviation only above 99,999" while values arrive as text that can exceed `Number.MAX_SAFE_INTEGER`. `abbreviate(value: number)` (`format.ts:14`) cannot take a decimal string. |
| `docs/adr/ADR-006-ui-design-direction.md` | Finding 12. |

`web/src/shellHooks.ts` may also need the receipt type change (`useScopeBar(dimensions, receipt,
loading)`), and the plan does not say who fetches `/api/metrics/facets` or how the options reach
`ScopeBar`, which only receives `Dimension[]` through `useScopeBar` from the page.

**Evidence checked:** `web/src/shellContext.tsx:10, 14, 18, 27–31`; `web/src/App.tsx:33–35`;
`web/src/pages/Gallery.tsx:3, 28–29`; `web/src/components/charts.tsx:26, 30, 51`;
`web/src/format.ts:14–22`; `web/src/shellHooks.ts:19–24`.

**Change required.** Add all six files with the reason, name the receipt's new shape, and state
whether facet options travel through `ShellApi` or through a page prop. State also that `abbreviate`
gains a text overload that never produces the exact line (the exact line is `valueText` verbatim).

---

### 5. [P2] Nothing in either plan guarantees that `toggle`, `remove`, `scopeHref` and `ScopeCell` preserve the `drill` parameter, and `ScopeChips` cannot render it under its agreed signature

**Where:** Plan:256–266, 294–296; `…tables-dates-settings.md:145–146`.

**What is wrong.** #46 owns `toggle(key, value)`, `remove(key)`, `scopeHref(key, value, pathname?)`
and `<ScopeChips keys? label? />`. Its signature reads `useScope()` and renders "one `ScopeChip` per
active key" over `SCOPE_KEYS`; there is no extension point for a fifth, non-key URL value, and its
"Clear all" appears "only when 2+ are active" counting scope keys. #11 requires `ScopeChips` to
append a derived drill chip (Plan:265). Meanwhile #46's helpers are only specified as "three added
exports plus three added functions" — Codex's own review (its P2 #11) already notes that
`scopeHref`'s preservation of other parameters is unspecified. If any of them rebuilds the query
from `SCOPE_KEYS` the way `scopeSearch` does today, every table-cell click silently drops the drill.

**Evidence checked:** `web/src/scope.ts:33–37, 55–62, 69`;
`…tables-dates-settings.md:145–146, 405–445`; `…-review-codex.md` finding 11.

**Change required.** #11 owns one pure URL-patch primitive (`patchScope(params, changes)`) that
preserves `drill` and resets `offset`; #46's three helpers and `ScopeCell` are specified to be
built on it. `ScopeChips` gains an explicit `drill` slot in its agreed props. Add the test
`clearing_a_base_filter_keeps_the_drill_and_a_period_change_removes_it`.

---

### 6. [P2] "retains the existing newest-observed-start-first … ordering" is false for `TraceQuery.session_ids`

**Where:** Plan:242–248 and Plan:474–476.

**What is wrong.** The plan routes `list_sessions` through `TraceQuery.session_ids` and says that
call "retains the existing newest-observed-start-first, nulls-last, ID tie-break ordering". It does
not:

```python
# trace_query.py:402–412
def session_ids(self, scope: TraceScope, *, limit: int, offset: int) -> Sequence[str]:
    return list(self._s.scalars(
        select(SESSION_VIEW.c.id).where(*_scope_clauses(EntityGrain.SESSION, scope))
        .order_by(SESSION_VIEW.c.id).limit(limit).offset(offset)))
```

The newest-first ordering lives in `repositories.py:833`
(`order_by(m.Session.observed_start_at.desc().nulls_last(), m.Session.id)`), which the plan replaces.
As written, the session list silently reorders to id-ascending. The change is feasible —
`SESSION_VIEW` carries `observed_start_at` (`trace_query.py:66–69`, `metric_sql.py:15–16`) — but it
is a change to a #10 port with 1,010 lines of tests behind it, not a retention.

**Evidence checked:** `trace_query.py:66–69, 402–412`; `repositories.py:824–841`;
`metric_sql.py:15–16`; `ports.py:188–195`.

**Change required.** Restate §2 as: `session_ids` currently orders by `id`; #11 changes its
`ORDER BY` to `observed_start_at DESC NULLS LAST, id`. Add a named test that the ordering and
`offset` pagination are stable, and confirm that #10's existing `session_ids` tests in
`backend/tests/infrastructure/test_trace_query.py` still pass under the new ordering.

---

### 7. [P2] The period filter's semantics are named but never pinned

**Where:** Plan:272–276.

**What is wrong.** "`resolvePeriod(period, now)` produces explicit UTC midnight bounds covering the
named number of calendar days through today" leaves four things undecided that the named test
("produces exact UTC half-open bounds for 7/30/90 days") cannot settle:

- whether `7d` means `[floorUTCDay(now) − 6d, floorUTCDay(now) + 1d)` or `[floorUTCDay(now) − 7d,
  floorUTCDay(now))`, and whether the upper bound is tomorrow's midnight or `now`;
- that the reference clock is the **browser's** — the server has none in the filter, and the plan
  correctly never forwards `period`, but a skewed client clock then narrows every number on the page
  with no visible evidence;
- that the URL stores the relative token, so a shared or bookmarked `?period=7d` resolves to
  different bounds tomorrow;
- how the resolved absolute window is shown. ADR-006 rule 2 and the Console receipt exist so that
  "what am I looking at" is never in doubt; a chip reading `Period last 7 days` does not say which
  seven days.

**Evidence checked:** `docs/api/v0.1.md:593–597` (half-open `[started_from, started_before)`,
timezone-aware, normalised to UTC); `metric_queries.py:54–77`; ADR-006 rule 2;
Console README line 30 (receipt).

**Change required.** Write the formula literally in the plan, state the browser clock as the
reference and the relative-token consequence, and require the resolved bounds to be visible — in the
`Period (UTC)` chip value or in the scope receipt (`… · 2026-09-02 → 2026-09-09 UTC`). Add boundary
tests at the exact midnight instants and one test that a clock inside the last day of the fixture
returns the same bounds regardless of the local zone.

---

### 8. [P2] Scheduled cost gets one of only two headline slots and will render `Unavailable` on the only dataset the project can demonstrate

**Where:** Plan:75–81, 357–360; MERGED §1.5.

**What is wrong.** `docs/api/v0.1.md:564–566` states *"Exact model IDs must match the schedule; no
aliases are guessed."* The committed schedule keys are OpenRouter-style
(`anthropic/claude-opus-4.7`, `openai/gpt-5.2-codex`, 428 models). The fixture's recorded model
strings are the raw claims: `claude-opus-4-7` (1,050 calls), `gpt-5.4`, `gpt-5.2-codex`, `gpt-5.5`,
`claude-sonnet-4-6`, `claude-opus-4-6`, `claude-haiku-4-5-20251001`. None matches. `scheduled_cost_usd`
will therefore return a null value, `priced_coverage` `0 / <all recorded tokens>`, and the reason
"No recorded tokens have both a rate and validated billing semantics."
(`metric_queries.py:390–395`). That is honest and exactly what §1.5's Nulls row prescribes — but the
plan promotes the tile to a permanent headline slot without saying that its shipped state on the
fixture is `Unavailable`, and its acceptance table (Plan:616–622) implies a value.

**Evidence checked:** `docs/api/v0.1.md:536–572`; `backend/prices/openrouter-v1.json` (schema
version 1, `schedule_version openrouter-2026-09-08-734d889de105`, 428 models, keys namespaced);
model census over `fixtures/tracelab/tracelab-sample.jsonl.gz`;
`metric_queries.py:383–395`; `domain/metrics.py:334–357`.

**Change required.** State the expected fixture state in the plan, pin it with a component test
(`scheduled_cost_is_unavailable_with_zero_priced_coverage_and_the_server_reason`) and an assertion
in the manual visual review, and put the question to the owner explicitly: does a permanently
`Unavailable` tile earn one of the two subordinate headline slots in v0.1.0, or does the slot go to
`imports_in_scope`/reasoning until a label-matching mapping exists? Note in the same place that
`docs/api/v0.1.md:569–570` still claims the real price snapshot is blocked by DNS while the file is
committed — a #10 doc bug the plan should flag rather than inherit.

---

### 9. [P2] No test at any level pins the fixture's known totals

**Where:** Plan:543–586 (Tests), Plan:604–610 (visual review), Plan:538–539.

**What is wrong.** Every named web test runs against `web/src/test/fixtures.ts` over a `fetch`
mock; every named backend test is a unit/route test. The only contact with the real imported
TraceLab data is an untracked local screenshot pass handed to the coordinator. So the plan's most
important correctness claim — that the dashboard shows the right numbers — has no automated
evidence, and the pooled `553,447,877` that must *not* appear has no negative assertion.

**Evidence checked:** Plan:543–610; `fixtures/tracelab/tracelab-sample.manifest.json`
(`sessions: 80`, `rows: 4770`, `rows_per_provider {claude: 1583, codex: 3187}`);
MERGED §1.1 (80 / 4,770 / 5,723 **[O, C, verified]**) and §1.4 (Claude 186,454,781, Codex
366,993,096, whole sample 553,447,877 — explicitly *"a reference expectation for checking an
implementation, not a pooled dashboard metric"*).

**Change required.** Add either (a) a backend integration test that imports the fixture and asserts
`/api/metrics/summary` and the three chart queries against 80 / 4,770 / 5,723 and the two token
partitions, or (b) the same assertions inside the `web/e2e/smoke.spec.ts` update that finding 1
already requires. Include the negative assertion that `553,447,877` is not rendered as a KPI value,
and assert the reason string `not comparable: 2 token semantics in selection`.

---

### 10. [P2] The unknown-timestamps counter and the population its List action opens are two different server computations, asserted equal without a test

**Where:** Plan:411–416.

**What is wrong.** Under a period the strip shows `excluded_unknown_timestamps` from the activity
query; its List action issues an unbounded-time `unknown_timestamps` query "under the same non-time
base filters". Those are computed differently:

```python
# trace_query.py:284–296 — excluded_unknown_timestamps
non_time = replace(scope, started_from=None, started_before=None, started_through=None)
... where(*_scope_clauses(grain, non_time), table.c.started_at.is_(None))
```

versus the `unknown_timestamps` metric, whose `population="timestamp_missing"`
(`domain/metrics.py:437–442`) is applied through `MetricQuerySpec.__post_init__`
(`metric_queries.py:174–183`) *after* `_activity_scope` has forced an explicit `activity_grain`,
which changes the required sibling-witness clauses (`docs/api/v0.1.md:609–611`). `_excluded_…` also
strips only `started_*`, leaving any `witness_started_*` bounds in place. Under a plain
source/agent/period scope the two agree; under a drill they need not.

**Evidence checked:** `trace_query.py:284–296`; `metric_queries.py:172–183, 199–212`;
`domain/metrics.py:437–442`; `docs/api/v0.1.md:601–611`.

**Change required.** Name one of the two as authoritative for the displayed count, and add the test
`unknown_timestamp_count_equals_the_population_its_list_action_opens` across: no scope, period only,
source+period, and one active drill. If they diverge under a drill, say so in the strip's detail text
rather than showing a count whose List action returns a different number of sessions.

---

### 11. [P2] MERGED §1.5's cost popover requirement is silently narrowed and not listed as a contract risk

**Where:** Plan:357–360 (cost tile), Plan:88–93 and Plan:631–636 (the registry-gap risk, which
lists §1.8, §1.9 and §1.11 but not §1.5).

**What is wrong.** MERGED §1.5 *Display* requires: *"the `i` popover lists the excluded components
and their token volumes."* #10 publishes only an aggregate `priced_coverage: TokenCoverage
{known, total, known_text, total_text}` per result and per partition — no per-component breakdown
(`docs/api/v0.1.md:461–474, 536–552`; `metric_queries.py:279–301, 396–422`). The plan's cost tile
lists schedule version, call coverage, priced coverage and the caveat, which is everything the
contract offers, but it does not record that §1.5's popover requirement cannot be met. The plan is
scrupulous about naming exactly this class of gap for §1.8/§1.9/§1.11, so the omission reads as an
oversight rather than a decision.

**Evidence checked:** MERGED §1.5 *Display*; `docs/api/v0.1.md:461–474, 536–562`;
`application/metric_queries.py:279–301, 383–422`; `application/dto.py:197–214`.

**Change required.** Add §1.5 to the contract-gap risk with the same wording discipline: the
excluded-component breakdown needs a #10 result field; #11 renders aggregate priced coverage plus
the definition's caveat (which already names Codex prefix, cache creation and reasoning by name) and
does not compute component volumes client-side.

---

### 12. [P2] The drill envelope is a second scope representation and needs an ADR-006 amendment, as #45 and #46 both did

**Where:** Plan:277–308.

**What is wrong.** ADR-006 rule 1 reads: *"Drilling down appends a chip to the scope and navigates to
sessions; there is no second drill mechanism."* #46's §0 takes it literally: *"There is one filter
mechanism: the URL scope. Nothing renders a chip by hand and nothing holds drill state beside the
scope; a drill-down is `set({ model: 'x' })`."* #11 introduces a versioned JSON `drill` parameter
carrying a whole `MetricDrillScope`, with its own precedence rules — "a returned chart drill always
wins over the derived period bounds" (Plan:275), "API calls start from the envelope's scope when
present, then overlay the current Source/Agent/Model base values and clear their mutually exclusive
unknown flags" (Plan:295–297), and "only one drill envelope is active at a time" (Plan:303).

I think the envelope is the **right** call: the four base keys genuinely cannot express
`witness_time_override` + four witness bounds + `activity_grain` + `timestamp_missing`
(`api/types.ts:77–101`, `metric_queries.py:28–52`), and rebuilding a drill from a display label is
exactly the client-side reinvention ADR-006 was written to prevent. But the same predicate (`model`)
is now expressible in two places with an overlay rule, and that is a structural deviation from the
design of record. #45 amended ADR-006 for the Passage structure; #46 plans an amendment for
`/settings`. #11 plans none, and does not list ADR-006 in Files touched.

**Evidence checked:** ADR-006 rule 1 and the 2026-09-08 amendment; `…tables-dates-settings.md:132–138`;
`api/types.ts:77–101`; `metric_queries.py:28–52, 215–276`; MERGED §4 closing paragraph
("ADR-006 rule 5 … covers this; it is the only open point").

**Change required.** Add a short ADR-006 amendment in the #45 style recording (a) the four KPI cards
plus two subordinate headline tiles that MERGED §4 leaves open, and (b) the versioned drill envelope
as the single carrier of server-returned scope, with its precedence over base filters stated once.
Add the file to Files touched and coordinate with #46, which also amends ADR-006.

---

### 13. [P2] The estimate has no dated critical path against a sprint ending 2026-09-11

**Where:** Plan:670–682.

**What is wrong.** 18–26 engineering hours plus a 2–4 hour contract-change reserve, starting only
*after* the coordinator merges #10 (Plan:626–630), on a sprint that ends 2026-09-11 — today is
2026-09-08. The estimate also predates the extra work findings 1 and 4 add (e2e spec, Gallery,
shellContext/App, `format.ts`, ADR amendment) and assumes a #46 that is currently blocked; #46's own
reviewer re-estimated its "about one day" as at least 10.5 hours plus contingency and asked for a
dated path. Two web-heavy issues sharing `scope.ts`, `Overview.tsx`, `Sessions.tsx`,
`sessionsTable.tsx`, `primitives.tsx`, `charts.tsx`, `bars.tsx`, `components/index.ts`,
`App.test.tsx`, `components.test.tsx` and `base.css` cannot both be "the second branch rebases".

**Evidence checked:** Plan:670–682; Plan:626–630, 651–655; `…-review-codex.md` finding 15;
`docs/planning/2026-09-07-consolidated-plan.md` (sprint end).

**Change required.** Publish a dated critical path: #10 merge date as the gate, the shared-contract
agreement with #46 dated 2026-09-08, an ordered merge decision from the coordinator, and a reserved
window on 2026-09-11 for combined #11/#46 acceptance and review fixes. State what is dropped first
if #10 slips — my suggestion, in order: the facets endpoint (fall back to `scopeDimensions.ts`), the
two subordinate headline tiles, then the definitions-page column richness. Do not drop the exactness
rules or the e2e update.

---

### 14. [P3] Current-state claim 7 overstates what #10 guarantees about witness round-tripping

**Where:** Plan:144–147 ("Returned witness fields must round-trip unchanged when a chart changes
grain").

**What is wrong.** They do not round-trip unchanged; `_activity_scope` **overwrites** them with the
current bounds whenever the grain differs:

```python
# metric_queries.py:199–212
if scope.activity_grain is not None and scope.activity_grain != grain:
    return replace(scope, activity_grain=grain, witness_time_override=True, witness_required=True,
                   witness_started_from=scope.started_from, witness_started_before=scope.started_before,
                   witness_started_through=scope.started_through,
                   witness_timestamp_missing=scope.timestamp_missing)
```

That is the documented and correct behaviour (`docs/api/v0.1.md:618–621`), and the client's duty —
forward the returned scope verbatim, never rebuild it — is what the plan actually means. But the
plan sends one envelope to eleven queries across three grains, so the wording matters.

**Change required.** Restate as: the client forwards the returned scope verbatim; the server derives
each grain's witnesses from it. Add one test that the whole dashboard under a single tool drill and
under a single day drill produces internally consistent totals across grains.

---

### 15. [P3] Three narrowings against the design of record are not named as such

**Where:** Plan:351–355 (popover contents), Plan:407–430 (quality strip), Plan:377–384 (chart 1).

- **Cache-read tokens leave the KPI popover.** Console README line 47 puts *"cache tokens"* in the
  `i` popover, and line 110 spells out *"the by-semantics split and cache-read tokens (`Unavailable`
  outside tracelab-claude)"*. `cache_read_tokens` is a published registry metric
  (`domain/metrics.py:365–371`, `docs/api/v0.1.md:438`). The plan's popover list omits it.
- **The capability matrix is dropped.** MERGED §1.2 *Display* says the strip expands *"in place to
  the capability matrix"*, and §1.2 fixes three states (`measured` / `Unavailable` with a reason /
  `Unprofiled`). The plan's strip expands to a sentence, and `Unprofiled` appears nowhere. Deferring
  is reasonable — the issue's task list says only "quality strip" — but MERGED assigns the matrix to
  #11.
- **The null-day bucket's own `drill_scope` is discarded.** The activity query already returns a
  null-day bucket with a complete drill scope (`metric_queries.py:252–255` sets
  `timestamp_missing=True` and the grain, preserving `witness_time_override` and the original
  bounds). The plan replaces it with a separate `unknown_timestamps` query, which is a mild
  departure from its own "follow returned scopes rather than rebuilding them" principle and is what
  makes finding 10 possible. Keeping the count out of the chart is right (MERGED §1.3: *"The undated
  count sits in the quality strip, not in the chart"*); using the bucket's returned scope for the
  drill is free.

**Change required.** Add cache-read tokens to the popover contents; state the capability matrix and
the `Unprofiled` state as explicitly deferred with the issue that will carry them; and use the
null-day bucket's returned `drill_scope` for the strip's List action when the activity query has one.

---

### 16. [P3] Stale references and one unstated chart-density decision

- Plan:96 inspected #10 at `f301194`; the branch head is now `0f3f39b`, adding
  `a0a8c45 fix(metrics): bound day drills within representable dates` and
  `0f3f39b fix(metrics): bucket UTC days without SQLite date rounding` — both of which change
  precisely the Activity-by-day keys and day-drill bounds the plan depends on. Re-verify §5 chart 1
  against `0f3f39b`, not `f301194`.
- Plan:99–102 correctly notes that `application/metrics/` (named in the brief) does not exist and
  that the registry is `domain/metrics.py` — a good catch worth keeping in the final document so the
  next reader is not sent to a missing path.
- Console README line 110 fixes Activity by day at **14 bars**. The plan renders every returned day
  with no truncation (correct — no silent top-N) but the default period is `all`, so the fixture's
  full range decides the chart's width and nothing in the plan says what happens at 60+ days.
  State the containment rule for the day chart the way Plan:665–668 does for the model/tool charts.

---

## What the plan gets right

- **The #10 contract audit is accurate.** I checked every endpoint, field and scope key it names.
  The summary metric set, the twenty-two accepted query parameters, the `metric_id` /
  `supported_dimensions` / `scope` / `group_by` / `overall` / `excluded_unknown_timestamps` /
  `buckets` response shape, the per-bucket and per-partition `drill_scope`, the definitions field
  list, `TraceQuery.session_ids` / `session_metrics`, and the four `headline_kpi=true` definitions
  all exist exactly as described. The plan is also right that `web/src/api/types.ts` `Scope`,
  `Metric` and `MetricsSummary` lag their backend, and right that `session_ids` is serialised into
  `drill_scope` and must be stripped before the browser re-sends it.
- **The four-cards-plus-two-tiles question is resolved correctly and with evidence.** MERGED §4 Q3
  and the registry agree (`domain/metrics.py:278, 309`), and MERGED §4's closing paragraph proposes
  exactly the layout the plan adopts. Moving Output tokens into the Tokens-by-model panel header is
  the right way to keep the issue's literal result without displacing the owner-selected Tool calls
  card, and the plan says so out loud instead of quietly changing the issue.
- **The exactness discipline is the best part of the plan.** Never consuming `Metric.value`; keeping
  `valueText` for labels, hidden tables, exact lines and drill assertions while `Number(valueText)`
  serves only SVG geometry; refusing the pooled mixed total and rendering partitions with the server
  reason; count `0` at coverage `0/0` staying `0` while a null sum is `Unavailable`; a test value
  above `Number.MAX_SAFE_INTEGER`. That is a correct reading of ADR-006 rule 2, MERGED §0 and
  `docs/api/v0.1.md:544–552`, and it is the reason finding 1 exists at all.
- **The day/period/undated handling is subtle and right.** No fake date for the null day;
  `excluded_unknown_timestamps` under a period and `unknown_timestamps` without one; the observation
  that the API forbids `timestamp_missing` together with date bounds (`metric_queries.py:85–86`) and
  that the List action must therefore drop the range; the "N undated observations cannot be placed
  in the range" wording lifted from MERGED §3.4.
- **The reject boundary is the most honest thing in the document.** Rejects are pre-canonical, have
  no session, and render `Unavailable — rejects cannot be attributed to this canonical scope` under
  Agent/Model/Period, linking to `/imports` instead of offering a session list. That matches
  `docs/api/v0.1.md:646–650` and refuses a correlation the data cannot support.
- **Chart accessibility is planned properly.** `AccessibleBarShape` rendering each rectangle as the
  focusable `role="button"` rather than relying on `tabIndex` on the `Bar` wrapper is the right fix
  for the exact weakness the Console README flags at line 91 and defers at line 137; keeping the
  hidden exact table, the focus hint and Enter/Space, and giving null results no zero-length
  interactive bar, all follow the accessibility contract at README lines 126–128. No new chart
  dependency is needed: Recharts 3.10.1 is already pinned (`web/package.json:24`).
- **Scope is not silently widened elsewhere.** No metric definition, SQL view, migration or price
  file is touched; the contract gaps for MERGED §1.8, §1.9 and §1.11 are named as #10 work rather
  than reinvented in chart code; tool names are not normalised; there is no client top-N.
- **The definitions page finally renders the registry** instead of hand-building four rows from the
  summary (`web/src/pages/Definitions.tsx:18–24`), with anchors the KPI popovers link to, and
  "Not applicable" instead of an em dash for absent metadata.
