# Merge draft: Opus 5 × Codex gpt-6-astra

Prepared for the owner's merge session, 2026-09-07. Sources:
`research/insights/claude-opus-5.md` (**O**) and `research/insights/codex-gpt-6-astra.md` (**C**),
both answering `research/insights/00-question.md`. Section references are the source
docs' own headings so each line can be jumped to. Nothing here is a decision; §7 lists
what only the owner can settle.

Where the two docs computed the same quantity I re-ran it against
`fixtures/tracelab/tracelab-sample.jsonl.gz` with stdlib Python; those checks are marked
**[verified]** and are the tie-breakers in §1.3.

---

## 1. Agreement

### 1.1 Insights both proposed (deduplicated)

| # | Theme | Metric | Visual | Better stated in | O § | C § |
|---|---|---|---|---|---|---|
| 1 | Token volume by model/session | `Σ input`, `Σ output` grouped by model then session, kept separate by `token_semantics` | Horizontal bars, sorted, input and output as separate series | **C** — insists the split is by accounting tag, not just by model; O's version risks one pooled axis | A1 | Catalogue A1 |
| 2 | Workload concentration | Share of tokens/observations held by top-*k* sessions | Ranked sessions table with a share column; cumulative curve on request | **O** — gives the actionable framing ("cost lives in long sessions, not fat rounds") | A2 | Catalogue A3, §1 |
| 3 | Context growth within a session | Per-call input tokens against recorded sequence | Session-scoped line/dot; median+IQR by round bucket for the fleet view | **O** — has the measured curve; **C** better on the caveat (a decline is not proven compaction) | B4 | Catalogue A2 |
| 4 | Claude cache accounting split | `Σ cache_read ÷ Σ input`, token-weighted, with creation and uncached beside it | Compact read/create/uncached stacked bar, Claude-only, conditional | **C** — supplies the reconciliation rule, the zero-input edge case and the "not money saved" wording | B1, B2 | Catalogue B1, B2, §2 |
| 5 | Observed span ≠ active time | `max(ts) − min(ts)` over accepted child timestamps, never called duration | Sessions-table column + session header label; O adds a gap-visible timeline | **O** — the visual makes the caveat self-evident; **C** — the exact UI wording | C1 | Catalogue C1, §5 |
| 6 | Tool latency by tool | median / p90 known wall latency per exact tool name within harness, with known-n | Table first; distribution on expansion | **C** — table-first, states known/all per tool; **O** — richer with the totals column | C2 | Catalogue C2, §4 |
| 7 | Tool mix | Counts and shares of tool observations by exact name, by provider | Horizontal bar, top-*n* + other, exact-name filtering | tie — O grouped by provider, C insists names are not interchangeable operations | D1 | Catalogue D1 |
| 8 | Tool error rate on a known denominator | `errors ÷ known Boolean statuses`, coverage shown in the same element | Table column (C) / dot plot with coverage bars (O) | **C** — the exact display string and the all-null → Unavailable rule | D2 | Catalogue D2, §3 |
| 9 | Tools per round / zero-tool rounds | Distribution of `len(tools)` per call; share of calls with none | Two numbers in the session header, or a small histogram | **O** — has the distribution (p50 1, p90 2, max 9) | D5 | Catalogue D1 |
| 10 | Session size skew | Rounds per session: median, p90, max, fixed bins | Compact histogram with explicit bins and median annotation; bin → sessions | **C** — declares the bins and the percentile rule; **O** — makes the mean-vs-median trap explicit | E1 | Catalogue E1, §1 |
| 11 | No task success | Nothing computed; a stated absence | A definitions-page line, not a blank chart | tie — identical conclusion, C supplies the UI string | E3 | Catalogue E3 |
| 12 | Reasoning is asymmetric | `Σ reasoning ÷ Σ output`, Codex-only; Claude renders Unavailable, never 0 | Bar per model with Claude greyed and labelled (O) / a Codex-only column (C) | **C** — refuses the leaderboard and keeps the ratio a diagnostic; **O** — has the per-model detail | F1 | Catalogue F1, §6 |
| 13 | Coverage / capability matrix | Per target field `known ÷ total` by source and harness, plus the cause of unavailability | One-line dashboard quality strip expanding to a matrix | tie — same design; **C** adds "schema presence ≠ non-null coverage" and the Unprofiled state | G1 | Catalogue G1 |
| 14 | Non-chronological events | Share of calls whose `timing_events[]` timestamps are not non-decreasing | Quality-strip badge + per-session annotation; bounds from min/max | **C** — says to sort a display copy while preserving original positions | G2 | Catalogue G3, §5 |
| 15 | Identity and import counts | Distinct vs claimed `round_id` / `trace_key` / `(session_id, round_index)` / tool-call id | Import-report lines | **C** — separates exact-file idempotency from cross-export overlap; **O** — names the missing test fixture | G3 | Catalogue G2, §5 |
| 16 | Tool results expanding context | `result_chars` distribution per tool; context-composition share | Ranked results table / box plot, on demand | **O** — has the numbers and the chars≠tokens proof; **C** — snapshots must not be summed | D4, B5 | Catalogue D4 |
| 17 | Repeat-after-error sequences | Same-tool observation following a marked error | Session-detail sequence view, number in a report | **C** — the honest name ("repeated tool observation; command identity unavailable") | D3 | Catalogue D3 |
| 18 | Cohort comparison must be curated | Allow-list of comparable metrics with per-row coverage; incompatible panels split | Two-column comparison card / cohort report | **O** — proposes mechanical refusal of incomparable slices; **C** — explains why a project filter cannot fix it | H1, H4 | Catalogue H1 |
| 19 | Multi-model sessions | Distinct model labels per session; raw labels preserved, never normalised | Model chip(s) in the session header, warning chip if >1 | tie — same finding (79/80 single-model) and same "labels are source claims" rule | H3 | Catalogue H2 |
| 20 | Cost needs configured prices | `Σ tokens × configured rate`, with priced/eligible coverage | Later report; no empty cost tile in v0.1.0 | **C** — enumerates the buckets, TTL/tier and rounding hazards; **O** — the cache-read-rate point | A5 | Catalogue A4 |
| 21 | Provenance drill-down to the exact record | Every value → session → occurrence → file hash + locator + field path + mapping revision | Raw record drawer | **C** — the nested-index requirement and a concrete worked target; **O** — "one click to a session, two to a source record" | 6.4 | Metric contract; path table |

### 1.2 Numbers both computed — agreement

Identical in both docs and **[verified]**: sessions 40/40/80; model-call observations
1,583/3,187/4,770; tool observations 1,797/3,926/5,723; median rounds per session
12/26/19; input tokens 186,454,781 / 366,993,096; Codex output 1,542,659; Claude
token-weighted cache-read share **95.61%**; Codex `prefix ÷ input` **95.99%**; tool
errors **296** among **4,834** known of 5,723 (**6.12%**; Claude 4.41%, Codex 7.14%);
`write_stdin` 38 errors of 342 known of 826; reasoning tokens **711,948** and
reasoning÷output **46.15%**; non-chronological calls **212** (6 Claude, 206 Codex);
wall latency known 5,718/5,723; internal latency known 3,411/5,723 (Claude 4/1,797);
zero-tool calls **440**; `project` present on 1,583/4,770 and on no Codex row; exactly
one multi-model session; max observed span **1,309,340.8 s = 363.7 h = 15.15 d**; zero
native-ID collisions in the fixture against documented upstream duplicates.

### 1.3 Contradictions to resolve before anything is published

| Quantity | O | C | **[verified]** | Cause |
|---|---|---|---|---|
| p90 rounds per session | 140 (O E1) | 139 (C §1) | **139** nearest-rank; 139.6 linear | O did not declare a percentile rule; C declares nearest rank (`sorted[ceil(p·n)−1]`). Owner decision in §7 Q6. |
| p25 rounds per session | 5 (O E1) | not stated | **4** nearest-rank | same rule gap |
| `Read` p90 wall latency | 281 ms (O C2) | 288 ms (C §4) | same rule gap; C's value follows its declared rule | same |
| `Bash` median wall | 204 ms (O C2) | 203.5 ms (C §4) | 203.5 (even-n median averages the two central values, C's stated rule) | same |
| "union of tool intervals" | **21.1 h** (O C1, L3) | not computed | union is **18.86 h** (Claude 12.96, Codex 5.90); **21.09 h is the *sum* of wall latencies** | O's C1 labels a sum as a union. O's derived per-provider figures (Claude 47.8%, Codex 1.4% of observed span) *do* match true unions (12.96/27.2 = 47.6%, 5.90/429.1 = 1.4%), so only the headline sentence is wrong. Fix before quoting L3. |
| errors used for the retry figure | "196 of 288 errors (68.1%)" (O D3) | 296 errors (C §3) | **[verified] 288** = errors that have a following tool observation in session order; 196 same-tool → 68.1% exactly | Not a contradiction, but O never states the reduced denominator. Any shipped figure must say "288 marked errors with a subsequent observation". |
| `write_stdin` share of tool time | 20.9% (O C2) | 72.23% (C §4) | both correct | different denominators: O = all tool wall time (21.1 h), C = Codex tool wall sums (22,012,865 ms). Never print either without its denominator. |

---

## 2. Unique to Opus

| Insight | O § | Value 1–5 | Why |
|---|---|---|---|
| Cache warm-up curve by round bucket (Claude rounds 0–9 read 83.75% → rounds 20–29 read 97.84%; only 2.1% of Claude rounds fully cold) | B2 | **4** | Turns the static 95.61% into an operational fact — the first ~20 rounds carry essentially all cache-creation cost. Claude-only; needs the labelled-empty-panel pattern. |
| Cache collapse / re-warm detection (36 of 1,543 Claude transitions drop `cache_read` >50%) | B3 | **3** | Good session-detail pointer, honestly worded ("cache read fell sharply"). Low frequency, so no dashboard claim. |
| Timeout signatures (`write_stdin` 112 of 826 calls at 29–31 s, 10 at ≥119 s; `Bash` 9 calls ≥600 s) | C3 | **4** | Highest "changes a config the same afternoon" ratio in either doc. Cheap: one histogram inside the existing tool drill-down. |
| Tool-vocabulary drift over months (`shell` → `shell_command` → `exec_command`, tracking model generation; Claude's TaskCreate/TodoWrite/Skill appear only 2026-05) | H2 | **5** | Invalidates every long-range tool chart, and the banner is the mitigation. The one finding that changes an already-planned chart's correctness. |
| `shell`'s 0 ms / 1 ms latencies are un-instrumented, not fast | H2 | **4** | Concrete instance of "Unavailable dressed as a number"; directly contested by C (see §3.8). |
| Dangling tool calls: 5,723 `tool_call` events vs 5,705 `tool_result`; 5 tools with null `result_at` | G4 | **4** | The only available "agent hung / session killed mid-tool" signal, and a `COUNT(*)` erases it. Nearly free at import. |
| Implausible-measure flags (11 sessions with output÷input < 0.0005; a 1-round session with 168,891 input → 3 output tokens; 83 rounds under 10 output tokens) | G5 | **4** | Explains a chunk of the token chart as compaction/classification traffic rather than work. Flag, never reject. |
| Latency internal consistency proof (`wall_latency_ms` reconciles to `result_at − emitted_at` exactly on all 5,718; zero negatives) | G5 | **3** | Licenses trusting wall latency without a caveat — a rare positive result worth stating once. |
| Duplicate-source risk from the `.claude.back` store (30 / 10 / 40 sessions, intersection 0) | G6 | **3** | Names the failure mode ADR-002 defers; one import-report line. |
| Single-round sessions (8 of 80, all with zero tool calls) | E2 | **3** | Materially moves the median; needs a documented population on the session KPI. |
| Output÷input ratio as a shape fact (0.0045 overall; suppress n<30) | A3 | **2** | True but not daily; O itself files it under report. |
| First-input-event composition: 90.2% of rounds begin with `tool_result`, only 542 `user_message` events; new input is 96.9% tool results (Claude) / 84.1% (Codex) | §0, B5 | **4** as narrative, **2** as a metric | The strongest single story the data tells; C's D4 warns the counters are snapshots, so it belongs in prose, not a tile. |
| Session end-reason proxies (last round has no tools / last tool has no result / last tool errored) | E4 | **2** | Honest chip, but three weak proxies stacked. |
| Think-time proxy: round span p50 5.7 s; time-to-first-tool p50 4.9 s Claude / 5.3 s Codex | C4 | **3** | Striking cross-provider similarity; the proxy caveat (non-chronological events) is well handled. |
| Users and projects table (20 users, 23 Claude projects, no project shared between users) | E5 | **2** | Reframes `project` as a per-user workspace, not a team dimension — prevents a wrong chart more than it enables a right one. |
| Model drift stacked area by month | H3 | **2** | Nice context, duplicated in spirit by C's H1 cohort report. |
| "Five things I would cut" (total-tokens headline, average duration, pie charts, uncovered error leaderboard, merged cross-source series) | §8 | **4** | A merge-session accelerator: four of five are things a default dashboard would otherwise ship. |
| Mechanical refusal: mixed `token_semantics` in a slice returns "not comparable (2 token semantics)" instead of a number | H4, 6.6 | **5** | The strongest engineering expression of the shared comparability rule; C states the principle, O makes it a code path. |
| Fixed dashboard budget (4 KPIs + 3 charts + 1 quality strip; "the dashboard never grows") | 6.1, 6.6 | **4** | A governing rule, not an insight, and the cheapest defence of progressive disclosure. |

## 3. Unique to Codex

| Insight | C § | Value 1–5 | Why |
|---|---|---|---|
| Fan-out join hazard: never sum model-call tokens after joining to tools (one call with three tools triples its tokens); aggregate per entity grain or select distinct occurrences first | Metric contract | **5** | The single highest-value line in either document. This is the bug that silently inflates every token number, and it is invisible in a chart review. |
| Wall vs internal latency pairing diagnostic: Claude pairs 4/1,797, Codex 3,407/3,926, **43 cases where internal > wall** | Catalogue C3, §5 | **4** | Kills the tempting `wall − internal = overhead` KPI with evidence, and gives a real on-demand diagnostic. |
| `write_stdin` = 72.23% of summed Codex tool wall latency, explicitly framed as a share of interval sums, not of elapsed time | §4 | **4** | The Codex-side equivalent of O's `Agent` finding, with the overlap caveat O omits. |
| Concrete drill-down target: fixture line **2,979**, `$.tools[0]`, `Agent` 9,653,425 ms, session `claude:bdb582f4-92ca-39cc-8068-bc55e6d1aeec`, round 135, sibling `$.tools[1]` at 3,648,160 ms | §5 | **4** | Turns "preserve the nested index" from a principle into an acceptance test. |
| Undated records under a date filter: report "N undated observations cannot be placed in the range" rather than silently excluding them | Metric contract | **4** | A whole class of silent wrongness neither the plan nor O covers. |
| Model-filter semantics: select matching calls, include their linked tools, count distinct sessions containing those calls; unlinked tools identified separately, never assigned a model | Metric contract | **4** | Filters are the dashboard's main interaction; without this rule every filtered number is arguable. |
| Filtered session span must state whether it uses the full imported session or only matching observations | Metric contract | **3** | Subtle and certain to be got wrong once. |
| Use the raw API's `payload_text` for exact display; browser number reserialisation rounds large integers | Display section | **4** | Directly relevant given 100 M+ token values and the domain work already done on exact decimals. |
| Distinct actions "View errors" / "View known statuses" / "View unknown statuses" — three different populations | Display section | **4** | Makes the known-denominator rule navigable instead of merely stated. |
| `update_plan`: 0 of 30 known statuses → **Unavailable**, never "0% errors" | §3 | **4** | The clearest worked example of the all-null rule; ideal reference test. |
| Reasoning inclusion semantics unvalidated: `reasoning ≤ output` on every row is necessary, not sufficient; never add reasoning to output | Catalogue F2, §6 | **4** | Prevents a double-count that would look plausible. |
| Preserve observed zero latencies; if a log scale is used, label it and handle zeros explicitly | Display section | **3** | Directly contradicts O on `shell` (see §4.8). |
| Import record outcomes (accepted / partial / rejected / ignored / duplicate) with entity counts on separate denominators; and the discipline of not inventing counts because no import was run | Catalogue G4 | **4** | The import report O sketches, specified. |
| Reproducibility contract: metric ID + version, saved filters, mapping versions, file hashes, quantile rule, rounding travel with every report | Metric contract | **4** | Resolves the §1.3 percentile contradiction structurally rather than by fiat. |
| "Which sessions deserve manual review?" — deterministic sorts/filters with explicit inclusion reasons, no anomaly score | Catalogue E4 | **3** | Honest replacement for the anomaly detection both docs reject. |
| Return-to-user rate as a deferred metric (542 user-message entries are context snapshots, not independent turns) | Catalogue E2 | **3** | The caveat that stops O's 542 figure being turned into a "human supervision rate". |
| Verified fixture SHA-256 `d044a766…fb9897`, seed 42, no native-ID dedup, source order retained | Evidence and source boundaries | **3** | Makes every number in the doc re-checkable; O gives provenance in prose only. |
| "Before rich graphs, implement the simpler table that answers the same question"; avoid Sankey / force-directed graph / scatter wall | Later work; Display | **4** | The design rule that keeps a 4-day timebox honest. |
| Neutral text over healthy/unhealthy colouring; thresholds are documented product rules, not statistical guarantees | Display section | **3** | Prevents the dashboard implying judgements the data cannot support. |
| Day-by-day integration sequence mapped onto the existing plan's gates | Priorities section | **3** | Directly usable as the merge session's schedule skeleton. |
| Adversarial fixture with duplicate claimed IDs and out-of-order timestamps, because the 80-session sample exercises neither | Priorities section | **4** | Same gap O identifies in G3, but stated as a work item. |

---

## 4. Disagreements

**4.1 May a cross-provider context-reuse ratio exist at all?**
O (B1, §4 KPI 2) makes `prefix_tokens ÷ input_tokens_total` the headline KPI on the
grounds that it is 100% covered on both providers and provably equals
`claude_cache_read_input_tokens` on all 1,583 Claude rows. C (§2, Catalogue B1) refuses:
the numerical resemblance "does not authorize a Codex cache-read metric or
cross-provider cache ranking", and prefix tokens are deliberately left in raw evidence
by the mapping. **Hinges on** whether a metric named "prefix reuse (billing status
unknown)" is distinct enough from "cache read" to survive being on the same wall, and
whether a v0.1.0 KPI may be built on a raw extension rather than a canonical field.

**4.2 What the four KPI slots are for.**
O: sessions, context-reuse ratio, tool error rate, observed span — insight numbers,
each with population and coverage in the tile, explicitly dropping a total-tokens
headline (§4, §8.1). C: sessions, recorded model-call observations, recorded tool-call
observations, input usage split by accounting group — aligned with the existing API
contract, KPIs as navigation surfaces (Priorities section). **Hinges on** whether the
dashboard's job is "here is a fact" or "here is where to look", and on how much churn
the day-2 API can absorb.

**4.3 Observed span as a KPI.**
O ships it as KPI 4 with a tooltip (§4, C1). C keeps span in the sessions table and
session header with the fixed label "Observed span in imported data" (Catalogue C1,
Display table) and warns that a 15.15-day span is meaningless as a headline. **Hinges on**
whether a KPI tile can carry enough caveat to be honest, given the 456.2 h / 18.9 h
active gap (and note the §1.3 fix to O's 21.1 h figure).

**4.4 Session timeline in v0.1.0.**
O puts a gap-visible tool timeline in the day-2 shortlist (~4 h, item 5) because it makes
L3 self-evident. C defers swimlanes to Later stage 3 and ships an ordered session table
in v0.1 (Catalogue C4). **Hinges on** the 4-day budget and whether the ordered table plus
the span label already discharge the caveat.

**4.5 Tool insight: plot or table.**
O: per-tool error dot plot with coverage bars plus a calls↔time toggle on the existing
chart (D2, C2). C: a plain table below the tool-count chart carrying count, errors,
known statuses, rate, median and p90 wall, known-n (P1), on the principle "before rich
graphs, implement the simpler table". **Hinges on** whether one table can hold six
columns legibly, and whether the calls↔time story survives without a visual.

**4.6 Repeat-after-error.**
O ships 68.1% (D3) as a session-detail feature with a report headline. C defers
(Catalogue D3): tool input is absent on all 5,723 tools and no continuation key exists,
so adjacency is a weak candidate and "retry rate" is an unsupported label. **Hinges on**
whether the wording "repeated tool observation; command identity unavailable" makes the
number publishable, and on the §1.3 denominator (288, not 296).

**4.7 Cache work: now or later.**
C makes the Claude cache read/creation/uncached panel P3 inside the timebox (complete
measured coverage, conditional panel). O relegates warm-up and collapse to Later item 1,
preferring the reuse ratio (which C rejects, §4.1). **Hinges on** §4.1: if the
cross-provider ratio is refused, the Claude-only panel is the only cache view left and
its priority rises.

**4.8 Zero-latency `shell` observations.**
O (H2): 84 calls at 0 ms and 38 at 1 ms are un-instrumented, so a latency chart must
exclude or flag them. C (§4, Display): they are real reported values — preserve them,
never silently discard observed zeros, and do not celebrate them either. **Hinges on**
whether "exclude with a visible reason" counts as silent discarding; a flag-and-keep
compromise likely satisfies both.

**4.9 Character-based composition metrics.**
O (B5) publishes the 96.9% / 84.1% tool-result share of new input as report-page prose,
with a proof that chars are not tokens. C (Catalogue D4) treats context counters as
snapshots that may repeat content across rounds and requires separate validation before
any aggregation. **Hinges on** whether an aggregate over snapshot counters is
interpretable at all, or only per-call.

**4.10 The reasoning ratio.**
O (F1) presents 46.2% plus a per-model decline (`gpt-5.2-codex` 63.1% → `gpt-5.5` 34.4%)
as a real trend. C (§6, F2) allows the ratio only as an accounting diagnostic pending
inclusion-semantics validation, and rejects any model comparison from a
provider-stratified, non-task-matched sample. **Hinges on** whether "in the imported
data" framing is sufficient to publish generational trends.

**4.11 Percentile and rounding rule.**
Unstated in O, declared in C (nearest rank, even-n medians averaged). This produced
p90 140 vs 139 and three smaller divergences (§1.3). **Hinges on** picking one rule and
attaching it to reports (C's reproducibility contract).

**4.12 Concentration on the dashboard.**
O wants a one-line KPI ("top 5 sessions = 52.7% of input tokens") expanding to a table
(A2). C wants the ranked table with a share column and the cumulative curve **only on
request** (Catalogue A3). **Hinges on** dashboard budget discipline (O's own 4+3+1 rule
argues for C here).

---

## 5. Proposed v0.1.0 shortlist

Eight items, on top of the committed 4 KPIs and 3 charts (activity by day, tokens by
model, tool counts). Ordered; items 1–5 are the defensible minimum, 6–8 are the stretch.

| # | Item | Metric | Fields | Sources | Coverage caveat | Visual | Lives in | From |
|---|---|---|---|---|---|---|---|---|
| 1 | Coverage and comparability beside every value | `known ÷ total` per field per source/harness; `Unavailable` as a rendered state; mixed `token_semantics` refuses to aggregate | all canonical fields + mapping diagnostics | TL measured; SW/TC render as **Unprofiled**, not 0% | this *is* the caveat surface; schema presence ≠ non-null coverage | one-line quality strip → capability matrix | dashboard strip → panel; import report | **both** (O G1, §6.6; C P0, G1) |
| 2 | Tool diagnostic table | per exact tool name × harness: calls, marked errors, known Boolean statuses, error rate on known, median and p90 wall latency, known-n | `tools[].tool_name`, `is_error`, `tool_wall_latency_ms`, provider/harness | TL only (SW has no verified error or latency column) | `is_error` known on 4,834/5,723; `write_stdin` 342/826; `update_plan` 0/30 → Unavailable; wall known 5,718/5,723 | table under the existing tool-counts chart; row → tool occurrences → `$.tools[i]` | dashboard (expansion) | **both** (C P1; O D2+C2) |
| 3 | Tool error rate figure with its denominator | `296 ÷ 4,834` rendered as "6.12% of known statuses · 4,834 / 5,723 known, 889 unknown" | as #2 | TL only | never divide by 5,723; unknowns are provider-shaped (Codex 885 of 889) | KPI-sized number with in-tile denominator; three actions: view errors / known / unknown | dashboard | **both** (O D2; C §3) |
| 4 | Calls ↔ time toggle on the tool-counts chart | `Σ wall_latency_ms` per tool as an alternate series | `tool_wall_latency_ms`, `tool_name` | TL only | sum of intervals, not elapsed time — intervals can overlap; exclude-or-flag `shell` 0 ms (§4.8); `Agent` contains a nested session | one control on the planned chart | dashboard | **Opus** (O C2, §4 item 3) — supported by C's own `write_stdin` 72.23% finding |
| 5 | Rounds-per-session distribution | median, p90, max + five fixed bins (1–5 / 6–20 / 21–50 / 51–100 / 101+) | session identity, occurrence-counted model calls | TL 80/80; SW needs `api_call_count` reconciliation | count by occurrence, never `max(round_index)+1`; mean 59.6 vs median 19; declare the percentile rule (§4.11) | compact histogram with median annotation; bin → its sessions | sessions view (or chart expansion) | **both** (C P2; O E1) |
| 6 | Claude cache accounting panel | token-weighted `Σ read ÷ Σ input` with creation and uncached; residual reconciled, never clamped | `claude_cache_read/creation/uncached_input_tokens`, `input_tokens_total` | TL-C 1,583/1,583; **TL-X 0/3,187** | Codex selection renders "Unavailable — this mapping does not provide Codex cache accounting"; not a hit rate, not money saved; zero-input denominator → "Not defined" | read/create/uncached stacked bar, conditional on a compatible selection | dashboard (conditional panel) | **both** (C P3; O B1–B2) |
| 7 | Tokens-by-model chart, corrected | `Σ input`, `Σ output` by model, **partitioned by `token_semantics`**, series selectable | `input_tokens_total`, `output_tokens`, `model`, `token_semantics` | TL 4,770/4,770; SW blocked pending grain validation | never one pooled "total tokens" headline; label the axis "tokens as counted by the source"; prefix/new split only if §4.1 resolves toward showing it | existing bar chart, split by tag | dashboard (planned chart, changed) | **both, contested default** (C A1; O A1 wants the reuse stacking) |
| 8 | Session detail: header + ordered call/tool table | harness, model chip(s), user, project or "Unknown project", **observed span in imported data**, rounds, tools, marked errors, coverage; ordered rows with error and dangling-call markers | session rollups, `timing_events` min/max, tool endpoints, `is_error` | TL complete; project on Claude rows only | span includes idle time and resumptions; 212 calls have inverted event order — sort a display copy, preserve positions; virtualise (max session = 717 rounds) | header chips + virtualised table; every row → raw record with nested index | session detail | **both** (O 6.3, C1; C Display table, C4) — O's gap-visible timeline is the stretch (§4.4) |

Deliberately **not** in the shortlist: currency cost, any success metric, anomaly
scoring, cross-source merged series, retry rate, a total-tokens headline, and average
session duration.

---

## 6. Later list

**Caching and context** — cache warm-up curve by round bucket (O B2); cache-collapse
markers in session detail (O B3); per-session cache/context trajectories with model
changes annotated (C later stage 2, B3); fleet context-growth curve with a folded tail
(O B4).

**Time and latency** — timeout-signature histograms per tool (O C3); wall-vs-internal
paired scatter and the 43 internal>wall diagnostic (C C3, §5); zoomable swimlane
timeline with interval-overlap description and no fabricated critical path (C later
stage 3, C4); round-span / time-to-first-tool ECDF as a think-time proxy (O C4).

**Tools and sequences** — tool-vocabulary drift banner and monthly share area (O H2);
result-size distributions and ranked large results (O D4, C D4); repeat-after-error
sequence table once wording and denominator are settled (O D3, C D3); tool-family
dictionary retaining native names (C D1).

**Sessions and workload** — concentration table with cumulative share on request
(O A2, C A3); single-round-session filter and its effect on the population (O E2);
manual-review sorts with explicit inclusion reasons (C E4); session end-reason chip
from proxies (O E4); return-to-user rate once message identity is validated (C E2);
users and projects table with its 33.2% coverage stated (O E5).

**Models and comparison** — model drift stacked area by month (O H3); cohort comparison
report with n, coverage and separate incompatible panels (O H1, C H1); saved cohort
reports carrying filter/metric/mapping versions (C later stage 5); before/after and
matched-task evaluation, explicitly separated from observational analytics (C H3).

**Cost and outcomes** — configured price schedule as a versioned user-owned object with
cache-read rates and priced-coverage display (O A5, C A4, C later stage 6);
user-attached outcome labels with label source and evaluation version (O E3 note, C E3,
C later stage 7).

**Quality and infrastructure** — import record-outcome report (C G4); duplicate-source
overlap check across stores (O G6); adversarial fixture for duplicate IDs and inverted
timestamps (O G3, C priorities); implausible-measure flag table (O G5); reasoning
inclusion-semantics validation (C F2); SWE-chat / Trace Commons profiling of a bounded
excerpt (C later stage 1, O L9).

**Explicitly rejected by both** — anomaly detection, forecasting, composite
"efficiency scores", reasoning-vs-quality correlation (O F2, C F3), per-file/per-repo
analytics from TraceLab (tool input removed), natural-language data questions.

---

## 7. Limits the UI must state

### 7.1 Both agree

1. **No task success.** No verified outcome label in any source. UI: "Task outcome:
   Unavailable — no verified outcome label." A stated absence, not a blank chart.
   (O L1/E3; C E3, limits table.)
2. **No prices.** UI: "Cost estimates require a price schedule and compatible usage
   accounting." No currency symbol in v0.1.0. (O L2/A5; C A4, limits table.)
3. **Observed span is not active time.** 456.2 h observed against 18.9 h of union tool
   activity **[verified]**; max span 15.15 days. UI: "Observed span in imported data.
   May include idle time and resumptions." No average duration statistic. (O L3/C1;
   C C1, §5.)
4. **Unknown is never zero.** Cache Unavailable for Codex, reasoning Unavailable for
   Claude (452 Claude reasoning events prove reasoning occurred), error rate Unavailable
   for all-null tool groups. (O L6/F1; C §2, §3, §6, limits table.)
5. **Every rate carries its known denominator in the same element** — not a tooltip.
   (O 6.6.1; C metric contract.)
6. **Event arrays are not chronological** (212 calls). Bounds from min/max; a sorted
   display copy must say it sorted. (O L4/G2; C §5, G3.)
7. **Native IDs are not trustworthy in general**, and this fixture cannot prove either
   way. Counts are "recorded model-call observations". Exact-file idempotency is the
   v0.1.0 guarantee; cross-export overlap may remain. (O L5/G3; C §5, G2.)
8. **The fixture is a stratified 40+40 draw**, not a population estimate. Every chart is
   scoped to "the imported data". (O L8; C evidence section, H1.)
9. **Two of three sources are unvalidated or unprofiled**; they cannot share an axis
   with TraceLab. (O L9/H4; C evidence table, G1.)
10. **Characters are not tokens.** Never convert. (O L7/B5; C D4.)
11. **Tool input was removed** — no command replay, no per-file analytics, no semantic
    task categories. (O L10; C limits table.)

### 7.2 Raised by only one

**Opus only** — chars and tokens actively disagree (`newly_append_tokens` exceeds
`current_input_chars` on 57.4% of Claude rounds, ratio 1.50 tokens/char), so the char
counters cover a narrower scope (L7/B5); a low output÷input ratio is arithmetic, not
inefficiency — do not colour it red (A3); zero-tool rounds are text rounds, not failures
(D5); `project` covers 33.2% of rows and the remainder must appear as an explicit
"Unknown project" rather than be dropped (E5); `.claude.back` means real imports will
contain backup copies (G6); a 0 ms latency can be an absent instrument (H2); suppress
per-group rates with known-n < 30 (6.6.4).

**Codex only** — do not sum call tokens across a tool join (metric contract); undated
records must be reported under a date filter, not silently dropped (metric contract);
a filtered session span must say whether it is the full imported span or the matching
observations only (metric contract); wall/internal difference is not overhead — 43
observations have internal > wall (C3, §5); reasoning must not be added to output and
`reasoning ≤ output` is not proof of subset semantics (F2); pseudonymous users and
project labels do not support performance rankings of people (limits section); model
strings are recorded claims, not catalogue entries (H2); `payload_text` must be used for
exact display because browser reserialisation rounds large integers (Display); record
outcome percentages and entity coverage use different denominators and cannot be
combined (G4); "Unprofiled" is a distinct state from "0% coverage" (G1).

---

## 8. Questions for the owner

1. **Prices.** Configure a price table at all? Options: (a) never in v0.1.0 — no
   currency anywhere [both docs' recommendation]; (b) build the versioned user-owned
   schedule now with cache-read rates and priced-coverage display; (c) ship an unpriced
   token view and a "configure prices" empty state. *Consequence*: (a) costs nothing and
   protects trust; (b) eats most of a day and, with ~96% of input being reused prefix,
   is dominated by an unknown cache-read discount; (c) permanent empty space that C
   explicitly rules out.

2. **May Codex `prefix_tokens` be shown?** (§4.1) Options: (a) headline KPI "context
   reuse 95.9%" across both providers [O]; (b) labelled secondary series "prefix reuse
   (billing status unknown)", never on the cache panel; (c) raw evidence only, no metric
   [C]. *Consequence*: (a) gives the strongest single number in the product but attaches
   a canonical-looking KPI to a raw extension whose billing meaning is unproven;
   (b) keeps the insight and the honesty at the cost of a wordy label; (c) leaves the
   Claude-only cache panel (shortlist #6) as the only caching view.

3. **What the four KPI slots are for.** (§4.2) Options: (a) insight numbers — sessions,
   reuse ratio, error rate, observed span [O]; (b) navigation counts aligned to the
   existing API — sessions, model calls, tool calls, input usage by accounting group [C];
   (c) hybrid — counts plus the error rate. *Consequence*: (a) a more opinionated
   dashboard, day-2 API churn, and it depends on Q2; (b) zero API churn and no
   contested metric, but the dashboard states nothing a user could act on; (c) one
   contested slot only.

4. **May observed span be a KPI tile?** (§4.3) Options: (a) KPI with in-tile caveat
   [O]; (b) sessions-table column and session-header label only [C]. *Consequence*:
   (a) the 456 h / 18.9 h gap is visible on day one but the tile must carry a sentence
   of caveat; (b) safer, but "how long did this take" then has no answer on the
   dashboard.

5. **Which token semantics may share an axis?** Options: (a) never — separate panels
   per tag; (b) same tag only, and a mixed slice returns a machine-enforced refusal
   ("not comparable: 2 token semantics in selection") with a split button [O H4];
   (c) allow pooling with a label. *Consequence*: (a) safest, most panels; (b) one
   metric-layer feature that makes the rule impossible to violate later — both docs
   point here; (c) fastest and the one way to ship a number that is quietly wrong.

6. **Percentile, rounding and publication rule.** (§4.11, §1.3) Options: (a) adopt C's
   nearest rank + even-n median averaging and attach the rule to every report [C];
   (b) linear interpolation; (c) leave to implementation. *Consequence*: (a) p90 rounds
   per session publishes as **139**, `Read` p90 as **288 ms**, and O's 140 / 281 ms must
   be corrected before any of these numbers leave the repo; (b) 140 / 281 ms stand but
   the rule must still be declared; (c) the same figure differs between the API, the
   docs and the release notes.

7. **Does v0.1.0 get the session timeline?** (§4.4) Options: (a) gap-visible tool
   timeline in session detail (~4 h) [O]; (b) ordered call/tool table only, timeline
   later [C]; (c) table now, timeline behind a "show timeline" control. *Consequence*:
   (a) makes the observed-span caveat self-evident and is the natural drill-down target,
   at real cost inside a 4-day box; (b) protects the day-4 verification gates and the
   second-source work; (c) the control itself costs something and may ship half-drawn.

8. **Repeat-after-error: publish or defer?** (§4.6) Options: (a) publish 196 of **288**
   marked errors with a following observation (68.1%) as "repeated tool observation";
   (b) session-detail visual only, no aggregate; (c) defer entirely until command
   identity exists [C]. *Consequence*: (a) a genuinely interesting behavioural number
   that will be read as "retry rate" no matter the label; (b) keeps the evidence and
   drops the claim; (c) loses the most concrete loop-behaviour finding in either doc.

9. **Reasoning: how far may it be shown?** (§4.10) Options: (a) the 46.15% ratio plus
   the per-model trend as a finding [O]; (b) the ratio as an accounting diagnostic on
   the definitions page, no model comparison [C]; (c) per-call reasoning tokens in Codex
   session detail only. *Consequence*: (a) a striking generational story drawn from a
   provider-stratified, non-task-matched sample with unvalidated inclusion semantics;
   (b) truthful and dull; (c) no aggregate to misread, but the finding is invisible.

10. **Zero and near-zero latency observations.** (§4.8) Options: (a) exclude `shell`'s
    84 zeros and 38 one-millisecond values from latency aggregates with a visible reason
    [O]; (b) always include observed zeros, flag the instrumentation question in the
    tool table [C]; (c) include, and add a per-tool "instrumentation suspect" badge.
    *Consequence*: (a) medians stop being distorted by an un-instrumented generation but
    the product starts dropping records; (b) no records dropped and a visibly odd row
    the user must interpret; (c) both, at the price of one more concept in the UI.
