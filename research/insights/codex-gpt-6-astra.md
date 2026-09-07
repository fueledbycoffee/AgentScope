# What AgentScope can learn from agent traces

AgentScope should help someone locate expensive, slow, error-prone, or poorly
observed parts of an agent workflow, then inspect the evidence behind them.
Its first product promise should be: **understand recorded work and choose what
to investigate next**. The available traces do not establish which agent solves
tasks best, whether a session succeeded, or whether a particular action was wasteful.

The highest-value additions to the planned dashboard are a tool diagnostic table,
a compact distribution of rounds per session, and a Claude-only cache breakdown.
Coverage, accounting semantics, and source-record drill-down are prerequisites
for these features, not secondary documentation.

This is a research proposal, not a claim that these views are implemented.
All fixture statistics below were **computed from the 80-session sample** on
2026-09-07 using Python's standard library and the committed gzip JSONL file.
No other dataset payload, including the reserved native holdout, was inspected.

## Evidence and source boundaries

The answer uses these local contracts:

- [Research question](00-question.md): required themes and metric trust rules.
- [Dataset provenance](../../docs/datasets/README.md): selection, field availability,
  source granularity, redistribution decisions, and the unseen-file boundary.
- [Target schema](../../backend/src/agentscope_app/domain/schema.py): canonical
  sessions, model-call observations, tool-call observations, nullable measures.
- [TraceLab mapping](../../backend/mappings/tracelab-v1.json): actual field paths,
  token semantics, timestamp bounds, and explicitly unmapped source detail.
- [Consolidated plan](../../docs/planning/2026-09-07-consolidated-plan.md): domain
  metric definitions, query-adapter SQL, reference tests, scope and release gates.
- [Null and unit rules](../../docs/adr/ADR-003-nulls-and-units.md): missingness,
  coverage, separate latency measurements, and incompatible accounting groups.
- [Current API contract](../../docs/api/v0.1.md): existing summary shape and exact
  raw-record retrieval; its example token values are illustrative, not fixture totals.

| Source | Evidence available for this answer | What may be claimed now |
| --- | --- | --- |
| TraceLab v0.0.1 | All 4,770 fixture rows and 5,723 nested tools inspected programmatically; mapping read | Verified availability and computed statistics for 80 selected sessions |
| SWE-chat | Locally documented Parquet footer schemas; 5,851 session rows and 2,692,480 conversation rows | Candidate metrics with unmeasured coverage; turn-to-invocation and token reconciliation remain unvalidated |
| Trace Commons decoded Parquet | Dataset notes describe session rows with nested trace structure; payload unprofiled | Candidate session/turn/tool views only; actual fields, units, coverage, and mapping remain unknown |

The TraceLab fixture selects 40 sessions per provider with seed 42, retains every
selected occurrence in source order, and applies no native-ID deduplication.
The upstream session populations are unequal; equal sample strata are useful for
integration, but pooled fixture results are not population estimates.
Long sessions receive more weight in call-weighted and token-weighted summaries.
Source names, providers, harnesses, and model labels describe different dimensions.
The mapping turns provider `claude` into harness `claude-code`; this is a documented
source-specific transform, not a general rule that provider equals agent.

The compressed fixture SHA-256, verified during this analysis, is
`d044a766e12c7eceae2eb1ed71e42d95cf0aec2f10c8d61a06cecc0381fb9897`.
The [manifest](../../fixtures/tracelab/tracelab-sample.manifest.json) records original
release line ranges. Fixture line numbers below refer to the excerpt, not upstream.

## What the sample already tells us

### 1. Session size is strongly skewed

**Computed from the 80-session sample.** A round here means one recorded root
model-call observation, counted by occurrence, never `max(round_index) + 1`.
Percentiles use nearest rank, `sorted_values[ceil(p × n) - 1]`.
Medians average the two central values for even-sized populations.

| Measure | Claude | Codex | Whole sample |
| --- | ---: | ---: | ---: |
| Sessions | 40 | 40 | 80 |
| Recorded model-call observations | 1,583 | 3,187 | 4,770 |
| Recorded tool-call observations | 1,797 | 3,926 | 5,723 |
| Median rounds per session | 12 | 26 | 19 |
| Mean rounds per session | 39.575 | 79.675 | 59.625 |
| p90 rounds per session | 112 | 155 | 139 |
| Maximum rounds per session | 243 | 717 | 717 |

| Recorded rounds | Claude sessions | Codex sessions | All sessions |
| --- | ---: | ---: | ---: |
| 1–5 | 17 | 6 | 23 |
| 6–20 | 7 | 11 | 18 |
| 21–50 | 4 | 9 | 13 |
| 51–100 | 6 | 6 | 12 |
| 101+ | 6 | 8 | 14 |

The two largest Codex sessions contain 717 and 635 rows: together, 42.42% of
Codex observations and 28.34% of all fixture observations.
This makes a median plus distribution much more useful than an average alone.
It does not establish that Codex is less efficient: task scope, harness behavior,
model mix, dates, and session boundaries differ.
The immediate action is to inspect unusually large sessions for understandable
workflow patterns, not to label them failures.

### 2. Claude cache reads dominate recorded input accounting

**Computed from the 80-session sample**, restricted to its 1,583 Claude calls.

| Claude input component | Tokens | Coverage |
| --- | ---: | --- |
| Reported input total | 186,454,781 | 1,583 / 1,583 calls |
| Cache read | 178,275,625 | 1,583 / 1,583 calls |
| Cache creation | 8,114,953 | 1,583 / 1,583 calls |
| Uncached input | 64,203 | 1,583 / 1,583 calls |

Token-weighted cache read share is
`178,275,625 / 186,454,781 = 95.61%`.
All 1,583 Claude rows reconcile input total to read + creation + uncached input.
This is strong evidence about the recorded accounting split in this fixture.
It is neither a request cache-hit rate nor a percentage of dollars saved.
Repeated input tokens are counted each time a call reports them; these are not
186 million distinct tokens authored by users.

The 3,187 Codex rows report 366,993,096 input tokens, but all Claude-specific
cache fields are null: canonical cache coverage is **0 / 3,187**, not zero usage.
Codex `prefix_tokens / input_tokens_total` is 95.99% in aggregate; the mapping
deliberately leaves prefix tokens in raw evidence. That numerical resemblance
does not authorize a Codex cache-read metric or cross-provider cache ranking.
The input prefix + newly appended split reconciles on all 4,770 rows, but
arithmetic reconciliation alone does not establish a billing definition.

Useful next action: inspect high-input Claude sessions with relatively low cache
read share. They are candidates for understanding context reuse; the trace cannot
prove that a prompt change would have increased caching or reduced the invoice.

### 3. Error rate needs an explicit known-status denominator

**Computed from the 80-session sample.** Count an error only when `is_error is True`;
count known status only when it is a Boolean. Null remains unknown.

| Tool population | Explicit errors | Known status / all observations | Error rate among known |
| --- | ---: | ---: | ---: |
| Claude | 79 | 1,793 / 1,797 | 4.41% |
| Codex | 217 | 3,041 / 3,926 | 7.14% |
| Whole sample | 296 | 4,834 / 5,723 | 6.12% |

There are 889 unknown statuses overall; status coverage is 84.47%.
Dividing 296 by 5,723 would implicitly treat unknowns as successful if labelled
an error rate. Display `6.12% of known statuses · 4,834 / 5,723 known` instead.
The pooled value is descriptive of imported observations, not a fair agent comparison.

Coverage varies by tool: Codex `write_stdin` has 38 errors among 342 known statuses
out of 826 calls; `update_plan` has no known statuses across 30 observations.
`update_plan` should display **Unavailable**, never `0% errors`.
Polling calls, command executions, and plan updates are different operations;
their raw rates should remain separate.

### 4. Tool latency points to different investigation paths

**Computed from the 80-session sample.** These are recorded wall latencies in ms,
over known values, including observed zeros. They are not model response latency.

| Harness | Tool | Known wall / all | Median wall ms | p90 wall ms |
| --- | --- | ---: | ---: | ---: |
| Claude | Read | 475 / 475 | 26 | 288 |
| Claude | Edit | 226 / 226 | 92.5 | 1,059 |
| Claude | Bash | 780 / 781 | 203.5 | 70,148 |
| Claude | WebFetch | 23 / 23 | 5,609 | 188,925 |
| Claude | Agent | 15 / 16 | 202,336 | 3,648,160 |
| Codex | apply_patch | 343 / 343 | 57 | 1,983 |
| Codex | exec_command | 2,080 / 2,080 | 313 | 1,202 |
| Codex | shell_command | 524 / 525 | 751 | 2,489 |
| Codex | write_stdin | 826 / 826 | 5,006 | 60,018 |
| Codex | shell | 122 / 122 | 0 | 1 |

`Bash` has a short median and a much longer tail. A single mean would conceal
the distinction between routine commands and a few long waits.
`Agent` observations merit a delegation-oriented session inspection; the tool
name does not prove a reconstructed child-agent graph or autonomous active time.
The small `Agent` and `WebFetch` populations should always show their counts.

Codex `write_stdin` accounts for 15,899,278 of 22,012,865 ms of summed known
Codex tool wall latency: **72.23%**. This is a share of recorded tool-interval
sums, not 72.23% of session elapsed time. Intervals can overlap and polling can
represent waiting on work initiated earlier. Inspect execution/polling sequences
before proposing any scheduling optimization.

The near-zero `shell` values are real reported values in this sample. Preserve
them, but do not celebrate them as a speed advantage without validating source
instrumentation and timestamp precision.

### 5. Timing and coverage anomalies are product findings

**Computed from the 80-session sample:**

- 212 / 4,770 rows (4.44%) have a timestamp inversion in `timing_events` array
  order: 6 Claude rows and 206 Codex rows. Use timestamp min/max for bounds.
- Wall latency is known for 5,718 / 5,723 tools; internal latency is known for
  3,411 / 5,723. Their missingness patterns are very different.
- Claude internal latency coverage is only 4 / 1,797 tools; Codex is 3,407 / 3,926.
- In 43 / 3,407 Codex tools with both latencies, internal exceeds wall latency.
  A blanket `wall - internal = overhead` metric would produce negative values.
- All 80 sessions have computable observed timestamp bounds. Median observed
  span is 273.7145 seconds for Claude and 403.9975 seconds for Codex.
- The maximum Codex observed span is 1,309,340.848 seconds, about 15.15 days.
  The label must say “observed span in imported data,” not “active work time.”
- The sample has no collisions for `round_id`, `trace_key`,
  `(session_id, round_index)`, or tool-call IDs within provider. Upstream notes
  nevertheless document non-unique native identities; this sample cannot
  validate a global uniqueness assumption.

For a concrete latency drill-down, fixture line **2,979**, `$.tools[0]`, contains
an `Agent` wall latency of **9,653,425 ms**, the fixture maximum.
Its session is `claude:bdb582f4-92ca-39cc-8068-bc55e6d1aeec`, round index 135.
The same source row has another `Agent` observation at `$.tools[1]` with
3,648,160 ms. A tool-level click must preserve the nested index.

### 6. Reasoning is observable asymmetrically

**Computed from the 80-session sample:** Codex has 711,948 recorded reasoning
tokens across 3,187 / 3,187 calls; Claude has 0 / 1,583 known reasoning-token values.
Claude also has 452 `reasoning` timing events, so missing token accounting clearly
cannot be interpreted as “no reasoning occurred.”
Codex recorded output totals 1,542,659 tokens; the arithmetic ratio of reasoning
to output is 46.15%. No Codex row has reasoning tokens greater than output tokens.
Those checks are consistent with a subset interpretation, but do not prove it.
Keep that ratio an accounting diagnostic until inclusion semantics are validated;
do not add reasoning to output or call this a measure of reasoning quality.

## Metric contract shared by every view

Every catalogue entry below inherits these rules. A view is not ready merely
because its numerator can be computed.

| Contract item | Required behavior |
| --- | --- |
| Definition | Stable metric ID/version, user question, formula, grain, unit, and intended interpretation |
| Population | Explicit source/import, harness, model, date field/timezone, and token-semantics filters |
| Coverage | Known / total eligible observations under exactly those filters; rates retain numerator and denominator |
| Missingness | Unknown, invalid, unmapped, absent, explicit null, and excluded values explainable through diagnostics |
| Comparability | Partition incompatible semantics; a shared unit or an `unknown` tag does not establish equivalence |
| Provenance | Contributing observations link to session, raw file hash, locator, emission path, mapping revision |
| Reproducibility | Save filters, metric version, mapping versions, file hashes, quantile rule, and rounding with reports |

For totals, sum known values and show partial coverage; if known count is zero,
return null and display **Unavailable**. A measured zero stays zero.
For ratios, numerator and denominator must use the same eligible paired records.
For cache share, require known, reconciled accounting and a positive aggregate
input denominator. Known zero-input rows can contribute zero without creating
per-call division results; an all-zero denominator is “Not defined: zero input.”
For error rates, known Boolean status defines the denominator.
For quantiles, exclude missing/invalid values, retain legitimate zeros, and state n.

Do not sum model-call tokens after joining directly to tools or contribution rows:
one call with three tools would otherwise contribute its tokens three times.
Aggregate each entity grain separately or select distinct occurrence identities
before joining. Filter import membership through existence, not multiplied joins.
Exact-file re-import must not add observations. Different overlapping exports
can still overlap semantically; disclose the deferred reconciliation guarantee.
The consolidated plan's broad day-2 overlap wording must be read with its explicit
D4 identity decision: exact-file idempotency is the v0.1.0 guarantee.

Model filters need a defined relationship to tools and sessions. Recommended:
select matching model-call observations, include their linked tools, and count
distinct sessions containing those calls. Identify unlinked tools separately;
do not assign them a model by guessing. A model-filtered session detail can show
the full session with matching observations highlighted and scope clearly labelled.

For time filters, label the actual boundary used. Recorded call activity can use
the mapped minimum event timestamp in UTC, but it is an observed bound rather
than a guaranteed API-start instant. Unknown timestamps belong in an explicit
“Unknown date” population; under a date range, report how many undated records
cannot be placed in the range instead of quietly treating them as out of scope.
Session span in a filtered view must state whether it uses the full imported
session or only matching observations; use the latter for scoped metrics and
offer the full imported span in session detail.

## Catalogue: questions, evidence, displays, and drill-down

Support notation keeps the catalogue precise without repeating dataset history:

- **TL-C / TL-X**: TraceLab Claude / Codex; coverage numbers are this fixture only.
- **SW candidate**: SWE-chat fields are documented, but actual non-null coverage
  and record semantics have not been measured. Not available for comparison yet.
- **TC candidate**: Trace Commons payload/schema mapping is unprofiled here;
  session/turn/tool structure is described, but no per-metric field is verified.
- **Canonical**: available as a target field or fixed reducer output now;
  **raw extension**: preserved source evidence requiring additional metric work.
- **Future evidence**: requires new instrumentation, labels, or configuration.

Every drill-down starts from the current filter state and ends at the original
record, never at an aggregate with no explanation. Shorthand paths below are:

| Path | Meaning |
| --- | --- |
| M | Metric group → contributing sessions → model-call occurrence → raw file hash + locator + root field path + mapping revision |
| T | Tool group → contributing sessions → exact tool occurrence → parent call if present → raw locator + `$.tools[i]` or source-equivalent path |
| S | Session distribution/cohort → session → ordered observations → each contributing source record |
| Q | Quality count → affected imports/records → diagnostic, field path, mapping revision, and original payload |

Source-specific fields below are requirements, not promises that the canonical
schema already exposes them. Raw extensions should stay out of initial dashboard
calculations until their extraction and definitions are implemented and tested.

### A. Cost and tokens

**A1. “Where is the recorded token volume concentrated?”**

- Metric/view: sum known input and output separately by model, session, and semantics;
  optionally show each session's share of its compatible cohort total. Unit: tokens / %.
- Needs: canonical `input_tokens`, `output_tokens`, `token_semantics`, model,
  session identity, source, and harness. Do not add reasoning or cache to input/output.
- Sources/coverage: TL-C input/output 1,583 / 1,583; TL-X 3,187 / 3,187.
  SW candidate usage at session and entry grains; validate one authoritative grain.
  TC candidate only if usage fields are found; coverage unknown.
- Caveat: incompatible accounting tags stay separate; token volume is not dollar
  cost, unique information, task difficulty, or evidence of waste.
- Display/drill: existing tokens-by-model bars split by semantics, selectable
  input/output series; ranked sessions table for concentration. Path M.

**A2. “Is context getting larger as this session proceeds?”**

- Metric/view: per-call input tokens versus recorded sequence; first/last observed
  values and change where order is unambiguous. Unit: tokens per call.
- Needs: canonical sequence, input tokens, semantics, occurrence tie-breaker;
  raw `prefix_tokens` and `newly_append_tokens` for an optional source-specific split.
- Sources/coverage: TL sequence and split fields 4,770 / 4,770, partition by tag.
  SW candidate turn numbers and usage after invocation reconstruction; TC candidate
  ordered turns and usage, all coverage unmeasured.
- Caveat: a decline could reflect a context reset, summarization, task transition,
  model change, or measurement behavior. It does not prove successful compaction.
- Display/drill: session-only line/dot plot, with gaps for unknowns and no guessed
  connection across ambiguous order. Click a point via M; raw split on demand.

**A3. “Which sessions account for most of this workload?”**

- Metric/view: ranked sessions by known input/output totals or observation count;
  cumulative share and top-k contribution within one compatible group. Unit: tokens / calls / %.
- Needs: canonical session membership, call occurrence identity, usage and semantics;
  repo only as an optional additional dimension.
- Sources/coverage: TL all 80 sessions and 4,770 calls; token coverage as A1.
  SW candidate session aggregates or validated child aggregation; TC candidate
  session membership, optional usage. Both have unmeasured coverage.
- Caveat: long sessions dominate call-weighted totals; task scope and missing
  usage can alter rank. Project is absent on all TL-X rows, not an empty repo.
- Display/drill: sortable sessions table with share column; cumulative curve only
  on request. Path S, with the selected token component carried to M.

**A4. “What would these recorded calls cost under my price schedule?”**

- Metric/view: later configured estimate, sum of non-overlapping billable token
  buckets × effective rates; report priced calls / eligible calls. Unit: configured currency.
- Needs: validated billable semantics, exact model/version and effective date,
  price revision, currency, input/output/cache buckets, relevant cache TTL or tier.
- Sources/coverage: no source supplies verified price configuration here; current
  cost coverage is unavailable. TL-C offers useful bucket inputs; TL-X cache
  accounting is insufficient for a fully itemized cache estimate. SW/TC unvalidated.
- Caveat: discounts, billing rounding, cache-write multipliers, batch rates, and
  missing tiers can make an estimate differ from an invoice. Never invent defaults.
- Display/drill: later report, with assumptions and unpriced groups visible;
  no empty cost tile in v0.1.0. Path M plus the exact price rule and revision.

### B. Caching efficiency

**B1. “How much recorded input is served from cache?”**

- Metric/view: token-weighted cache read share, `sum(read) / sum(input)`, over
  paired, validated compatible rows. Unit: %. Show input-token denominator too.
- Needs: canonical cache read, input, semantics; source reconciliation rule.
- Sources/coverage: TL-C 1,583 / 1,583; TL-X 0 / 3,187 canonical read values.
  SW candidate cache and input columns with unvalidated semantics and coverage;
  TC candidate only if equivalent usage exists, currently unknown.
- Caveat: not request-hit rate or money saved. Do not average session percentages
  to obtain the pooled token share; label a session-weighted statistic separately.
- Display/drill: compact read/create/uncached bar within a selected compatible
  group, with read share annotation; group → contributing sessions → M.

**B2. “Where are cache creation and uncached input concentrated?”**

- Metric/view: creation and uncached token totals/shares by session or model;
  source uncached value or validated `input - read - creation`. Unit: tokens / %.
- Needs: canonical creation/read/input; raw `claude_uncached_input_tokens` for
  reconciliation, plus occurrence identity and compatible semantics.
- Sources/coverage: TL-C all three source components known on 1,583 / 1,583;
  TL-X 0 / 3,187. SW candidate cache fields but denominator relation unknown;
  TC availability/coverage unverified.
- Caveat: negative residuals are accounting anomalies, never clamped to zero.
  Cache creation can be useful investment; uncached input is not automatically waste.
- Display/drill: columns in the compatible sessions table; per-call stacked
  breakdown only in session detail. Path M, opening the reconciliation evidence.

**B3. “Does cache reuse change within a session?”**

- Metric/view: read share per positive-input call against recorded sequence;
  optionally first observed call versus later calls. Unit: %.
- Needs: B1 fields and stable order; model changes annotated. Raw extension for
  detailed context event correlation, which the current mapping does not normalize.
- Sources/coverage: TL-C components 1,583 / 1,583, with positive-input eligibility
  counted at query time; TL-X unavailable. SW/TC conditional on validated usage/order,
  with no measured coverage here.
- Caveat: first recorded call need not be a cold cache or true task start.
  Correlation with context changes does not identify the cache policy's cause.
- Display/drill: optional session-detail overlay, not another dashboard chart.
  Point → model observation → raw fields via M.

### C. Time and latency

**C1. “How widely are sessions spread in recorded time?”**

- Metric/view: max accepted child timestamp minus min accepted child timestamp;
  distribution of observed spans. Unit: ms internally, readable seconds/minutes/days.
- Needs: fixed session reducer bounds from model-call and tool timestamps;
  declared session start/end retained separately when a source supplies them.
- Sources/coverage: TL observed bounds 80 / 80; declared session intervals not
  supplied by its mapping. SW candidate `duration_seconds`/timestamps at a different
  grain; TC candidate timestamped turns. SW/TC coverage unmeasured.
- Caveat: includes idle gaps, user delay, resumptions, and missing events; declared
  duration and observed span must never be silently substituted for one another.
- Display/drill: sessions-table span column and optional distribution; session
  header states “Observed span in imported data.” Path S.

**C2. “Which tools have long waits or a long latency tail?”**

- Metric/view: median and p90 known nonnegative wall latency by exact tool name
  within source/harness; later p99 only with adequate sample context. Unit: ms.
- Needs: canonical tool name, wall latency, source/harness, error status for
  optional facets; timestamp pairs to inspect the measurement.
- Sources/coverage: TL wall 5,718 / 5,723; tool-specific coverage in the sample
  table above. SW has no verified tool wall-latency column in the documented subset;
  pairing might permit a later estimate. TC fields/coverage unknown.
- Caveat: tool names encode different operations and waiting behavior. Small n
  makes tails unstable; retain outliers and do not equate a tool interval to CPU time.
- Display/drill: tool table with median/p90/known n, sorted by user choice;
  expand to a distribution and individual slow calls. Path T.

**C3. “Do runner time and observed wall time tell the same story?”**

- Metric/view: paired wall/internal scatter and signed difference distribution;
  count internal > wall as a diagnostic. Unit: ms / observations.
- Needs: canonical wall and internal latency for the same tool occurrence;
  source units and meanings, with paired coverage.
- Sources/coverage: TL-C pairs 4 / 1,797; TL-X 3,407 / 3,926, including 43
  internal > wall cases. SW/TC no verified paired fields; coverage unknown.
- Caveat: neither value fills in for the other. Differences are not automatically
  transport overhead; timing scopes and instrumentation need investigation.
- Display/drill: on-demand tool-detail diagnostic; no dashboard “overhead” KPI.
  Suspicious pair → session and exact raw tool via T.

**C4. “What is the temporal shape of this session?”**

- Metric/view: observed call-bound intervals and emitted/result tool intervals;
  later gaps and overlapping intervals as descriptions. Unit: timestamp / ms.
- Needs: canonical bounds and tool endpoints; raw `timing_events` with event type,
  source, timestamp, and array index for a richer event view.
- Sources/coverage: TL event arrays 4,770 / 4,770; paired tool endpoints
  5,718 / 5,723. SW candidate role/timestamp entries, but pairing unvalidated;
  TC candidate nested event structure with unknown coverage.
- Caveat: 212 arrays are non-chronological. Sort a display copy by timestamp,
  preserve original positions, and show equal-time order as uncertain. Bounds can
  include user messages/results, so they are not pure inference latency or TTFT.
- Display/drill: v0.1 ordered session table; later zoomable swimlane timeline,
  raw event stream only on demand. Path S to M/T and the exact event array element.

### D. Tool usage and behavior

**D1. “What kinds of actions make up this workload?”**

- Metric/view: counts and shares of recorded tools by exact name; tools per
  recorded model call; fraction of calls with zero/multiple nested tools. Unit: calls / ratio.
- Needs: canonical tool name, parent model-call link, source/harness, occurrence
  identity. Optional later versioned tool-family dictionary retaining native names.
- Sources/coverage: TL 5,723 named, parented tools from 4,770 calls; 440 calls
  contain no tools. SW candidate tool fields, but emissions/results must not both
  count as separate invocations. TC structure and coverage need validation.
- Caveat: high tool count may mean useful exploration or finer tool granularity.
  `Bash`, `exec_command`, and `write_stdin` are not interchangeable operations.
- Display/drill: enrich the planned tool-count chart with exact-name filtering;
  use a table for long-tail tools and ratios. Path T, then parent M.

**D2. “Where are explicit tool errors concentrated?”**

- Metric/view: true Boolean errors / known Boolean statuses, by tool and harness;
  unknown count beside the rate. Unit: % and observations.
- Needs: canonical `is_error`; optional exit code and status as separate evidence,
  never a silent fallback unless a source-specific mapping validates that rule.
- Sources/coverage: TL-C 1,793 / 1,797; TL-X 3,041 / 3,926 known statuses.
  Neither `command_exit_code` nor `command_status` occurs in any fixture tool,
  although the mapping supports them. SW/TC error evidence and coverage unverified.
- Caveat: a tool error does not mean a failed task. Unknown status is not success;
  cross-tool and cross-harness rates can reflect different reporting conventions.
- Display/drill: add errors, known/total, and error rate to the tool table;
  click errors versus unknowns separately. Path T.

**D3. “Does the agent repeat a tool after an error?”**

- Metric/view: later “same-tool observation follows marked error” sequences,
  with window definition and count of eligible ordered transitions. Unit: transitions / %.
- Needs: error status, tool name, session order; matching inputs, logical command
  IDs, and continuation links for a stronger retry definition. These are raw/future fields.
- Sources/coverage: TL supports weaker adjacency candidates, but released tool
  input is absent on all 5,723 tools and no continuation key occurs in this fixture.
  SW candidate `tool_input_json`/command/IDs; TC inputs/links unverified; coverage unknown.
- Caveat: same tool twice is not necessarily a retry; a successful later tool
  does not prove task recovery. Do not label this “retry rate” without linkage.
- Display/drill: later sequence table on request, showing the before/after
  observations and rule used; both endpoints must drill through T.

**D4. “Are tool results expanding the context?”**

- Metric/view: result-size distributions and recorded context composition;
  per-call tool-result-character share where a valid total is known. Unit: characters / %.
- Needs: raw `tools[].result_chars`, `input_chars`, `current_tool_result_chars`,
  `current_input_chars`, and sequence; none is a canonical token equivalent.
- Sources/coverage: TL result chars known on 5,718 / 5,723 tools; input chars
  5,723 / 5,723. SW candidate tool result content after role/link validation;
  TC content and coverage unverified. Context-counter metric needs its own validation.
- Caveat: current-context counters are snapshots and may repeat content across
  rounds. Do not sum them as distinct text or convert characters to tokens by a fixed ratio.
- Display/drill: later session-detail size plot or ranked tool results table;
  exact raw counter/result-size fields via M/T. No transcript text inferred from sizes.

### E. Session shape and outcomes

**E1. “What does a typical session look like, and how long is the tail?”**

- Metric/view: distribution of recorded model-call count per observed session;
  median, p90, maximum; count tools separately. Unit: observations per session.
- Needs: canonical session identity scoped by source/harness and occurrence-based
  model-call counts, including sessions with measured zero calls where supported.
- Sources/coverage: TL 80 / 80 sessions with observed counts; sample results above.
  SW candidate `api_call_count` versus child invocation reconstruction; `turn_count`
  is a different metric. TC turn counts possible only after structure validation.
- Caveat: imported completeness is not task completeness; a one-call session is
  not automatically abandonment and a long session is not automatically a loop.
- Display/drill: compact histogram with fixed explicit bins and median annotation;
  bin → matching sessions sorted by count → observations, via S.

**E2. “How often does a session return to the user?”**

- Metric/view: later user-message events and observed switches between user,
  assistant, and tools; separate human-wait intervals only with a validated pairing rule.
- Needs: role/type, timestamp, content availability, stable event identity;
  TraceLab context user-message counters are snapshots, not independent turns.
- Sources/coverage: TL contains 542 user-message timing-event entries, but unique
  conversational-message coverage is unvalidated. SW candidate role and turn fields;
  TC candidate turn structure. Both require measured role/ordering coverage.
- Caveat: messages can be repeated in context, and messages may not be actual
  interventions. `AskUserQuestion` counts alone are not a human supervision rate.
- Display/drill: later session event strip; event → source path and parent record
  through S/M. Keep a human-intervention aggregate unavailable until validated.

**E3. “Did this task succeed?”**

- Metric/view: currently unavailable. Later explicit outcome label, label source,
  evaluation version, and labelled sessions / eligible sessions. Unit: labelled outcomes / %.
- Needs: task identity, objective acceptance criteria, tests or external evaluator,
  human review where appropriate, and a reliable session/task relationship.
- Sources/coverage: no verified ground-truth outcome field in the inspected
  TraceLab fixture or documented SW/TC field subsets. Known verified labels: none here.
- Caveat: final assistant text, no error flag, patch application, or command exit
  zero does not establish success. A model-generated success label is an assessment,
  not ground truth; report its provenance and validation separately if ever used.
- Display/drill: no dashboard success gauge. Session detail can say “Task outcome:
  Unavailable — no verified outcome label”; later label → evaluation evidence → S.

**E4. “Which sessions deserve manual review?”**

- Metric/view: deterministic sort/filter combinations: high call count, high
  observed span, marked errors, large token totals, or incomplete evidence.
  Unit: each underlying metric, with explicit reason for inclusion.
- Needs: canonical session rollups, per-measure coverage, and user-selected
  thresholds or top-k sort. No learned anomaly model required.
- Sources/coverage: TL can use all 80 sessions, with underlying coverage preserved;
  SW/TC only after each chosen component is validated, coverage currently unknown.
- Caveat: these are review candidates, not an inefficiency score. Missingness
  should not silently improve a rank or make a session appear healthy.
- Display/drill: optional sessions-table sorts in v0.1; later saved review views.
  Show contributing reasons as columns and drill through S/M/T/Q.

### F. Reasoning

**F1. “How much reasoning usage is explicitly recorded?”**

- Metric/view: sum known reasoning tokens and per-call distribution, by semantics
  and model; positive-valued calls / known calls as a separate descriptive measure.
- Needs: canonical `reasoning_tokens`, model, semantics, session and occurrence ID.
- Sources/coverage: TL-X 3,187 / 3,187; TL-C 0 / 1,583. The documented SWE-chat
  subset has no separate reasoning-token field; TC accounting is unprofiled.
  Both remain unavailable until equivalent fields are verified.
- Caveat: hidden or unreported reasoning is not zero, and token volume does not
  measure intelligence, rigor, or whether the output is correct.
- Display/drill: optional Codex session-detail usage column or compatible report;
  never a Claude-versus-Codex reasoning leaderboard. Path M.

**F2. “Is reasoning included in output, or counted separately?”**

- Metric/view: accounting check of paired reasoning/output values; subset
  violations and, only after validation, reasoning share of output. Unit: calls / %.
- Needs: canonical reasoning/output, semantics tag, and an explicit validated
  relationship. Additive versus inclusive accounting must be a metric precondition.
- Sources/coverage: TL-X paired fields 3,187 / 3,187; TL-C 0 / 1,583.
  SW/TC no validated relationship or measured paired coverage.
- Caveat: `reasoning <= output` on every row is necessary for a subset hypothesis,
  not sufficient proof. The sample's 46.15% ratio is an accounting diagnostic only.
- Display/drill: definitions/data-quality report until validated; then an optional
  session breakdown. Suspicious rows and source fields via Q/M.

**F3. “Is recorded reasoning associated with longer or larger workflows?”**

- Metric/view: later within-model association between known reasoning tokens
  and observed span/call count, with session-level aggregation. Unit: tokens vs ms/calls.
- Needs: F1 plus validated grouping, timestamps, model, and eventually task controls.
- Sources/coverage: TL-X reasoning known for 40 / 40 sessions after aggregation;
  task controls and clean inference latency are absent. TL-C unavailable;
  SW/TC reasoning availability and coverage unknown.
- Caveat: task difficulty confounds both axes; call rows within a session are
  dependent. This is exploratory association, never evidence that reasoning caused delay.
- Display/drill: later optional scatterplot with n and point-level sessions;
  point → reasoning-contributing calls and source records via S/M.

### G. Data quality of the trace itself

**G1. “Which answers can this import support?”**

- Metric/view: capability and coverage table for each metric, by source/harness;
  known / total and cause of unavailability. Unit: observations / %.
- Needs: canonical nulls plus raw field profiles, mapping diagnostics, eligible
  entity counts, metric prerequisites, and unmapped-path reasons.
- Sources/coverage: TL measured coverage throughout this document; SW/TC remain
  “Unprofiled” until imported/profiled, not synthetic 0% source completeness.
- Caveat: schema presence is not non-null coverage; high coverage is not accuracy.
  Separate unsupported-by-source from supported-but-missing and rejected conversion.
- Display/drill: concise dashboard quality strip; expand to capability matrix
  and affected records via Q. Hide irrelevant capabilities from the default dashboard.

**G2. “Can I trust the identity and import counts?”**

- Metric/view: exact-occurrence duplicates, repeated native-ID groups, conflicting
  canonical projections, and unexplained overlap. Unit: records / groups / observations.
- Needs: file hash, record locator, emission path, claimed IDs, source namespace,
  harness, mapping revision, projection comparison, import contributions.
- Sources/coverage: TL all 4,770 root occurrences and 5,723 tool paths identifiable;
  sample native collision counts are zero, upstream uniqueness is disproven.
  SW/TC can gain occurrence provenance from the importer; native scopes unvalidated.
- Caveat: equal native IDs alone do not authorize deletion. Exact-file idempotency
  is narrower than cross-export deduplication; duplicate count grain must be labelled.
- Display/drill: import report and source-quality detail; Q shows both conflicting
  records/projections or the previous occurrence for an exact re-import.

**G3. “Are timestamps internally coherent?”**

- Metric/view: array inversions, missing endpoints, negative elapsed values,
  endpoint/reported-duration disagreement, and extreme observed spans. Unit: records / ms.
- Needs: raw ordered timing events; canonical endpoints and reported wall/internal
  values; parsing diagnostics, precision, and timezone/unit rules.
- Sources/coverage: TL 4,770 / 4,770 event arrays and 5,718 paired tool endpoints;
  212 array inversions. SW/TC checks depend on profiled timestamp/interval structure,
  currently unmeasured. Do not assume every timestamped source has tool pairs.
- Caveat: out-of-order storage need not mean wrong timestamps. Extreme spans may
  be real resumptions; a timing disagreement is a diagnostic, not automatic corruption.
- Display/drill: quality report and session-local annotations; Q → exact event
  positions or T → endpoint fields. No silent clipping of long observations.

**G4. “What did this import omit or fail to normalize?”**

- Metric/view: accepted/partial/rejected/ignored/duplicate root-record outcomes;
  separate entity emission counts and field-level conversion/coverage diagnostics.
- Needs: `record_results`, rejects, entity contributions, immutable mappings,
  raw locators, and the declared unit/semantics for each mapped field.
- Sources/coverage: infrastructure-level capability for all three sources after
  import. No fresh import was executed here, so this analysis does not invent
  accepted/rejected counts from successful raw JSON decoding.
- Caveat: one root row can emit one model call and several tools. Record outcome
  percentages and entity coverage use different denominators and cannot be combined.
- Display/drill: import report first, compact dashboard quality notification only
  for material limitations; outcome → record diagnostics → original payload via Q.

### H. Comparisons across agents and models

**H1. “How do these imported cohorts differ?”**

- Metric/view: descriptive side-by-side session distributions, tool mix, token
  totals within compatible semantics, and coverage. Unit: the selected metric.
- Needs: source, harness, provider, exact model labels, time, session identity,
  validated accounting groups; repo/task covariates only when observed.
- Sources/coverage: TL harness/model labels 4,770 / 4,770; project 1,583 / 4,770
  and absent for every Codex row. SW candidate agent/repo/model fields;
  TC agent/model fields and coverage unverified.
- Caveat: this sample is provider-stratified, not task matched. A project filter
  would systematically exclude Codex; it cannot create a fair comparison.
- Display/drill: later cohort report with n, coverage, and separate incompatible
  panels; existing filters suffice for v0.1. Group → sessions via S/M/T.

**H2. “Does a session use more than one model?”**

- Metric/view: distinct recorded model labels per session; ordered model changes
  only where sequence is validated. Unit: model labels / sessions / transitions.
- Needs: canonical model, session, sequence, occurrence identity and source;
  task role or routing reason would require new evidence.
- Sources/coverage: TL models known on 4,770 / 4,770 calls; one Codex session
  and no Claude sessions contain multiple labels in this sample. SW candidate
  entry `model`; TC model fields/coverage unknown.
- Caveat: model strings are source claims, not independently verified product
  availability. A label switch does not prove deliberate routing or a fallback.
- Display/drill: model chips in session detail, optional model column in ordered
  calls; transitions later. Path S → both adjacent model occurrences → M.

**H3. “Did a change in the agent improve performance?”**

- Metric/view: later matched-task or randomized evaluation of outcome, cost,
  and latency differences, with uncertainty at the task/session level.
- Needs: comparable task identity, harness/configuration version, model settings,
  environment, outcome labels, compatible measurements, and a defensible design.
- Sources/coverage: none of the inspected/documented source subsets establishes
  this complete evidence chain. Existing coverage of valid causal comparisons is
  unavailable; generic dates and repo labels are insufficient.
- Caveat: before/after shifts can reflect workload composition or instrumentation.
  Do not turn provider medians, repeated calls, or voluntary trace samples into an A/B test.
- Display/drill: later evaluation report, explicitly separated from observational
  analytics; cohort → task pair → sessions → source records and evaluation artifacts.

## Priorities for v0.1.0 within the four-day timebox

The baseline remains four KPIs and three charts. Align the four KPI slots with
the existing API's sessions, recorded model-call observations, recorded tool-call
observations, and input usage. The input slot should show compatible accounting
groups separately when the selection mixes tags, rather than one headline total.
Preserve the planned activity-by-day, tokens-by-model, and tool-count charts.
These are navigation surfaces as much as summaries.

The following additions are ordered. They reuse canonical data and existing
tables rather than creating a second analytics subsystem.

| Priority | Addition | Why it earns release time | Scope and completion condition |
| --- | --- | --- | --- |
| P0 | Coverage and comparability beside values; metric definitions; exact provenance drill-down | Prevents false confidence in every chart | Required baseline trust work; unknowns render correctly and chart → session → raw occurrence works |
| P1 | Tool table: count, marked errors, known status, error rate, median/p90 wall latency, known wall | Answers where errors and waits concentrate with existing fields | Add below/behind tool-count chart; no new chart page, no generalized tool taxonomy |
| P2 | Rounds-per-session median/p90 and five-bin distribution | Reveals the skew that hides behind totals | Put compact distribution in sessions view or chart expansion; clicking a bin yields exactly its sessions |
| P3 | Cache read share and accounting split for compatible Claude selection | Useful signal with complete measured sample coverage | Conditional panel only; token-weighted formula, validated residual, unavailable state for unsupported selections |
| P4, only if time remains | Session-level input/output and tool-latency columns; manual sort by large count/span | Makes investigation faster without inferred outcomes | Reuse detail/list data; no anomaly scoring, sequence reconstruction, or automatic advice |

P1–P3 are the entire proposed analytical increment. If they threaten the second
source, mapping workflow, or day-4 verification gates, keep P1, move P2 to a plain
session-table summary, and defer P3. Do not trade away data correctness to add charts.
The eight-theme catalogue is a roadmap, not a four-day implementation commitment.
Cost estimation, transcript search, anomaly detection, and natural-language data
questions remain outside v0.1.0 as specified by the consolidated plan.

Suggested integration sequence within the existing plan:

1. Day 1: retain the thin slice and source-record path; agree the metric contracts
   and fix the fixture expectations for P1–P3.
2. Day 2: implement definitions in the domain and entity-grain SQL in the query
   adapter; add P1 and the compact P2 view with filter-preserving drill-down.
3. Day 3: validate second-source prerequisites and show unsupported metrics
   honestly; add P3 only if baseline and second-source work remain on schedule.
4. Day 4: verify the release on the intended commit, publish three reproducible
   observations, and preserve the reserved-file exercise. No analytical scope expansion.

The future implementation should include meaningful reference checks, not just
tests that mirror SQL: a call with multiple tools contributes tokens once;
an all-null group stays unavailable; the error denominator excludes null;
mixed tags are partitioned; re-import does not change totals; and a chart's
drilled population reconciles to its numerator and coverage denominator.
Use a small adversarial fixture with duplicate claimed IDs and out-of-order times
because the current 80-session sample does not exercise native-ID collisions.
No product code or tests were changed for this research answer.

## Later work, in dependency order

| Stage | Capability | Evidence or engineering needed before shipping |
| --- | --- | --- |
| 1 | Validate SWE-chat and/or Trace Commons metric capabilities | Profile a bounded reviewed excerpt; validate granularity, usage, tool linkage, statuses, units, and occurrence identity; exclude reserved holdout |
| 2 | Per-session context/cache trajectories and model changes | Ordered observations, explicit gaps, coherent accounting contracts; optional raw extensions |
| 3 | Rich temporal swimlanes and interval overlap diagnostics | Event projection with stable source paths, clear timing semantics, precision rules; no fabricated critical path |
| 4 | Tool-result size analysis and sequence review | Source-specific raw field extraction; tool-family and continuation contracts where evidence exists |
| 5 | Saved cohort reports and before/after descriptive comparisons | Filter/metric/mapping versions, reproducible cohorts, visible sample selection and missingness |
| 6 | Configured cost estimates and cache scenarios | Versioned price schedules and validated billable buckets, uncertainty/unpriced handling |
| 7 | Verified task outcomes and agent evaluations | Task identity, external labels/evaluators, acceptance criteria, linked artifacts, experimental design |
| 8 | Automated findings or anomaly suggestions | Validated baseline metrics, sufficient history, source-aware thresholds, evidence links, evaluation of false positives |

Before rich graphs, implement the simpler table that answers the same question.
Do not promise retry detection, a child-agent graph, a critical path, or cost per
successful task merely because tools and timestamps are present.

## Where each insight should appear

| Surface | Show by default | Reveal only when needed |
| --- | --- | --- |
| Dashboard | Existing four KPIs, three charts, active source/harness/model/time filters, small quality strip | P1 tool table expansion; P3 cache panel for compatible cohorts; precise definitions and coverage reasons |
| Sessions list | Session identifier, harness/model, recorded calls/tools, observed span, selected compatible usage | P2 distribution, extra metric columns, manual review sorts, unmapped repo explanation |
| Session detail | Header with scope and observed span, ordered call/tool table, known usage and error markers | Raw event stream, context counters, internal-vs-wall pairs, reasoning accounting, full imported versus filtered span |
| Import report | Record outcomes, entity counts, missingness causes, provenance, mapping revision | Detailed collisions, conversion errors, unsupported raw paths, all affected records |
| Comparative report | Deliberately selected cohorts, definitions, n/coverage, compatible panels | Rich distribution plots, matched-task analyses once supported, price/evaluation assumptions |
| Raw record drawer | Selected exact record and highlighted field/emission path | Neighboring records and other contributors; source metadata and original release locators |

A dashboard should answer “where should I look?” in one screen. Session detail
should answer “what was observed here?” A report should answer “can I defend this
comparison?” The raw drawer should answer “which exact evidence produced this value?”

Prefer horizontal bars for ranked tool/model counts, a histogram for session
size, and a table for counts, rates, coverage, and two latency quantiles together.
Avoid a giant Sankey, force-directed tool graph, or scatterplot wall in v0.1.0:
they consume space while weakening the route to a concrete record.
If a later latency plot uses a log scale, label it and handle zeros explicitly;
never silently discard the observed zero-latency calls.
Tables should remain available alongside plots for exact values and keyboard use.

No unsupported cost/success/reasoning widgets should occupy permanent empty space.
Use the capability panel or session context to explain absence when it matters.
Small populations need visible n; neutral text is preferable to categorical
“healthy/unhealthy” colors or rankings unsupported by baseline expectations.
Any later minimum-n or alert threshold is a documented product rule, not a
statistical guarantee. Coverage remains visible even when a threshold is met.

Preserve user navigation: chart click carries filters, selected metric, and group;
the sessions table states whether it lists numerator contributors, denominator
contributors, or records with unknown values. Back navigation restores the scope.
For an error metric, provide distinct “View errors,” “View known statuses,” and
“View unknown statuses” actions. They represent different populations.
The raw API's `payload_text` should be used for exact display rather than browser
number reserialization, which can round large integers.

## Honest limits and the language the UI should use

| Tempting claim | What the evidence actually supports | Suggested UI wording |
| --- | --- | --- |
| “Agent success rate” | No verified task outcome labels | “Task outcome: Unavailable — no verified outcome label.” |
| “Total spend” | Recorded usage, without configured rates | “Cost estimates require a price schedule and compatible usage accounting.” |
| “95.61% saved” | Claude token-weighted cache read share | “95.61% of recorded Claude input tokens were cache reads.” |
| “Codex has no caching” | Claude-specific cache columns are null | “Cache read share: Unavailable — this mapping does not provide Codex cache accounting.” |
| “Claude did no reasoning” | Reasoning-token values are null | “Reasoning tokens: Unavailable — not reported in this accounting.” |
| “6.12% of all tools failed” | 296 marked errors among 4,834 known statuses | “6.12% of known statuses; 4,834 / 5,723 known, 889 unknown.” |
| “No errors” for an all-null group | No status evidence | “Error rate: Unavailable — 0 / 30 statuses known.” |
| “15 days of active work” | Span between imported timestamps | “Observed span in imported data: 15.15 days. May include idle time and resumptions.” |
| “Model response time” | Min/max source event bounds with mixed event types | “Observed call event span; not an API latency measurement.” |
| “Network overhead” | Two differently scoped latency measurements | “Wall/internal difference; timing scopes may differ.” |
| “Unique API calls” | Recorded occurrence counts; claimed IDs may collide | “Recorded model-call observations.” |
| “All overlaps removed” | Exact-file re-import adds no new occurrences | “Exact-file duplicates handled; cross-export overlap may remain.” |
| “Codex is twice as inefficient” | Different observed session-size distributions | “Different imported cohorts; tasks and accounting are not matched.” |
| “Tool retried the same command” | Same tool appears again, input removed | “Repeated tool observation; command identity unavailable.” |
| “Source has no errors” | Source not yet profiled | “Unprofiled — error-status availability has not been validated.” |
| “No data” after a time filter | Some records may be undated | “No dated observations in this range; N undated observations cannot be placed.” |

The release removes tool input; the inspected fixture carries event types and
character counts rather than a full readable transcript. Do not promise command
replay, semantic task categories, code-quality assessment, or a natural-language
summary of what was changed from this fixture alone.
SWE-chat may later permit content-based analyses, but its documented fields do
not establish trustworthy labels or a one-entry-one-call mapping.

No source establishes developer productivity, customer value, code correctness,
security posture, or task difficulty from token/tool counts alone.
Pseudonymous users and project labels support descriptive filters where present;
they do not support performance rankings of people or cross-source identity joins.
The sample's model strings should be preserved as recorded labels, not normalized
to invented release metadata or assumed public catalog entries.

Provenance is an explanation mechanism, not just a debugging link. A reported
fact should be reproducible from immutable source occurrences plus the approved
mapping and metric versions. Where those prerequisites are incomplete, the
product should expose the incomplete evidence instead of completing the story.

## Reproducing the sample calculations

Run the following from the repository root. It reads the fixture only, writes
no files, uses no network, and does not require `uv` or installed dependencies.
It prints the raw inputs behind the principal sample findings and diagnostics.
Values here are raw-fixture observations; an imported result with rejects must
recompute these metrics over its accepted population and show the exclusions.

```python
import collections
import datetime as dt
import gzip
import hashlib
import json
import math
import statistics

path = "fixtures/tracelab/tracelab-sample.jsonl.gz"
with open(path, "rb") as stream:
    print("sha256", hashlib.sha256(stream.read()).hexdigest())
with gzip.open(path, "rt", encoding="utf-8") as stream:
    rows = [json.loads(line) for line in stream]

def timestamp(value):
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))

def distribution(values):
    values = sorted(values)
    if not values:
        return None
    return dict(n=len(values), median=statistics.median(values),
                mean=statistics.mean(values),
                p90=values[math.ceil(0.90 * len(values)) - 1],
                maximum=values[-1], total=sum(values))

def size_bin(n):
    for upper, label in [(5, "1-5"), (20, "6-20"), (50, "21-50"),
                         (100, "51-100")]:
        if n <= upper:
            return label
    return "101+"

for provider in ("claude", "codex", "ALL"):
    calls = [r for r in rows if provider == "ALL" or r["provider"] == provider]
    tools = [t for r in calls for t in r["tools"]]
    sessions = collections.Counter(r["session_id"] for r in calls)
    print("\ncohort", provider, "calls", len(calls), "tools", len(tools))
    print("rounds", distribution(sessions.values()))
    print("bins", collections.Counter(size_bin(n) for n in sessions.values()))
    print("largest sessions", sorted(sessions.values(), reverse=True)[:2])
    for field in ("input_tokens_total", "output_tokens", "prefix_tokens",
                  "newly_append_tokens", "claude_uncached_input_tokens",
                  "claude_cache_creation_input_tokens",
                  "claude_cache_read_input_tokens", "reasoning_output_tokens"):
        known = [r[field] for r in calls if r.get(field) is not None]
        print(field, "known", len(known), "of", len(calls),
              "sum", sum(known) if known else None)
    statuses = [t["is_error"] for t in tools if isinstance(t.get("is_error"), bool)]
    print("errors", sum(statuses), "known", len(statuses), "of", len(tools),
          "rate", sum(statuses) / len(statuses) if statuses else None)
    for name in sorted({t["tool_name"] for t in tools}):
        group = [t for t in tools if t["tool_name"] == name]
        wall = [t["tool_wall_latency_ms"] for t in group
                if t["tool_wall_latency_ms"] is not None]
        status = [t["is_error"] for t in group if isinstance(t["is_error"], bool)]
        print("tool", name, "all", len(group), "wall", distribution(wall),
              "errors", sum(status), "status known", len(status))
    pairs = [t for t in tools if t["tool_wall_latency_ms"] is not None
             and t["tool_internal_latency_ms"] is not None]
    print("internal known", sum(t["tool_internal_latency_ms"] is not None
                                for t in tools))
    print("internal > wall", sum(t["tool_internal_latency_ms"] >
                                t["tool_wall_latency_ms"] for t in pairs),
          "pairs", len(pairs))
    inversions = sum(any(timestamp(a["timestamp"]) > timestamp(b["timestamp"])
                         for a, b in zip(r["timing_events"], r["timing_events"][1:]))
                     for r in calls)
    print("nonchronological rows", inversions)
    print("prefix split mismatches", sum(r["input_tokens_total"] !=
          r["prefix_tokens"] + r["newly_append_tokens"] for r in calls))
    if provider == "claude":
        print("Claude split mismatches", sum(r["input_tokens_total"] != sum(
            r[k] for k in ("claude_uncached_input_tokens",
                           "claude_cache_creation_input_tokens",
                           "claude_cache_read_input_tokens")) for r in calls))
    for name, keys in (
        ("round_id", [r["round_id"] for r in calls]),
        ("trace_key", [r["trace_key"] for r in calls]),
        ("session/sequence", [(r["session_id"], r["round_index"]) for r in calls]),
        ("tool_call_id", [t["tool_call_id"] for t in tools]),
    ):
        counts = collections.Counter(keys)
        print(name, "collision groups", sum(n > 1 for n in counts.values()),
              "excess occurrences", sum(n - 1 for n in counts.values() if n > 1))
    spans = []
    for session_id in sessions:
        group = [r for r in calls if r["session_id"] == session_id]
        times = [timestamp(e["timestamp"]) for r in group for e in r["timing_events"]]
        times += [timestamp(t[k]) for r in group for t in r["tools"]
                  for k in ("emitted_at", "result_at") if t.get(k)]
        if times:
            spans.append((max(times) - min(times)).total_seconds())
    print("observed span seconds", distribution(spans))
    print("no-tool calls", sum(not r["tools"] for r in calls))
    print("multi-model sessions", sum(len({r["model"] for r in calls
          if r["session_id"] == sid}) > 1 for sid in sessions))
    print("event types", collections.Counter(e["event_type"] for r in calls
                                            for e in r["timing_events"]))

claude = [r for r in rows if r["provider"] == "claude"]
codex = [r for r in rows if r["provider"] == "codex"]
print("Claude cache read share", sum(r["claude_cache_read_input_tokens"]
      for r in claude) / sum(r["input_tokens_total"] for r in claude))
print("Codex prefix share (not cache share)", sum(r["prefix_tokens"]
      for r in codex) / sum(r["input_tokens_total"] for r in codex))
print("Codex reasoning/output diagnostic", sum(r["reasoning_output_tokens"]
      for r in codex) / sum(r["output_tokens"] for r in codex))
codex_tools = [t for r in codex for t in r["tools"]]
print("Codex write_stdin share of tool wall sums",
      sum(t["tool_wall_latency_ms"] for t in codex_tools
          if t["tool_name"] == "write_stdin" and t["tool_wall_latency_ms"] is not None)
      / sum(t["tool_wall_latency_ms"] for t in codex_tools
            if t["tool_wall_latency_ms"] is not None))
print("largest wall tool with fixture line and nested index", max(
    (t["tool_wall_latency_ms"], line, index, r["session_id"])
    for line, r in enumerate(rows, 1) for index, t in enumerate(r["tools"])
    if t["tool_wall_latency_ms"] is not None))
```
