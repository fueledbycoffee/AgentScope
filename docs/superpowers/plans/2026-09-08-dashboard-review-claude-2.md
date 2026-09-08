# Second-pass cross-review (Claude) of the #11 dashboard plan

**APPROVE WITH CHANGES**

Reviewed against merged main in `/Users/sean/dev/AgentScope-wt/11` (branch `feat/11-dashboard`,
HEAD `b7d701a`, rebased onto `eb92b8c` where #10 is merged): the working brief, issue #11, the
revised plan `docs/superpowers/plans/2026-09-08-dashboard.md` (969 lines, now carrying
`## Revision after review`), the first review `…-dashboard-review-claude.md`, the #46 plan
revision 3 at
`/Users/sean/dev/AgentScope/.claude/worktrees/agent-ac64bf813ff286a75/docs/superpowers/plans/2026-09-08-tables-dates-settings.md`
(HEAD `db2f491`), and the code each cites. Read-only: no file outside this one was modified, no
git write, no build, no browser run. `Plan:N` is a line of `2026-09-08-dashboard.md`; `46:N` is a
line of `2026-09-08-tables-dates-settings.md`.

**All four prior P1s and all nine prior P2s are closed**, and the three P3s are closed or
explicitly declined with a recorded reason. The revision is unusually faithful: every claim I
spot-checked against the merged code holds. What keeps this from a clean APPROVE is two
document-level defects that would fail on contact — one invented server string, one stale copy of
the coordinator's boundary — plus six coordination edits, all of them one-paragraph changes to a
plan document. **None requires a design change or a third cross-review round**; the coordinator can
land them and release implementation.

Severity count of what is still open: **2 P1, 6 P2, 3 P3.**

---

## Part 1 — the four P1s of the first review

### P1 #1 — e2e breakage and the missing `pnpm --dir web e2e` — **CLOSED**

`web/e2e/smoke.spec.ts` is now in the exhaustive surface (Plan:638–640), `pnpm --dir web e2e` is in
Full verification (Plan:759), and Plan:725–743 specifies the replacement assertions.

Evidence re-verified on this branch: `web/src/components/primitives.tsx:146` gives the KPI its
accessible name from `label` (`<section className="kpi" aria-label={label}>`);
`backend/src/agentscope_app/domain/metrics.py:264–268, 286–290` produce the labels
`Model-call observations`, `Tool-call observations`, `Input usage by accounting group`;
`web/e2e/smoke.spec.ts:118–122` still asserts the old region names plus `553.4M`,
`exact 553,447,877` and `coverage 4,770 / 4,770 calls`; `:147–148` uses `agent.fill('codex')` and
`:196` `toHaveValue('codex')` against the text/datalist `ScopeInput`
(`web/src/components/bars.tsx:15–29`); `:205` names `Definition of Input tokens`. Every one of
those is now inside the plan's own surface.

Two facts the plan states are exactly right and I confirmed at source: the refusal reason
`not comparable: 2 token semantics in selection` is produced verbatim at
`domain/metrics.py:250`, and the partition split 1,583 / 3,187 calls matches
`fixtures/tracelab/tracelab-sample.manifest.json` (`rows_per_provider`) summing to the 4,770 total
already asserted by `TOTALS` (`smoke.spec.ts:13`).

### P1 #2 — the drill was outside the scope identity — **CLOSED**

Plan:324–331 now names `readScope`, `scopeKey`, `scopeSearch`, `link`, `scopeHref`, `patchScope`
and `clear` as all carrying the validated envelope, and states that `scopeKey` includes a canonical
serialization "therefore setting, replacing or removing a drill changes the memoised scope identity
and reissues every dashboard request". The named test
`a_drill_change_reissues_every_dashboard_request` is at Plan:717.

That is the correct fix for the mechanism at `web/src/scope.ts:26–30, 40–41` (identity is
`scopeKey(readScope(params))` over `SCOPE_KEYS` only) feeding
`web/src/pages/Overview.tsx:21–22` (`useResource(useCallback(…, [scope]))`). See P3 #1 below for
the one word that still needs pinning.

### P1 #3 — the ownership contract was written against a blocked #46 — **CLOSED, but the quoted boundary is stale** (see new P1 #2)

Plan:262–264 now quotes a coordinator decision verbatim instead of inferring one, and Plan:266–293
derives #11's obligations from it: #11 owns `primitives.tsx`/`charts.tsx`/`bars.tsx`/`scope.ts`
formatting and helpers, #11 (not #46) adds the `.has-tip`/`data-tip` treatment to the chip's remove
control, `ScopeChip`'s public props are unchanged, and the model dimension is no longer claimed by
both plans. The specific defect the first review found — "#11's Model column needs no new code",
against a `sessionsTable.tsx` that has no model column — is gone from both documents; #46's §0.1
now says "Model is not a new Sessions-table column: #46 converts the existing call-table cell".

The finding is closed. The version of the boundary quoted at Plan:264 is not the current one; that
is a new finding, not a re-opening of this one.

### P1 #4 — the "exhaustive" file list was not exhaustive — **CLOSED**

All six forced files are accounted for: `shellContext.tsx` (Plan:601), `App.tsx` (Plan:603),
`Gallery.tsx` (Plan:623), `smoke.spec.ts` (Plan:638), `format.ts` (Plan:649–651, listed as a forced
dependency #11 must design around but **not** edit), `ADR-006` (Plan:646). Three more were added:
`api/index.test.ts`, the new `scope.test.ts`, and `Session.tsx`. The receipt's new shape is named
literally (Plan:544–545) and the facet path is stated (page → `useScopeBar` → `ShellApi`,
Plan:226–230).

Two claims verified at source. `web/src/shellHooks.ts:20–24` is
`useScopeBar(dimensions: Dimension[], receipt: ReceiptValues | undefined, loading: boolean)` and
keys its effect on `JSON.stringify(receipt ?? null)` — it is generic over the receipt's field
types, so Plan:655–657 ("`shellHooks.ts` needs no edit") is correct. `web/src/App.tsx:35` does
spread `<ScopeReceipt {...receipt} />`, so Plan:546–547's explicit-props change is required and
listed. The `format.ts` carve-out is sound: `abbreviate(value: number)` (`format.ts:14`) cannot
take a decimal string, and #11's `abbreviateDecimalText` (Plan:404–408) avoids both the lossy parse
and an edit to a file the coordinator gave away.

### The nine P2s and three P3s

| # | Subject | State |
|---|---|---|
| 5 | drill preserved by `toggle`/`remove`/`scopeHref`/`ScopeChips` | **Closed**, one residual → coordination item 1 |
| 6 | `session_ids` ordering was not "retained" | **Closed** — Plan:248–252 states the change; verified `trace_query.py:402–412` orders by `SESSION_VIEW.c.id` while `repositories.py:833` orders `observed_start_at DESC NULLS LAST, id`. Test named at Plan:674–679, including the deliberate update of #10's expectations |
| 7 | period semantics unpinned | **Closed** — Plan:295–309 gives the literal formula, the worked 2026-09-08 example, the browser clock, the moving-bookmark consequence and the visible resolved range in the receipt; midnight and local-zone tests at Plan:691–693 |
| 8 | scheduled cost `Unavailable` on the only demo dataset | **Closed as a decision** (D2-03b filed, tile keeps its slot, state pinned in component and visual checks) — but the reason string it pins is wrong → new P1 #1 |
| 9 | no test pins the fixture totals | **Closed** — the real-fixture Playwright smoke is named as the oracle (Plan:725–743) with the negative `553,447,877` assertion |
| 10 | two different unknown-timestamp computations | **Closed** — Plan:481–495 names the null-day bucket authoritative when present, `excluded_unknown_timestamps` under a period, and disables List rather than opening a differently sized population; four-scope test at Plan:682–684. Residual → new P2 #4 |
| 11 | MERGED §1.5 cost popover narrowed silently | **Closed** — now an explicit contract gap at Plan:791–800 |
| 12 | ADR-006 amendment missing | **Closed** — Plan:365–371 and Plan:646–648 |
| 13 | no dated critical path | **Closed** — Plan:854–879, with an ordered cut list that protects exact text, drill identity and e2e. Dates need one edit for the parallel boundary (new P1 #2) |
| 14 | witness "round-trip" over-claim | **Closed** — Plan:144–147 restates it as forward-verbatim / server-derives |
| 15 | three narrowings unnamed | **Closed or declined with reason** — cache-read tokens added (Plan:412–415), null-day bucket's own `drill_scope` used (Plan:483), capability matrix + `Unprofiled` explicitly declined because merged #10 has no source-by-capability result (Plan:511–516, Risks 795–800). The declination is correct: inferring `Unprofiled` from absence is exactly the fabrication the trust rule forbids |
| 16 | stale refs, chart density | **Closed** — rebased to `eb92b8c`, the `application/metrics/` correction retained (Plan:99–103), day-chart containment stated (Plan:449–454) |

---

## Part 2 — the six §0.6 coordination items

The coordinator's boundary, which both plans must follow: #11 owns
`web/src/components/{primitives,charts,bars}.tsx`, `web/src/scope.ts` (`SCOPE_KEYS` with `model`
and `period`, `SCOPE_PARAMS` with `drill`, `setDrill`), `web/src/shellContext.tsx`,
`web/src/pages/Overview.tsx`; #46 owns settings, `format.ts`, the Settings page, `ScopeCell` and
`ScopeChips` as new files, every date rendering, the Model cell on `Session.tsx`, and the locale
migration of non-#11 files, with #11's files migrated in #46's final rebase after #11 merges; the
two run **in parallel** from now.

### Item 1 — `scope.model` retained after removal — **#11 MUST CHANGE [P2]**

Not satisfied. Plan:336–338 still reads: "API calls start from the envelope's scope when present,
then overlay the current Source/Agent/Model base values and clear their mutually exclusive unknown
flags". Overlay is not deletion. If a model drill put `model: 'gpt-5.5'` in the envelope and the
user then removes the Model chip, no base value overlays it, and the removed filter stays silently
active in every request — the exact failure `46:365–369` raises. `patchScope`'s description
(Plan:275–278) only says it "preserves all untouched base keys and a valid drill".

**Edit (#11, Plan:336–338):** after the overlay sentence add — *"Removing a base dimension deletes
that dimension and its mutually exclusive `*_is_unknown` predicate from the effective envelope
scope; a removed filter is never left active inside the envelope. If deletion would leave the
envelope's witness fields describing a population the remaining predicates no longer select, the
envelope is invalidated instead."* Add it to the named test at Plan:696 so
`clearing_a_base_filter_keeps_the_drill_and_a_period_change_removes_it` also asserts the effective
API scope no longer carries the removed dimension.

### Item 2 — the contradiction between two #11 sections — **ALREADY SATISFIED**

Closed. The old "changing a base filter removes stale witness state" sentence is gone (no match in
the revised plan), leaving one rule stated twice and consistently: Source/Agent/Model changes
preserve the drill and override only that predicate (Plan:351–353); a Period change removes it
because the server generated its date witnesses for the prior period (Plan:277–278, 354–355);
`Clear all` removes both (Plan:285–286). #46 states the same rule at `46:262–263, 269–271`. No edit
needed, subject to item 1 adding the deletion half.

### Item 3 — `ScopeChip` tooltip wording and `ScopeChipsProps` — **BOTH CHANGE [P2]**

Half satisfied. Plan:279–286 already drops "markup, name and tooltip do not change" and states the
leaf's public props are unchanged. But the *ownership* has flipped under the coordinator's
boundary: `bars.tsx` is #11's, so **#11** adds `.has-tip`/`data-tip` (Plan:280–281 already says so)
and #46's Files-touched row "`ScopeChip`'s remove button gains `data-tip`" (`46:757`) is now #11
work that #46 must delete or move into its post-merge rebase. #46's §0.3 wording *"preserve #46's
`.has-tip`/`data-tip` upgrade"* (`46:296–298`) should become *"preserve #11's `.has-tip`/`data-tip`
treatment"*.

The typed contract is not adopted: `ScopeChipsProps`, `includeDrill`, and the fixed placement
(above the Overview sessions panel and above the Sessions table, base chips first, derived chip
last — `46:270–298`) appear nowhere in #11's plan; it says only "its agreed props include an
explicit derived-drill slot" (Plan:284).

**Edit (#11, Plan:284–286):** paste `ScopeChipsProps` verbatim from `46:275–281` and the fixed
placement sentence, and note that #11 leaves the two mount points where #46's rebase will insert
`<ScopeChips />`. **Edit (#46):** re-attribute the tooltip upgrade to #11 in §0.3 and drop the
`bars.tsx` tooltip row from its main pass.

### Item 4 — the reciprocal bootstrap — **#46 MUST CHANGE [P1, see new P1 #2]**

#11 already satisfies its half: it initialises all four labels and the period formatter
(`SCOPE_LABELS`, `formatScopeValue`, `patchScope`, `toggle`, `remove`, `scopeHref` and every
`useScope` change, Plan:272–274), so the reciprocal branch is dead under the settled order.

#46 contradicts the boundary outright. `46:311–318` reads *"One integration order,
coordinator-owned: **#46 lands first** … Checkpoint 2026-09-09T18:00Z, #46's shared-surface commit
on the branch, after which #11 rebases"*, and its Files touched (`46:756–761`) claims `scope.ts`
(`SCOPE_PARAMS`, `patchScope`, `toggle`, `remove`, `scopeHref`, widened `scopeSearch`/`link`),
`bars.tsx`, `primitives.tsx` and `charts.tsx` in its main pass. All four are #11's under the
boundary.

**Edit (#46, §0.4 and Files touched):** delete the "#46 lands first" order and the
2026-09-09T18:00Z checkpoint; state that the two run in parallel on disjoint surfaces, that #11
ships `scope.ts` entire, and that #46's edits to any file in #11's Files-touched list happen in its
post-#11-merge rebase. **Edit (#11, Plan:815–819 and 854–879):** replace "Issue #46 is sequenced,
not parallel on shared files" and "There is no unordered 'second branch' merge" (Plan:362–363) with
the parallel arrangement; the 2026-09-11 reservation stays.

### Item 5 — adopt `formatExactText` for lossless text — **BOTH CHANGE [P2]**

Directly contradicted today. `46:326–350` requires #11 to call
`formatExactText(text, settings)` — a string-only regrouping that never parses to a number — for
every visible exact line, partition, receipt figure, tooltip, focus hint and accessible table cell.
#11 says the opposite twice: the exact line "always prints `valueText` verbatim" (Plan:406–407) and
"#46 never locale-formats a transport exact-text line" (Plan:362).

Both positions are defensible and the boundary decides the sequencing: `format.ts` is #46's and
will not exist while #11 implements, so #11 cannot call `formatExactText`. But #11's blanket
prohibition is too strong — grouping a decimal *string* by locale separators is lossless, and #46
keeps the raw string beside it for copy, `title` and transport.

**Decision.** #11 ships verbatim `valueText` now and stops forbidding the later migration; #46
performs it in its rebase. **Edit (#11, Plan:362 and 406–408):** replace "#46 never locale-formats
a transport exact-text line" with — *"#46's rebase may group an exact line through
`formatExactText`, which regroups the decimal string without parsing it and keeps the raw string
for copy, `title` and every API path. It must never route transport text through `Number`,
`toLocaleString` or `abbreviate`. #11 renders each exact value in a single element carrying the raw
string, so that substitution is mechanical."* **Edit (#46, §0.5):** move the `formatExactText`
requirement on #11's surfaces into the rebase phase, and keep the joint locale test (a value above
`Number.MAX_SAFE_INTEGER` and one with a fractional decimal) as a #46 test.

### Item 6 — shared drill tests — **#11 MUST CHANGE (small) [P2]**

Mostly covered but not jointly named. #11 has
`clearing_a_base_filter_keeps_the_drill_and_a_period_change_removes_it`, `patchScope`/`scopeHref`
drill preservation and Back/Clear/offset in `scope.test.ts` (Plan:691–697), plus
`a_drill_change_reissues_every_dashboard_request` and
`session_model_cell_opens_sessions_with_the_full_scope` in `App.test.tsx` (Plan:717–719). Missing
is `46:376–378`'s actual requirement: each case asserting **the effective API scope and the
displayed chips together**, and a `Clear all` case.

**Edit (#11, Plan:696–697):** name the five joint cases — tool or accounting drill carried through
a Session cell targeting `/sessions`; Model removal; Period removal; `Clear all`; Back — and state
that each asserts the resulting API scope and the rendered chip set in the same assertion. Note
that the Session-cell case runs in #46 after its rebase, since #46 owns that cell (new P1 #2).

### The drill envelope contract, stated in both

Substantively aligned: base keys and order; the envelope as a fifth serialised value; carried by
`scopeSearch`, `link`, `scopeHref` and `patchScope` across routes; `offset` reset; `Clear all`
removing base **and** drill; removing the derived chip removing only the drill; a Period change
invalidating the envelope; charts calling `setDrill` rather than `set`; one envelope at a time.

**Not stated identically, in two places:**

1. **`SCOPE_PARAMS` is unnamed in #11 [P2].** #46 declares
   `export const SCOPE_PARAMS = [...SCOPE_KEYS, 'drill'] as const` (`46:247`) and compiles its
   target-route links against it (`46:252–256`, `46:670–671`). The coordinator's boundary names
   `SCOPE_PARAMS` as #11-owned. #11's plan never uses the identifier. **Edit (#11, Plan:268–271):**
   declare `SCOPE_KEYS` and `SCOPE_PARAMS` together, exactly as `46:246–247`, and say that
   `scopeSearch`, `link` and `scopeHref` iterate `SCOPE_PARAMS`.
2. **Reconciliation on base-chip removal** — coordination item 1 above. #46 requires deletion from
   the envelope; #11 specifies overlay only.

---

## Part 3 — new findings

### [P1] 1. The Scheduled-cost tile pins a reason string the server never emits

**Where:** Plan:421–423, 708–709, 768, 822, 929.

The plan states the tile "renders `Unavailable` and the visible reason exactly
`no rate for this model id`", names a component test that "pins visible `no rate for this model
id`", and puts the same string in the manual visual check, the Risks entry and the revision log.
That string does not exist anywhere in the backend or the docs — `grep -rn "no rate for this model"
backend/src web/src docs` matches only the plan itself.

The server's actual reason for this state is at
`backend/src/agentscope_app/application/metric_queries.py:392–395`:

```py
if is_cost and schedule_version is None:
    reason = "Price schedule unavailable; no tokens priced."
elif is_cost and result.known == 0:
    reason = "No recorded tokens have both a rate and validated billing semantics."
```

`backend/prices/openrouter-v1.json` is committed, so `load_price_schedule()` succeeds and
`schedule_version` is not None: the fixture will show the **second** string. As written, the named
component test and the acceptance check cannot pass, and implementing them literally would put a
fabricated reason in the UI — precisely the trust rule the rest of this plan enforces better than
any other document in the repo. The contrast is sharp: the mixed-token reason the plan quotes,
`not comparable: 2 token semantics in selection`, is verbatim correct
(`domain/metrics.py:250`).

**Change required.** Replace all five occurrences with the server string
`No recorded tokens have both a rate and validated billing semantics.`, and state the rule once:
the tile prints `MetricResult.reason` verbatim and #11 authors no reason text of its own. Keep the
D2-03b hand-off exactly as it is.

### [P1] 2. §3 quotes a superseded coordinator boundary: the `Session.tsx` Model cell and "sequenced, not parallel"

**Where:** Plan:264 (the verbatim quote), 287–291, 620–621, 658–659, 719, 815–819, 862–866.

The quoted boundary differs from the current one on two points, and #11 has built on both:

- **The Model cell on `Session.tsx` is #46's, not #11's.** Plan:264 claims "the Model cell
  activation on `web/src/pages/Session.tsx`" for #11; Plan:287–291 designs the behaviour;
  Plan:620–621 lists the file in the exhaustive surface; Plan:719 names
  `session_model_cell_opens_sessions_with_the_full_scope`. Under the current boundary the file is
  #46's, and #46 has already designed the same cell as a generic `ScopeCell`
  (`46:772`, `46:680–684`) that becomes a link automatically once `model` is in `SCOPE_KEYS` —
  which #11 delivers. With the two branches running in parallel, both editing `Session.tsx` is a
  guaranteed conflict on a file the boundary already assigned.
- **"Sequenced, not parallel" is no longer true.** Plan:362–363 ("no parallel edit to a shared
  presentation file"), Plan:815 ("Issue #46 is sequenced, not parallel on shared files"),
  Plan:864–866 (2026-09-11 = "#46 rebases onto the merged #11 contract") and Plan:877 ("#46 moves
  beyond the sprint") all assume #46 cannot start until #11 merges. The coordinator has the two
  running in parallel on disjoint surfaces, with only #46's migration of #11's files deferred to
  its final rebase.

**Change required.** Re-quote the current boundary at Plan:264. Delete `web/src/pages/Session.tsx`
from Files touched and Plan:287–291, replacing them with: *"#11 publishes `scopeHref` and
`SCOPE_PARAMS`; #46's `ScopeCell` renders the `Session.tsx` model cell as a scope link once `model`
is a base key. #11 does not edit that file."* Move
`session_model_cell_opens_sessions_with_the_full_scope` to #46's suite (coordination item 6).
Rewrite Plan:362–363, 815–819 and the 2026-09-11 line as parallel-with-deferred-migration. This
also shortens the estimate's "4-6 hours for page and drill integration including the Session Model
cell" (Plan:848–849).

### [P2] 3. Eight shared files appear in both Files-touched lists with no owner, while the branches run in parallel

The boundary resolves the six named files. These appear in **both** plans and in neither half of
the boundary: `web/src/components/index.ts`, `web/src/components/components.test.tsx`,
`web/src/App.tsx`, `web/src/App.test.tsx`, `web/src/pages/sessionsTable.tsx`,
`web/src/pages/Sessions.tsx`, `web/src/styles/base.css`, and
`docs/adr/ADR-006-ui-design-direction.md` (both plans amend it — Plan:646–648 and `46:783`).
`web/src/pages/Overview.tsx` is #11's but #46 plans a `<ScopeChips />` insertion there (`46:771`).

**Change required.** State the rule once in both documents, in the boundary's own spirit: *"#11's
Files-touched list defines '#11's files'. #46 makes no edit to any file on that list before #11
merges; those edits land in #46's post-merge rebase. ADR-006 receives two independent appended
amendments, #11's first, #46's appended after the rebase — neither rewrites the other."* That
covers all nine files without another coordinator round.

### [P2] 4. The unknown-timestamps reconciliation must mirror `_excluded_unknown_timestamps` field for field, or List is disabled almost always

**Where:** Plan:484–493.

The client "separately loads `unknown_timestamps` without direct date bounds but under the same
non-time base/drill predicates", and enables List only when the two counts are equal. The server
side is narrower than "non-time":

```py
# trace_query.py:284–296
def _excluded_unknown_timestamps(self, grain, scope):
    if not scope.has_time_bounds or grain == EntityGrain.SESSION: return 0
    non_time = replace(scope, started_from=None, started_before=None, started_through=None)
```

It clears only the three `started_*` fields and leaves every `witness_started_*` bound and
`witness_timestamp_missing` in place. If the client also strips the witness bounds when it builds
the companion query, the two populations differ structurally under any activity drill, the counts
disagree, and the plan's honest fallback disables List for a reason that is an artefact of the
client's own construction rather than a real divergence. (`metric_queries.py:85–86` genuinely
forbids `timestamp_missing` with date bounds, so only the `started_*` triple may be dropped.)

**Change required.** Say literally: the companion query clears `started_from`, `started_before` and
`started_through` and **nothing else** — witness bounds, `witness_timestamp_missing` and every base
predicate are forwarded unchanged, mirroring `_excluded_unknown_timestamps`. Keep the
disable-and-explain fallback for a real divergence, and have
`test_unknown_timestamp_count_equals_the_population_its_list_action_opens` (Plan:682–684) assert
the equality holds for the plain period case rather than only comparing.

### [P2] 5–7 — the three coordination edits already argued above

`SCOPE_PARAMS` unnamed in #11 (Part 2, envelope check item 1); envelope deletion on base-chip
removal (item 1); `formatExactText` contradiction (item 5). Listed here so the count is complete.

### [P3] 1. "A stable canonical serialization" must be the whole envelope, not a digest

`useScope` reconstructs the scope object *from the key string*
(`scope.ts:40–41`: `const scope = useMemo(() => readScope(new URLSearchParams(key)), [key])`). If
`scopeKey` folded the envelope into a hash or a short fingerprint, the memo would rebuild a scope
whose drill is unreadable. One clause at Plan:325–327: *"the canonical serialization is the
complete envelope, because `useScope` rebuilds the scope object from the key string."*

### [P3] 2. Period is the only scope control that is not a `Dimension`

Plan:349–351 has `ScopeBar` render Source/Agent/Model from the facets response "and adds the fixed
Period select", while `bars.tsx:37` maps `dimensions` uniformly and `Dimension.key` is typed
`ScopeKey` — which will include `period`. A fixed select beside a mapped list means two code paths
and a chip whose label comes from a different place than the other three. Cheaper and more
consistent: pass Period as a `Dimension` with fixed options. One sentence either way.

### [P3] 3. The stale DNS sentence in `docs/api/v0.1.md`

Verified still present at `docs/api/v0.1.md:569–571` ("**The required initial real snapshot is
currently blocked by DNS resolution in the execution sandbox.**") while
`backend/prices/openrouter-v1.json` is committed. The plan's decision to leave it to D2-03B rather
than fold an unrelated correction into its own API-doc edit (Plan:822–826) is right. Worth one line
in the D2-03b hand-off so it is not lost: #11 edits the same file and will be the last to read that
paragraph before v0.1.0.

---

## What the revision gets right

- **It did not paper over finding 8.** The easy move was to quietly drop the Scheduled-cost tile or
  imply a value. Instead the plan keeps the slot, states that its shipped state on the only
  demonstrable dataset is `Unavailable`, pins that state in a component test *and* the visual
  review, and files the model-ID mismatch as D2-03b rather than aliasing a model string. Only the
  quoted reason is wrong (P1 #1); the reasoning is exemplary.
- **Finding 15's capability matrix is declined, not silently dropped.** Plan:511–516 says merged #10
  exposes no source-by-capability result and that inferring `Unprofiled` from absence would violate
  the trust rule, then leaves the gap visible in Risks. That is the right answer to a MERGED
  requirement the server cannot yet support.
- **Finding 10 is answered with a rule rather than an assertion of equality.** Naming the null-day
  bucket authoritative when present, `excluded_unknown_timestamps` under a period, and disabling
  List rather than opening a differently sized population is a better design than the first review
  asked for.
- **The period formula is now unambiguous**, including the worked 2026-09-08 example, the browser
  clock as the reference, the moving-bookmark consequence, and the resolved range printed in the
  receipt so `?period=7d` never leaves "which seven days" implicit.
- **The `format.ts` carve-out is handled without cheating.** #11 needed decimal-string abbreviation,
  the coordinator gave the file to #46, and the plan neither edits it nor parses transport text
  through `Number` — it writes a local decimal-string helper and says so.
- **The exactness discipline survived the revision intact**, and the e2e section now carries it into
  the only test that touches real data: registry labels, `selectOption`, the two exact partitions
  with coverages, the server refusal reason, and an explicit negative assertion that `553,447,877`
  is never rendered as a KPI value.

---

## Go / no-go

**GO for implementation once the coordinator lands the two P1 edits (the server reason string, and
the re-quoted parallel boundary that removes `Session.tsx` from #11) plus the six coordination
paragraphs; no third cross-review round is needed, and #46 may start in parallel as soon as its
§0.4 merge-order section is corrected.**
