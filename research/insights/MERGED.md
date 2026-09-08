# Merged insight catalogue — what AgentScope can honestly show, and where

Final deliverable for issue #28 (D2-00b). It merges the two brainstorms answering
`research/insights/00-question.md` — `claude-opus-5.md` (**O**) and
`codex-gpt-6-astra.md` (**C**) — through `MERGE-DRAFT.md` and its review
(`codex-review-of-merge-draft.md`), and applies the owner's answers to the draft's ten
questions (§4). Where the drafts disagreed, the owner's answer settles it; where they
agreed, the wording that survived the review is used.

This document is the input to **#10** (metric layer: definitions, units, coverage,
comparability, reference tests) and **#11** (dashboard: KPIs, charts, filters,
drill-down, quality strip, definitions page), and to the session page
(`#/sessions/:id`, shell from #30). Display columns follow the design of record:
ADR-006 and `research/design/claude/3-console/README.md`.

## 0. How to read this

**Evidence tags.** Every number carries where it came from; nothing here was recomputed
for this document.

| Tag | Meaning |
| --- | --- |
| **[O]** | computed in `claude-opus-5.md` against `fixtures/tracelab/tracelab-sample.jsonl.gz` |
| **[C]** | computed in `codex-gpt-6-astra.md` against the same fixture |
| **[verified]** | re-run in `MERGE-DRAFT.md` §1.2–1.3 with stdlib Python, the tie-breaker where O and C differ |
| **[review]** | recomputed in `codex-review-of-merge-draft.md`, which corrects the draft |
| **[documented]** | read from a Parquet footer / dataset note, never from the data itself |

**Display surfaces** are the Console routes: `#/overview` (four KPI cards, three charts,
one quality strip, first eight sessions), `#/sessions`, `#/sessions/:id`, `#/definitions`,
plus the two trust surfaces that ADR-006 rule 3 fixes in place — the `i` popover beside a
label (definition, unit, semantics, coverage) and the **Source record** `<dialog>`
(file hash, locator, mapping revision, exact `payload_text`). Drill-down is one
mechanism: a click appends a chip to the scope bar and navigates to sessions.

**Rules that bind every entry** (from §4): coverage renders in the same element as the
value, never in a tooltip; `Unavailable` is a rendered state and never `0`; quantiles are
nearest-rank with even-*n* medians averaged and display precision declared; a selection
mixing token-accounting semantics refuses to sum and says why; `unknown` or an
unvalidated semantics tag is never compatible with anything.

---

## 1. The v0.1.0 shortlist

Twelve entries. They include the four KPI slots and three charts already committed to the
sprint, because the decisions change what those must contain. Each entry gives the
question, the metric, its definition, its data limits, its place in the Console design,
and the issue that builds it.

### 1.1 "How much data am I actually looking at?" — the four navigation counts

| | |
| --- | --- |
| **Metric** | Four counts under the current scope: sessions, recorded model-call observations, recorded tool-call observations, input usage by accounting group |
| **Formula** | `count(distinct session)`, `count(model_call occurrence)`, `count(tool_call occurrence)`, `Σ input_tokens_total` partitioned by `token_semantics` |
| **Unit** | sessions / observations / tokens (integers; abbreviate only above 99,999 and print the exact value beneath) |
| **Scope** | the accepted population of the current scope (source, agent, model, period); occurrence identity, never claimed native ids |
| **Nulls** | a call with no usage is counted as an observation and excluded from the token sum, which reports its own `known / total` |
| **Coverage** | fixture: 80 sessions, 4,770 model calls, 5,723 tool calls **[O, C, verified]**; input tokens known on 4,770 / 4,770 **[C]** |

*Data limits.* Counts are "recorded observations", not unique API calls: upstream TraceLab
documents about 8,900 duplicate `round_id` **[O]** while this sample has no collisions for
`round_id`, `trace_key`, `(session_id, round_index)` or tool-call id within provider
**[C]** — the sample can neither prove nor refute global uniqueness. The 40+40 draw is
hash-stratified with seed 42, so provider balance and daily shape are artefacts of
selection **[O, C]**; every number is scoped to "the imported data". Never sum call tokens
after joining to tools: one call with three tools would count its tokens three times
(**C**, metric contract) — aggregate per entity grain, or select distinct occurrences first.

*Display.* The four `#/overview` KPI cards, each with its coverage fraction in the card
and a definition `i`. The scope-bar receipt (`80 sessions · 4,770 model calls · from
1 import`) restates the population beside the selects. The input card's popover carries
the by-semantics split.

*Built by* #10 (definitions, coverage, semantics partition in the response) and #11 (cards).

### 1.2 "Can I trust this number?" — coverage and comparability beside every value

| | |
| --- | --- |
| **Metric** | Per target field per source and harness: `known ÷ total`; per selection: a comparability verdict |
| **Formula** | `count(field is not null) ÷ count(rows in scope)`; verdict = `compatible` \| `not comparable: n token semantics in selection` \| `unprofiled` |
| **Unit** | percentage plus the raw fraction, always both |
| **Scope** | every canonical field, every source, every harness |
| **Nulls** | this metric *is* the null report; absent key, explicit null and failed conversion stay distinguishable in diagnostics (ADR-003) |
| **Coverage** | TraceLab measured; SWE-chat and Trace Commons render as **Unprofiled**, a distinct state from 0% **[C]** |

*Data limits.* Coverage is provider-shaped, not random: cache fields are Claude-only,
reasoning Codex-only, `project` Claude-only, internal latency effectively Codex-only
**[O]**. Schema presence is not non-null coverage **[C]**. Record-outcome percentages and
entity coverage use different denominators and cannot be combined **[C]**.

| Field | Known / total | Source |
| --- | ---: | --- |
| `tool_wall_latency_ms` | 5,718 / 5,723 | **[O, C, verified]** |
| `internal_latency_ms` | 3,411 / 5,723 (Claude 4 / 1,797; Codex 3,407 / 3,926) | **[C, verified]** |
| `is_error` | 4,834 / 5,723 known Boolean | **[C, verified]** |
| `project` | 1,583 / 4,770, and on no Codex row | **[O, verified]** |
| `reasoning_output_tokens` | Codex 3,187 / 3,187; Claude 0 / 1,583 | **[C]** |
| Claude cache fields | 1,583 / 1,583; Codex 0 / 3,187 | **[C]** |

*Display.* The one-line quality strip on `#/overview`, expanding in place to the
capability matrix, with a "List these sessions" action that appends a quality chip to the
scope. The same fractions appear inside every KPI card and table header the value belongs
to, and in full on `#/definitions`.

*Built by* #10 (coverage and comparability in the metric response, so the client needs no
knowledge — ADR-006 consequence) and #11 (strip, matrix, definitions table).

### 1.3 "What period does this cover, and what could not be placed in it?" — activity by day

| | |
| --- | --- |
| **Metric** | Model-call observations per calendar day (UTC), plus a count of undated observations |
| **Formula** | `count(model_call)` grouped by `date(min(timing_events[].timestamp))`; separately `count(model_call where no accepted timestamp)` |
| **Unit** | observations per day |
| **Scope** | current scope; the day boundary is UTC and is labelled as such |
| **Nulls** | undated observations are a named population, never silently excluded from a date range |
| **Coverage** | all 80 sessions have computable observed bounds **[C]** |

*Data limits.* The bucketing timestamp is an observed bound from mapped events, not a
guaranteed API-start instant **[C]**. The fixture's daily shape is a selection artefact
**[O]**. Under a date filter the UI reports "N undated observations cannot be placed in
the range" rather than dropping them **[C]**.

*Display.* Chart 1 on `#/overview`; a bar click appends `day 2026-06-04` and opens
`#/sessions`. The undated count sits in the quality strip, not in the chart.

*Built by* #10 (the undated population is part of the metric contract) and #11 (chart, drill).

### 1.4 "Where did my tokens go?" — tokens by model, partitioned by accounting semantics

| | |
| --- | --- |
| **Metric** | `Σ input_tokens_total` and `Σ output_tokens` by model label, partitioned by `token_semantics` |
| **Formula** | sum per (model, semantics); series are never pooled across semantics groups |
| **Unit** | tokens |
| **Scope** | accepted model-call observations in scope |
| **Nulls** | a null token value is excluded from the sum and counted in the series' `known / total` |
| **Coverage** | 4,770 / 4,770 calls in the fixture **[C]** |

*Data limits.* A selection mixing semantics returns `not comparable: 2 token semantics in
selection` with a split control, not a number (§4 Q5). Model strings are recorded claims,
not catalogue entries, and are never normalised **[C, O]**. There is no "total tokens"
headline: the axis reads "tokens as counted by the source". Fixture totals:

| Quantity | Claude | Codex | Whole sample | Source |
| --- | ---: | ---: | ---: | --- |
| Reported input tokens | 186,454,781 | 366,993,096 | 553,447,877 | **[O §2.1; C, verified]** |
| Output tokens | 941,168 | 1,542,659 | 2,483,827 | **[O §2.1]** (Codex figure also **[C, verified]**) |
| Output ÷ input | 0.0050 | 0.0042 | 0.0045 | **[O §2.1]** |
| Prefix ÷ input | 95.61% | 95.99% | 95.86% | **[O §2.1]**; Codex also **[verified]** |

The whole-sample column is a **reference expectation for checking an implementation**, not
a pooled dashboard metric: the two providers do not share a validated accounting semantics,
so the dashboard partitions and refuses rather than printing these totals as one number.

*Display.* Chart 2 on `#/overview`, horizontal bars split by semantics tag; a bar click
sets the Model select. Exact values print beside abbreviated ones; large integers travel
as text so browser reserialisation cannot round them **[C]**.

*Built by* #10 (partition and refusal rule) and #11 (chart).

### 1.5 "What did this cost?" — estimated cost from a versioned price schedule

| | |
| --- | --- |
| **Metric** | `Σ (priced token component × its rate)` under a named, versioned price schedule, with priced coverage |
| **Formula** | per component (Claude cache-read, Claude cache-creation, Claude uncached input, output) `tokens × rate`; components with no published rate or no validated billing semantics are excluded and listed by name with their token volume |
| **Unit** | the schedule's currency, with the schedule version printed beside the figure |
| **Scope** | rows whose recorded model label matches a schedule entry; the label-to-entry match is itself a mapping with a coverage |
| **Nulls** | no rate, no matching label, or unvalidated semantics → the component renders `Unavailable`, never `0`; a fully unpriced selection renders `Unavailable — no rate for the models in scope` |
| **Coverage** | priced coverage = priced calls ÷ calls in scope, shown in the same element; nil until a schedule is committed |

*Data limits.* Rates are fetched by a repository script from OpenRouter's models endpoint
(`GET https://openrouter.ai/api/v1/models`, already the documented endpoint in
`docs/llm/configuration.md`) — prompt, completion and cache-read where published — and
committed as a versioned, user-owned file with provenance (fetch date, endpoint,
response hash). The application never searches the web or calls the endpoint at render
time. **Codex prefix tokens stay unpriced**: they are 95.99% of Codex input **[verified]**
and their billing meaning is not validated, so a Codex input cost would be mostly an
assumption. Reasoning tokens are never added to output and never priced separately —
`reasoning ≤ output` on every row is necessary for a subset hypothesis, not sufficient
**[C]**. Cache read is not "money saved": it is a share of recorded input accounting **[C]**.

*Display.* A headline tile on `#/overview` beside the four counts, carrying the schedule
version and the priced-coverage fraction in the tile; the `i` popover lists the excluded
components and their token volumes. `#/definitions` carries the schedule provenance.

*Built by* #10 (price schedule as a domain object, cost metric, coverage) plus the fetch
script; #11 (tile).

### 1.6 "How much calendar time does this data span?" — observed span headline tile

| | |
| --- | --- |
| **Metric** | `max(accepted child timestamp) − min(accepted child timestamp)` over the scope |
| **Formula** | aggregate = the span of the whole imported selection; per session = the reducer's `observed_end_at − observed_start_at` |
| **Unit** | hours or days with the exact seconds one step away |
| **Scope** | accepted observations only; a filtered view states whether the span is the full imported session or only matching observations **[C]** |
| **Nulls** | a session with one timestamp has no span and renders `Unavailable`, not `0` |
| **Coverage** | computable for 80 / 80 sessions **[C]** |

*Data limits.* The fixed label is **"observed span in imported data"** and the caveat
"may include idle time and resumptions" is part of the tile, not a tooltip. It is never
called duration and there is no average-duration statistic anywhere. The gap between spans
and tool-interval coverage measures neither idle nor active work **[review]**.

| Quantity | Value | Source |
| --- | ---: | --- |
| Total observed span across sessions | 456.2 h | **[O, verified]** |
| Maximum session span | 1,309,340.848 s ≈ 363.7 h ≈ 15.15 d | **[C, verified]** |
| Median observed span, Claude / Codex | 273.7145 s / 403.9975 s | **[C]** |
| Summed per-session union of tool intervals | 18.872055 h (Claude 12.973647, Codex 5.898409) | **[review]** |
| Cross-session pooled union of tool intervals | 18.858869 h | **[review]** |
| Sum of known wall latencies | 21.092045 h (Claude 53,918,497 ms, Codex 22,012,865 ms) | **[review]** |
| Within-session union ÷ span | Claude 47.7542%, Codex 1.37475% | **[review]** |

O's "21.1 h union" was a sum of wall latencies, not a union **[verified]**; the three
grains above are different quantities and must never be compared without naming the grain
**[review]**. None of them establishes active work: the honest name is "observed
tool-interval coverage".

*Display.* A headline tile on `#/overview` with its caveat line, and the Interval panel on
`#/sessions/:id` (observed start, end, span, plus declared start/end or `Unavailable` with
the reason), which is where the Console design already places the sentence "span of
accepted observations, not active time".

*Built by* #10 (metric and the filtered-span rule) and #11 (tile); the per-session panel is
the session page.

### 1.7 "How much reasoning is recorded, and by which models?" — reasoning by compatible group

| | |
| --- | --- |
| **Metric** | `Σ reasoning_output_tokens` and its per-call distribution, by compatible model group |
| **Formula** | sum and nearest-rank quantiles within a group sharing a validated accounting semantics; groups are never merged |
| **Unit** | tokens; distribution in tokens per call |
| **Scope** | calls with a known reasoning value inside one compatible group |
| **Nulls** | Claude renders `Reasoning tokens: Unavailable — not reported in this accounting` **[C]**; hidden or unreported reasoning is not zero |
| **Coverage** | Codex 3,187 / 3,187; Claude 0 / 1,583 **[C]** |

*Data limits.* No Claude-versus-Codex reasoning leaderboard, and no generational trend:
O's per-model decline (`gpt-5.2-codex` 63.1% → `gpt-5.5` 34.4%) comes from a
provider-stratified, non-task-matched sample with unvalidated inclusion semantics and is
not published (§4 Q9). The reasoning-to-output ratio — 711,948 ÷ 1,542,659 = 46.15%
**[C, verified]**, printed as 46.2% by O — appears only as an accounting diagnostic on
`#/definitions`, never as a finding. Token volume does not measure rigour or correctness
**[C]**.

*Display.* A usage column in the model-call table on `#/sessions/:id`, and a compatible-group
summary reachable from the input-tokens `i` popover. The ratio diagnostic lives on
`#/definitions` only.

*Built by* #10 (group compatibility, totals, distributions) and #11 (definitions row);
session column on the session page.

### 1.8 "Is Claude reading its cache?" — the Claude cache accounting panel

| | |
| --- | --- |
| **Metric** | Token-weighted `Σ cache_read ÷ Σ input_tokens_total`, shown with cache creation and uncached input |
| **Formula** | the three components and the reported input total, reconciled and shown as a residual when they disagree — never clamped |
| **Unit** | tokens and percentage of recorded input accounting |
| **Scope** | the numerator and denominator come from the same paired, reconciled population **[review]** |
| **Nulls** | a Codex selection renders `Cache read share: Unavailable — this mapping does not provide Codex cache accounting` **[C]**; a zero-input denominator renders `Not defined` |
| **Coverage** | Claude 1,583 / 1,583; Codex 0 / 3,187 **[C]** |

| Claude input component | Tokens | Coverage | Source |
| --- | ---: | --- | --- |
| Reported input total | 186,454,781 | 1,583 / 1,583 calls | **[C]** |
| Cache read | 178,275,625 | 1,583 / 1,583 calls | **[C]** |
| Cache creation | 8,114,953 | 1,583 / 1,583 calls | **[C]** |
| Uncached input | 64,203 | 1,583 / 1,583 calls | **[C]** |
| Token-weighted cache-read share | 95.61% | — | **[O, C, verified]** |

*Data limits.* The wording is "95.61% of recorded Claude input tokens were cache reads"
**[C]** — not a hit rate, not money saved. This is the only caching view in v0.1.0: prefix
tokens stay raw evidence and no cross-provider reuse metric exists (§4 Q2), so the
resemblance between Codex `prefix ÷ input` (95.99% **[verified]**) and Claude cache read
authorises nothing.

*Display.* A conditional panel on `#/overview` — a read/create/uncached stacked bar —
rendered only when the scope is compatible, and a labelled `Unavailable` panel when it is
not. Never silently omitted.

*Built by* #10 (reconciliation and the conditional) and #11 (panel).

### 1.9 "Which tools fail, and how often?" — error rate on a known denominator

| | |
| --- | --- |
| **Metric** | `marked errors ÷ tool observations with a known Boolean status` |
| **Formula** | `count(is_error is true) ÷ count(is_error is not null)`, rendered with both counts |
| **Unit** | percentage of known statuses |
| **Scope** | tool-call observations in scope, per harness and per exact tool name |
| **Nulls** | unknown status is its own population; an all-null group renders `Error rate: Unavailable — 0 / 30 statuses known` **[C]** |
| **Coverage** | 4,834 / 5,723 known, 889 unknown; unknowns are provider-shaped (Codex 885 of 889) **[verified]** |

| Tool population | Explicit errors | Known / all | Rate among known | Source |
| --- | ---: | ---: | ---: | --- |
| Claude | 79 | 1,793 / 1,797 | 4.41% | **[C]** |
| Codex | 217 | 3,041 / 3,926 | 7.14% | **[C]** |
| Whole sample | 296 | 4,834 / 5,723 | 6.12% | **[C, verified]** |
| `write_stdin` | 38 | 342 / 826 | not stated | **[O, C, verified]** |
| `update_plan` | — | 0 / 30 | Unavailable | **[C]** |

*Data limits.* Never divide by 5,723. The display string is "6.12% of known statuses ·
4,834 / 5,723 known, 889 unknown" **[C]**. `exit_code` and `status` are absent entirely
**[O]**, so "error" means only the source's Boolean claim. There is no retry rate in
v0.1.0 (§4 Q8): tool input was removed from the TraceLab release, so a repeated tool name
is "repeated tool observation; command identity unavailable" **[C]** and the 196 / 288 =
68.06% adjacency figure **[review]** is not published.

*Display.* The lead figure of the tool table (1.10) with its denominator in the same
element, and three distinct actions — **View errors** / **View known statuses** / **View
unknown statuses** — because they are three different populations **[C]**. The unknown
count also feeds the quality strip.

*Built by* #10 (denominator rule and the all-null state) and #11 (panel and actions).

### 1.10 "Which tool is slow, and where is the agent waiting?" — the tool diagnostic table

| | |
| --- | --- |
| **Metric** | Per exact tool name × harness: calls, marked errors, known Boolean statuses, error rate on known, median and p90 wall latency, known-*n*; optional `Σ wall latency` series |
| **Formula** | quantiles nearest-rank (`sorted[ceil(p·n)−1]`), even-*n* medians averaged, display precision declared (§4 Q6) |
| **Unit** | milliseconds (integer), counts |
| **Scope** | tool observations in scope, partitioned by source and harness; tool names are never merged into families |
| **Nulls** | latency unknown on 5 of 5,723 is excluded from quantiles and shown as known-*n*; **observed zeros are kept and flagged**, never dropped (§4 Q10) |
| **Coverage** | wall latency 5,718 / 5,723 **[O, C, verified]** |

| Harness | Tool | Known wall / all | Median ms | p90 ms | Source |
| --- | --- | ---: | ---: | ---: | --- |
| Claude | Read | 475 / 475 | 26 | 288 | **[C]** |
| Claude | Edit | 226 / 226 | 92.5 | 1,059 | **[C]** |
| Claude | Bash | 780 / 781 | 203.5 | 70,148 | **[C]** |
| Claude | WebFetch | 23 / 23 | 5,609 | 188,925 | **[C]** |
| Claude | Agent | 15 / 16 | 202,336 | 3,648,160 | **[C]** |
| Codex | apply_patch | 343 / 343 | 57 | 1,983 | **[C]** |
| Codex | exec_command | 2,080 / 2,080 | 313 | 1,202 | **[C]** |
| Codex | shell_command | 524 / 525 | 751 | 2,489 | **[C]** |
| Codex | write_stdin | 826 / 826 | 5,006 | 60,018 | **[C]** |
| Codex | shell | 122 / 122 | 0 | 1 | **[C]** |

*Data limits.* O's 281 ms `Read` p90 and 204 ms `Bash` median come from an undeclared
percentile rule; under the adopted rule they are 288 ms and 203.5 ms **[verified,
review]**. The `shell` zeros are real reported values and stay in the aggregate with an
instrumentation flag on the row; excluding them would mean dropping records on an
assumption (§4 Q10). A summed-latency series is labelled "summed recorded tool wall
latency" — a sum of intervals that can overlap, not elapsed time **[review]**:
`write_stdin` is 15,899,278 of 22,012,865 ms of summed known Codex tool wall latency =
72.23% **[C]**, while O's 20.9% is the same tool against a different denominator
**[verified]** — neither figure may be printed without its denominator. `Agent` wall
latency contains a nested session's work and does not prove a linked child session
**[C, review]**; it is never averaged with `Read`. Wall minus internal is not overhead:
43 of 3,407 paired Codex tools have internal exceeding wall **[C]**.

*Display.* A table under the tool-counts chart on `#/overview` (chart 3), each row linking
to the tool's occurrences and from there to `$.tools[i]` in the Source record drawer. The
calls ↔ summed-time toggle sits behind the table as optional scope **[review]**, on the
existing chart.

*Built by* #10 (quantile rule, per-tool metrics, known-*n*) and #11 (table, toggle, drill).

### 1.11 "How big are sessions, and is the median lying to me?" — rounds per session

| | |
| --- | --- |
| **Metric** | Distribution of recorded model-call observations per session: median, p90, max, plus five fixed bins |
| **Formula** | count by occurrence, never `max(round_index) + 1`; quantiles nearest-rank; bins **0** / 1–5 / 6–20 / 21–50 / 51–100 / 101+ |
| **Unit** | model-call observations per session |
| **Scope** | every session in scope, including sessions with no model call; the population is stated (the fixture has 8 single-round sessions, all with zero tool calls **[O]**) |
| **Nulls** | none — a session's count is always a known integer, and `0` is a real value, not a missing one |
| **Coverage** | 80 / 80 sessions **[C]** |

| Measure | Claude | Codex | Whole sample | Source |
| --- | ---: | ---: | ---: | --- |
| Sessions | 40 | 40 | 80 | **[C, verified]** |
| Median rounds per session | 12 | 26 | 19 | **[C, verified]** |
| Mean rounds per session | 39.575 | 79.675 | 59.625 | **[C]** |
| p90 rounds per session (nearest-rank) | 112 | 155 | 139 | **[C, review]** |
| p25 rounds per session (nearest-rank) | — | — | 4 | **[verified]** |
| Maximum rounds per session | 243 | 717 | 717 | **[C]** |

| Recorded rounds | Claude sessions | Codex sessions | All sessions | Source |
| --- | ---: | ---: | ---: | --- |
| 0 | 0 | 0 | 0 | reconciliation: C's five bins account for all 80 sessions |
| 1–5 | 17 | 6 | 23 | **[C, review]** |
| 6–20 | 7 | 11 | 18 | **[C, review]** |
| 21–50 | 4 | 9 | 13 | **[C, review]** |
| 51–100 | 6 | 6 | 12 | **[C, review]** |
| 101+ | 6 | 8 | 14 | **[C, review]** |

*Data limits.* A zero bin is required, not optional: the session reducer creates a session
from a session-row emission alone, so a session with no model call is a normal outcome, not
a defect (`backend/src/agentscope_app/domain/reducer.py` counts children onto an aggregate
that starts at `model_call_count = 0`; a children-only session is the *other* case and is
flagged `implicit_session`). A source mapped to sessions and tool calls without a model-call
rule — the shape the fake assistant already drafts for an unknown file
(`backend/tests/infrastructure/test_fake_assistant.py::test_unknown_shape_gets_a_session_only_draft_and_questions`)
— puts its whole population in that bin. The bins must therefore sum to the sessions KPI of
§1.1 exactly, and every session must be reachable by clicking a bin; if the histogram ever
drops a population instead of binning it, it says which and how many, in the same element.
This fixture puts nothing in the zero bin (TraceLab derives every session from its rounds),
which is why neither draft measured one. Mean 59.625 against median 19 is the whole point:
a mean is never printed without the median and the bins beside it. Quantiles are computed
over the same population the bins cover, zero-count sessions included. p90 publishes as
139, not 139.6 (§4 Q6). The
Claude/Codex difference is a difference between imported cohorts, not a performance
comparison — "different imported cohorts; tasks and accounting are not matched" **[C]**.

*Display.* A compact histogram with the median annotated, on `#/sessions` (or as the
expansion of the sessions KPI); clicking a bin appends a chip and filters the session
list. The declared quantile rule appears on `#/definitions` and in the `i` popover.

*Built by* #10 (quantile rule, bins, occurrence counting) and #11 (histogram, drill).

### 1.12 "What actually happened in this session?" — header plus ordered call and tool tables

| | |
| --- | --- |
| **Metric** | Session header (harness, model chip(s), user, project or "Unknown project", observed span, rounds, tools, marked errors, coverage) and two ordered observation tables |
| **Formula** | rows ordered by `(round_index, tool index)`; equal-time ordering uncertainty is made visible **[review]** |
| **Unit** | per-row: timestamps, tokens, milliseconds, Boolean status |
| **Scope** | one session, the full imported session (the scope bar is kept for the return path but not applied) |
| **Nulls** | `Unavailable` per cell with its reason; unknown tool statuses stay unknown and are not rendered as "no" **[review]** |
| **Coverage** | field-specific, printed per column, not a blanket "complete" |

*Data limits.* 212 of 4,770 rows have a timestamp inversion inside `timing_events` — 6
Claude, 206 Codex **[C, verified]** — so bounds come from min/max and a sorted display copy
says that it sorted **[C]**. Dangling tools exist: 5,723 `tool_call` events against 5,705
`tool_result`, and 5 tools with a null `result_at` **[O]**. 79 of 80 sessions are
single-model; exactly one is multi-model **[O, C, verified]**, and a session with more than
one label shows a warning chip. `project` is present on 1,583 / 4,770 rows and on no Codex
row **[O, verified]**; the missing case renders "Unknown project" with the reason that the
Codex mapping supplies no project field, not a bare dash **[review]**. There is **no
timeline in v0.1.0** (§4 Q7): the ordered table plus the span label carry the caveat.
Tables virtualise — the largest session has 717 rounds **[C]**.

*Display.* `#/sessions/:id` exactly as the Console design specifies: three panels
(Identity, Interval, Tokens), a diagnostics notice only when there is one, the model-call
table, the tool-call table with an `unlinked` pill where a tool has no parent call, and the
**Source record** `<dialog>` on every row showing file, SHA-256, locator, mapping revision
and `payload_text` verbatim.

*Built by* the session page (shell from #30), reading #10's per-session metrics.

### 1.13 Deliberately not in v0.1.0

Prefix-reuse metric (§4 Q2), session timeline (Q7), repeat-after-error / retry rate (Q8),
the reasoning trend (Q9), any success or outcome metric, anomaly scoring, cross-source
merged series, a pooled "total tokens" headline, and average session duration.

---

## 2. The later list, and why each one waits

**Caching and context.** Cache warm-up curve by round bucket (O B2 — Claude rounds 0–9 read
83.75%, rounds 20–29 read 97.84%); cache-collapse markers (O B3 — 36 of 1,543 Claude
transitions drop cache read by more than half); per-session cache/context trajectories
(C B3); fleet context-growth curve (O B4). *Waits because* the conditional Claude panel is
the agreed caching surface for v0.1.0 and these need a second panel each; the warm-up
buckets also carry an interpretation (that early rounds carry the creation cost) that the
measurements do not establish **[review]**.

**Source-specific prefix share.** A separately defined, extracted and tested "prefix share
of input", shown within one source and never called cache or reuse. *Waits because* the
owner chose raw evidence now, metric later (§4 Q2): a raw extension needs extraction and
tests before it can feed a dashboard.

**Time and latency.** Timeout-signature histograms (O C3 — `write_stdin` 112 of 826 calls
at 29–31 s, 10 at ≥119 s; `Bash` 9 calls ≥600 s); the wall-versus-internal paired scatter
and its 43 inversions (C C3); a zoomable swimlane timeline with interval-overlap
description and no fabricated critical path (C later stage 3); observed call-event span as
a think-time proxy (O C4 — round span p50 5.7 s, time to first tool p50 4.9 s Claude /
5.3 s Codex), renamed from "think time" **[review]**. *Waits because* Q7 defers the
timeline and the rest are drill-downs behind a v0.1.0 table.

**Tools and sequences.** Tool-vocabulary drift banner and monthly share area (O H2 —
`shell` → `shell_command` → `exec_command`; Claude's TaskCreate/TodoWrite/Skill appear only
from 2026-05); result-size distributions and ranked large results (O D4, C D4); the
repeat-after-error adjacency table with a declared window and eligible denominator
(O D3, C D3); a tool-family dictionary that retains native names (C D1). *Waits because*
Q8 defers adjacency until identity or linkage exists, and the drift banner needs a
multi-month import to be worth a chart — though it is the finding most likely to
invalidate a long-range tool chart, so it is first among these.

**Sessions and workload.** Concentration table with cumulative share on request (O A2 —
top 5 sessions hold 52.7% of input tokens; the honest phrasing is recorded workload, not
measured cost **[review]**); single-round-session filter (O E2); manual-review sorts with
explicit inclusion reasons and no anomaly score (C E4); session end-reason chip from
proxies (O E4); return-to-user rate (C E2 — 542 user-message entries are context
snapshots, not independent turns); users and projects table (O E5 — 20 users, 23 Claude
projects, no project shared between users, on 33.2% coverage). *Waits because* each is a
table behind an existing number rather than a new question, and the dashboard budget is
four KPIs, three charts and one strip.

**Models and comparison.** Model drift stacked area by month (O H3); a cohort comparison
report with *n*, coverage and separate incompatible panels (O H1, C H1); saved cohort
reports carrying filter, metric and mapping versions (C later stage 5); before/after and
matched-task evaluation kept explicitly apart from observational analytics (C H3).
*Waits because* comparison needs the curated allow-list and a second validated source;
descriptive within-group summaries are permitted, causal or performance rankings are not
**[review]**.

**Composition from character counters.** First-input composition (O §0, B5 — 90.2% of
rounds begin with a `tool_result`; new input is 96.9% tool results for Claude, 84.1% for
Codex). *Waits because* these counters are per-call snapshots that may repeat content
across rounds; aggregating them as distinct text is prohibited until a snapshot statistic
is explicitly defined **[review]**. It stays prose in this document, not a tile.

**Cost and outcomes.** Cache-read-rate handling, tiering and TTL hazards in the schedule
(C A4); user-attached outcome labels with label source and evaluation version
(O E3 note, C E3). *Waits because* v0.1.0 prices only the components with published rates
and validated semantics (§4 Q1), and outcome labels are new data, not new analysis.

**Quality and infrastructure.** Import record-outcome report with accepted / partial /
rejected / ignored / duplicate on separate denominators (C G4); duplicate-source overlap
across stores (O G6 — the `.claude.back` store, 30 / 10 / 40 sessions, intersection 0);
an adversarial fixture with duplicate claimed ids and inverted timestamps (O G3, C
priorities); the implausible-measure flag table (O G5 — 11 sessions with output ÷ input
below 0.0005; a 1-round session with 168,891 input and 3 output tokens; 83 rounds under 10
output tokens, flagged never rejected); reasoning inclusion-semantics validation (C F2);
profiling a bounded SWE-chat or Trace Commons excerpt (C later stage 1, O L9).
*Waits because* they are ingestion and fixture work rather than dashboard work — but the
record-outcome report and the adversarial fixture are prerequisites for trusting §1.1's
counts, so they are the first items to pull forward if time allows.

**Deferred, not rejected.** Automated findings and anomaly suggestions are a validated
later stage (C later stage 8), and natural-language data questions are outside v0.1.0
**[review]** — neither is a permanent joint rejection. What both drafts do reject on the
evidence: forecasting, composite "efficiency scores", reasoning-versus-quality correlation
(O F2, C F3), and per-file or per-repo analytics from TraceLab, whose tool input was
removed.

---

## 3. The limits of the data

### 3.1 TraceLab (the only measured source)

1. **No task success.** No verified outcome label in any source. UI: "Task outcome:
   Unavailable — no verified outcome label." A stated absence, not a blank chart.
   (O L1/E3; C E3.)
2. **Observed span is not active time.** The span, the summed per-session tool-interval
   union and the sum of wall latencies are three different grains (§1.6) and none of them
   measures active work **[review]**. No average-duration statistic.
3. **Unknown is never zero.** Cache `Unavailable` for Codex, reasoning `Unavailable` for
   Claude, error rate `Unavailable` for an all-null group. Claude reasoning is absent from
   the accounting, not absent from the work. (O L6/F1; C §2, §3, §6.)
4. **Every rate carries its known denominator in the same element**, never a tooltip.
   (O 6.6.1; C metric contract.)
5. **Event arrays are not chronological** — 212 of 4,770 rows, 6 Claude and 206 Codex
   **[C, verified]** (4.4% of rounds overall, 6.5% of Codex rounds **[O]**). Bounds come
   from min/max; a sorted display copy says so.
6. **Native ids are not trustworthy in general and this fixture cannot settle it.**
   Upstream documents about 8,900 duplicate `round_id` **[O]** (and 514 duplicate
   `trace_key`, per ADR/plan D4); this sample has no collisions **[C]**. Counts are "recorded
   model-call observations"; exact-file idempotency is the v0.1.0 guarantee and
   cross-export overlap may remain.
7. **The fixture is a stratified 40 + 40 draw with seed 42**, source order retained, no
   native-ID deduplication, SHA-256
   `d044a766e12c7eceae2eb1ed71e42d95cf0aec2f10c8d61a06cecc0381fb9897` **[C]**. It is not a
   population estimate; long sessions carry more weight in call- and token-weighted
   summaries **[C]**.
8. **Characters are not tokens.** `newly_append_tokens` exceeds `current_input_chars` on
   57.4% of Claude rounds **[O]**, so the two counters cover different scopes. Never
   convert; character fields appear only as composition shares.
9. **Tool input was removed from the public release.** No commands, file paths or prompts:
   no command replay, no per-file analytics, no semantic task categories, no retry
   identity. (O L10; C limits.)
10. **Coverage is provider-shaped.** Cache fields Claude-only, reasoning Codex-only,
    `project` Claude-only, internal latency effectively Codex-only, `is_error` unknown on
    22.5% of Codex tools, `exit_code` and `status` absent entirely **[O]**.
11. **Fan-out inflates tokens.** Never sum model-call tokens across a join to tools; one
    call with three tools would triple its tokens (C metric contract). Reference test:
    multi-tool joins count call tokens once.
12. **Filters need declared semantics.** A model filter selects matching calls, includes
    their linked tools, and counts distinct sessions containing those calls; unlinked tools
    are identified separately and never assigned a model **[C]**. Undated records are
    reported under a date filter, not dropped **[C]**. A filtered span states which
    population it spans **[C]**.
13. **Exact numbers travel as text.** `payload_text` is rendered verbatim; the client never
    re-serialises `payload` **[C]**.
14. **People are not ranked.** Pseudonymous users and project labels support descriptive
    filters, not performance rankings or cross-source identity joins **[C]**.
15. **Model strings are recorded claims**, preserved as-is, never normalised to catalogue
    entries (O H3, C H2).

### 3.2 SWE-chat (documented, never inspected)

| Fact | Value | Source |
| --- | --- | --- |
| Session rows | 5,851 | **[C, documented]** |
| Conversation rows | 2,692,480 | **[C, documented]** |
| `sessions.parquet` size | 1,997,377 B | **[O]** |
| `conversations.parquet` size | 1,311,422,253 B (1.31 GB) | **[O]** |

Neither draft opened the Parquet: `pyarrow` was absent from the backend uv environment and
from system Python 3.9, and neither agent installed anything **[O]**; C worked from the
locally documented Parquet footer schemas, which `docs/datasets/README.md` records
**[C]**. Consequences: granularity is
unvalidated ("a conversation entry" is not established as one model call), turn-to-invocation
and token reconciliation are unvalidated **[C]**, there are no latency fields **[O]**, and
its session-level `duration_seconds` is a *declared* quantity — comparing it to a TraceLab
observed span is a category error **[O]**. The file is far beyond the product's 25 MiB /
100k-record limits, so it needs a bounded, reviewed excerpt before it can be imported
**[O]**. SWE-chat does carry `command`, `file_path` and `content` [documented], which makes
content analyses source-specific and gated on the source, never offered globally **[O]**.
Until a bounded excerpt is profiled, SWE-chat renders as **Unprofiled** — a distinct state
from 0% coverage **[C]** — and no SWE-chat value may share an axis with a TraceLab one.

### 3.3 Trace Commons

Uninspected by design, but the holdout and the fallback are two different artifacts and
only one of them is reserved (`docs/datasets/README.md`):

| Role | Path | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| **Reserved native file** (the day-4 unseen-structure holdout) | `data/reserved/sessions/claude_code/07b57159-218e-4330-a64e-0ec4b4355056.jsonl` | 1,556,737 | `f0f3711c…fa70` |
| Decoded Parquet fallback (second source) | `data/raw/trace-commons/train-00000-of-00001.parquet` | 70,202,603 | `7c2c6ee4…11e7` |

The reserved file is a **native JSONL session**, downloaded and hashed only: its contents
and structure must not be previewed, scanned, parsed or used in development or tests before
the day-4 exercise. The decoded Parquet shard is downloaded fallback material, its payload
also uninspected so the holdout is not exposed indirectly; the dataset card describes it as
one row per session, but no field, unit or coverage is verified **[C]**. At 70.2 MB it
exceeds the 25 MiB per-upload limit, so second-source integration makes a **bounded local
Parquet excerpt that excludes the reserved session** before importing through the UI — that
sampling path is permitted and is the fallback if SWE-chat stays blocked. Until such an
excerpt is profiled, Trace Commons renders as **Unprofiled** and supports candidate views
only.

### 3.4 How the UI says all of this

The wording is fixed, so the same limit is phrased the same way everywhere. From C's limits
table, adopted verbatim: "Task outcome: Unavailable — no verified outcome label." ·
"95.61% of recorded Claude input tokens were cache reads." · "Cache read share: Unavailable
— this mapping does not provide Codex cache accounting." · "Reasoning tokens: Unavailable
— not reported in this accounting." · "6.12% of known statuses; 4,834 / 5,723 known, 889
unknown." · "Error rate: Unavailable — 0 / 30 statuses known." · "Observed span in imported
data: 15.15 days. May include idle time and resumptions." · "Observed call event span; not
an API latency measurement." · "Wall/internal difference; timing scopes may differ." ·
"Recorded model-call observations." · "Exact-file duplicates handled; cross-export overlap
may remain." · "Different imported cohorts; tasks and accounting are not matched." ·
"Repeated tool observation; command identity unavailable." · "Unprofiled — error-status
availability has not been validated." · "No dated observations in this range; N undated
observations cannot be placed."

Two additions from the decisions: the span tile's fixed label is **"observed span in
imported data"** with its caveat in the tile (§4 Q4), and a cost figure always names its
price-schedule version and priced coverage (§4 Q1).

---

## 4. The decisions this document applies

The owner answered the ten questions of `MERGE-DRAFT.md` §8 on 2026-09-08. Every entry
above is consistent with them; #10 folds them into the metric layer before its PR.

| Q | Question | Decision | Where it lands here |
| --- | --- | --- | --- |
| 1 | Prices | **(b)** a versioned, user-owned price schedule, rates fetched by a script from OpenRouter's models endpoint (prompt, completion, cache read where published), committed with provenance; no web search in the app; Codex prefix tokens stay unpriced | §1.5 |
| 2 | Prefix reuse | **(b)** raw evidence now, metric later | §1.8, §2 (source-specific prefix share) |
| 3 | KPI slots | **(a)** navigation counts aligned to the API: sessions, model-call observations, tool-call observations, input usage by accounting group | §1.1 |
| 4 | Observed span | **(b)** a headline tile with the fixed label "observed span in imported data" and its caveat | §1.6 |
| 5 | Token semantics on one axis | **(a)** refuse incompatible sums with a visible reason and a split control; `unknown` is never compatible | §1.4, §0 |
| 6 | Quantiles | **(a)** nearest-rank, even-*n* medians averaged, display precision declared | §1.10, §1.11 |
| 7 | Session timeline | **(a)** ordered call and tool table now, timeline later | §1.12, §2 |
| 8 | Repeat-after-error | **(a)** defer beyond v0.1.0 | §1.9, §2 |
| 9 | Reasoning tokens | **(a)** totals and distributions by compatible model group with scope and coverage; ratio only as a definitions-page diagnostic | §1.7 |
| 10 | Zero latencies | **(a)** include every recorded value and flag the instrumentation question in the tool table | §1.10 |

**One layout consequence for #11 to confirm with the owner.** Q3 fills the four Console KPI
slots with counts, and Q1 and Q4 each add a headline figure (estimated cost, observed
span). The overview therefore carries four KPI cards plus two subordinate headline tiles,
against the Console's stated four-KPI budget. The rest of the budget is unchanged — three
charts, one quality strip, eight session rows — and both added tiles obey ADR-006 rule 2:
coverage and caveat inside the tile, `Unavailable` as a rendered state. ADR-006 rule 5
(complements confirmed with the owner when the issue starts) covers this; it is the only
open point in the document.
