# What AgentScope can learn from agent traces, and how to show it

Claude Opus 5, 2026-09-07. Independent brainstorm answering
`research/insights/00-question.md`. Every number labelled **[fixture]** was computed
by me from `fixtures/tracelab/tracelab-sample.jsonl.gz` — 80 sessions, 4,770
model-invocation rows, 5,723 nested tool observations. That sample is a
deterministic 40+40 provider-stratified draw from 4,265 upstream sessions; it is
**not statistically representative** and no number below should be quoted as a
fact about coding agents in general. They are here to prove that a metric is
computable, to size it, and to expose where it breaks.

---

## 0. Stance

Three claims drive everything that follows.

1. **The interesting object is not the model call. It is the loop.** 90.2% of
   rounds in the fixture begin with a `tool_result`, not a `user_message`
   **[fixture]**. Only 542 `user_message` events exist across 4,770 rounds. The
   agent is overwhelmingly talking to itself. A dashboard built on "model calls"
   and "tokens" describes the exhaust; a dashboard built on the loop —
   what the agent fed itself, what it got back, what failed, how the context
   grew — describes the machine.

2. **Almost all input tokens are re-read context.** 95.86% of all input tokens
   across the fixture are `prefix_tokens` **[fixture]**; on Claude rows,
   `prefix_tokens` equals `claude_cache_read_input_tokens` exactly on all 1,583
   rows **[fixture]**. So the single largest lever on cost is not "how many calls"
   but "how well the prefix is reused and how big it got". That is a *measurable*,
   *actionable* number, and nobody's default agent dashboard shows it.

3. **The trace's own quality is a first-class insight, not a footnote.**
   `is_error` is unknown on 15.5% of tool observations **[fixture]**;
   `internal_latency` exists on 86.8% of Codex tools and 0.2% of Claude tools
   **[fixture]**; the mapping's `exit_code` and `status` target fields have **no
   source at all** in this release. If AgentScope silently coerces those to 0 or
   `false` it becomes a lying dashboard. Showing coverage is the product.

Consequence for v0.1.0: ship *few* views, each with an honest denominator and a
drill-down to the exact source record. Progressive disclosure is not a nicety
here — it is the only way a page with this many caveats stays readable.

---

## 1. Grounding, and how I got the numbers

Read: `research/insights/00-question.md`, `docs/datasets/README.md`,
`backend/src/agentscope_app/domain/schema.py`, `backend/mappings/tracelab-v1.json`,
`docs/planning/2026-09-07-consolidated-plan.md`, `scripts/scan_tracelab.py`,
`web/src/pages/*`.

All fixture numbers come from short stdlib-only Python (`gzip` + `json`) over the
committed fixture, e.g.:

```python
import gzip, json
from collections import defaultdict
rows = [json.loads(l) for l in gzip.open('fixtures/tracelab/tracelab-sample.jsonl.gz','rt')]
IT = sum(r['input_tokens_total'] for r in rows)
PT = sum(r['prefix_tokens'] for r in rows)
print(len(rows), PT/IT)            # 4770 0.9586
sess = defaultdict(list)
for r in rows: sess[r['session_id']].append(r)
print(len(sess))                   # 80
```

**SWE-chat Parquet: not inspected.** `data/raw/swe-chat/` exists
(`sessions.parquet` 1,997,377 B; `conversations.parquet` 1,311,422,253 B) but
`pyarrow` is not installed in the backend uv environment nor in system Python 3.9
(`ModuleNotFoundError: No module named 'pyarrow'`, and `pyarrow` is absent from
`backend/pyproject.toml` dependencies). I did not install anything. Every
SWE-chat statement below therefore comes from the column list recorded in
`docs/datasets/README.md`, which was itself read from the Parquet footers, and is
marked **[documented, unvalidated]**. Trace Commons structure is
**[uninspected by design]** — the reserved native file is a holdout.

---

## 2. What one row actually is

The mapping (`backend/mappings/tracelab-v1.json`) is right about the shape, and
the fixture confirms it. Restating it in analyst terms, because every metric
depends on it:

- One JSONL row = **one recorded model invocation** inside a session ("round").
- `round_index` is dense and 0-based: **all 80 sessions start at round 0 with no
  gaps** — 0 missing indices across the whole fixture **[fixture]**. So round
  ordering is trustworthy *within this sample*, and a gap is a genuine signal of
  truncated capture if one ever appears.
- `timing_events[]` is a heterogeneous event stream for the round
  (`tool_call` 5,723, `tool_result` 5,705, `usage_report` 3,187 (Codex only),
  `reasoning` 2,993, `text` 1,927, `user_message` 542) **[fixture]**.
- `tools[]` is exactly parallel to the `tool_call` events: 5,723 vs 5,723, and
  **0 rows where the two counts differ** **[fixture]**. Good news for the mapping:
  `$.tools[*]` loses nothing.
- But there are **18 more `tool_call` events than `tool_result` events**
  **[fixture]** — 18 tool calls whose result never arrived in the trace. Five of
  those have `result_at` null. That is a real "agent hung / session killed
  mid-tool" signal, and it is exactly the sort of thing a naive `COUNT(*)` erases.
- Token arithmetic is exact and worth asserting in a reference test:
  `prefix_tokens + newly_append_tokens == input_tokens_total` on **4,770/4,770**
  rows; `claude_uncached + claude_cache_creation + claude_cache_read ==
  input_tokens_total` on **1,583/1,583** Claude rows **[fixture]**.
- **`prefix_tokens == claude_cache_read_input_tokens` on 1,583/1,583 Claude rows**
  **[fixture]**. This is the most useful structural discovery in the file: it
  gives a *cross-provider* context-reuse ratio (`prefix/input_total`) that is
  available on 100% of rows including Codex, where all three `claude_*` fields are
  null on all 3,187 rows.

### 2.1 Measured baseline (all **[fixture]**)

| Quantity | Claude | Codex | All |
|---|---:|---:|---:|
| Sessions | 40 | 40 | 80 |
| Rounds | 1,583 | 3,187 | 4,770 |
| Tool observations | 1,797 | 3,926 | 5,723 |
| Input tokens | 186,454,781 | 366,993,096 | 553,447,877 |
| Output tokens | 941,168 | 1,542,659 | 2,483,827 |
| Output ÷ input | 0.0050 | 0.0042 | 0.0045 |
| Prefix (reused) share of input | 95.61% | 95.99% | 95.86% |
| Cache-read share of input | 95.61% | *unavailable* | — |
| Cache-creation share of input | 4.35% | *unavailable* | — |
| Uncached share of input | 0.034% | *unavailable* | — |
| Reasoning tokens | *unavailable* | 711,948 | — |
| Reasoning ÷ output | *unavailable* | 46.2% | — |
| Rounds with zero tools | 7.4% | 10.1% | 9.2% |
| Tool `is_error` known | 99.8% | 77.5% | 84.5% |
| Tool error rate (on known) | 4.41% | 7.14% | **6.12%** |
| `internal_latency_ms` present | 0.2% | 86.8% | 59.6% |
| Median rounds per session | 12 | 26 | 19 |
| Observed session span, total | 27.2 h | 429.1 h | 456.2 h |
| Tool wall time, total | 15.0 h | 6.1 h | 21.1 h |

Date range 2025-09-24 → 2026-06-04; 20 pseudonymous users; 23 projects (Claude
rows only — `project` is absent on **all** 3,187 Codex rows); 14 distinct model
labels; stores `.claude` (30 sessions), `.claude.back` (10), `.codex` (40), with
**no session appearing in two stores**.

---

## 3. Insight catalogue

Format per entry: **Q** the user's question · **M** metric/view · **F** fields ·
**S** source support and coverage · **C** comparability caveat · **V** visual form
· **D** drill-down · **P** disclosure level (`D` dashboard default, `D+` dashboard
on demand, `S` session detail, `R` report/table, `Q` quality strip).

Source column key: `TL` TraceLab (measured here), `SC` SWE-chat
[documented, unvalidated], `TC` Trace Commons [uninspected].

---

### A. Cost and tokens

**A1 — Where did my tokens go?**
- **Q** "Which sessions/models/users consumed the input tokens I am paying for?"
- **M** `sum(input_tokens)`, `sum(output_tokens)` grouped by model, then by
  session, then by user; plus concentration (top-*n* share).
- **F** `input_tokens_total`, `output_tokens`, `model`, `provider`, `session_id`, `user`.
- **S** TL 100% of rows. SC: session- and turn-level token columns exist, but
  whether one conversation row equals one API call is unvalidated — token sums may
  double-count. TC unknown.
- **C** Token counts are only additive **within one `token_semantics` tag**.
  `tracelab-claude` input includes cache reads; `tracelab-codex` input includes a
  reused prefix that is *not* proven to be a billed cache read. Summing them into
  one "total tokens" KPI is defensible only as an *observation count*, never as a
  cost proxy. Label the KPI "input tokens as counted by the source".
- **V** Horizontal bar, sorted descending, one bar per model, stacked into
  *reused prefix* / *new input*; a second bar row for output. Not a pie.
- **D** bar → session list filtered to that model → session detail → round table →
  raw record.
- **P** `D` (this is one of the three planned charts; make it stacked by reuse and
  it earns its place twice).
- **Fixture evidence**: `gpt-5.4` 188.8 M input over 1,458 rounds;
  `claude-opus-4-7` 148.6 M over 1,050; `gpt-5.2-codex` 87.7 M over 766 **[fixture]**.

**A2 — Cost is not spread; it is concentrated.**
- **Q** "Is my spend broad or is it five sessions?"
- **M** Share of total input tokens held by top-*k* sessions / users / rounds.
- **F** as A1.
- **S** TL 100%. SC likely (session token columns). TC unknown.
- **C** Concentration is scale-free and *does* survive the semantics problem if
  computed within a provider. Across providers, compute separately.
- **V** Lorenz-style cumulative share curve, or simply a "top 10 sessions" table
  with a share column. The curve is prettier; the table is what people act on.
- **D** row → session detail.
- **P** `D+` (a one-line KPI on the dashboard — "top 5 sessions = 53% of input
  tokens" — expanding to the table).
- **Fixture evidence**: top 5 of 80 sessions = **52.7%** of all input tokens; top
  10 = **72.1%**; top 1 of 20 users = **28.7%**, top 3 = **69.7%**. The largest
  session is 717 rounds / 103.2 M input tokens **[fixture]**. Round-level
  concentration is *mild* by comparison (top 10% of rounds = 21.6% of input),
  which is the real finding: **cost lives in long sessions, not in fat rounds.**
  That reframes the optimisation target from "trim prompts" to "end sessions".

**A3 — Output is a rounding error; input is the bill.**
- **Q** "What ratio of my tokens is the model actually producing?"
- **M** `output ÷ input` per model and per session.
- **F** `output_tokens`, `input_tokens_total`.
- **S** TL 100%. SC documented. TC unknown.
- **C** Within-semantics only. A low ratio is *not* inefficiency — it is the
  arithmetic of a long re-read prefix. Do not colour it red.
- **V** Dot plot, one dot per model, ratio on a linear axis with a reference line
  at the fleet median; small multiples if you also split by month.
- **D** dot → sessions for that model.
- **P** `R` (definitions/report page). It is a *shape* fact, not a daily one.
- **Fixture evidence**: 0.0045 overall; range across models from 0.0022
  (`codex-auto-review`, n=4 rounds) to 0.0381 (`gpt-5.3-codex-spark`, n=3) — both
  too small to report — with the credible band 0.0034–0.0088 for models with
  >100 rounds **[fixture]**. Any per-model panel must suppress n<30.

**A4 — Cost per unit of work.**
- **Q** "What did a round / a tool call / a session cost in tokens?"
- **M** `input_tokens per round`, `per tool call`, `per session`.
- **F** as above plus tool counts.
- **S** TL 100%. SC needs `api_call_count` validation first. TC unknown.
- **C** "Per session" is unstable because session length is wildly skewed
  (1 → 717 rounds). Report medians with an IQR, never a mean.
- **V** Box/violin by provider; or ECDF, which is more honest with n=80.
- **D** point → session.
- **P** `D+`.

**A5 — Money.**
- **Q** "What did this cost in currency?"
- **M** `Σ (tokens × configured unit price)` per token class.
- **F** all token fields + a user-supplied price table keyed by
  `(provider, model, token class)`.
- **S** None of the three sources carries prices. Out of scope for v0.1.0 per the
  plan (§8 "cost estimates" is explicitly cut) — and correctly so.
- **C** Publishing a currency figure from a guessed price list is the single
  fastest way to lose the trust the rest of the product is buying.
- **V** n/a in v0.1.0.
- **P** later. When it lands: the price table is a first-class, versioned,
  user-owned object; unpriced `(model, class)` combinations render as
  "Unavailable", and the KPI shows *priced coverage* ("74% of tokens priced")
  beside the figure. Note that with 95.9% of input being reused prefix, the whole
  answer hinges on the cache-read discount, so a price table without a cache-read
  rate is worse than none.

---

### B. Caching and context reuse — *the highest-value theme*

**B1 — Context reuse ratio (the one number I would put on the wall).**
- **Q** "How much of what I send is context I already sent?"
- **M** `prefix_tokens ÷ input_tokens_total`, aggregated by session / model / day.
- **F** `prefix_tokens`, `input_tokens_total`.
- **S** TL **100% of rows, both providers** — this is the whole point. SC: only a
  Claude-shaped `cache_read_input_tokens` [documented, unvalidated], so the
  equivalent is coverage-limited. TC unknown.
- **C** On Claude this ratio *is* the cache-read ratio (proven identical on all
  1,583 rows). On Codex it is a **declared prefix reuse**, not a proven billed
  cache hit. Label the Codex series "prefix reuse (billing status unknown)" and
  keep the two series visually distinguishable — same chart, different treatment,
  with the caveat in the tooltip, not in a footnote nobody reads.
- **V** Line over rounds (x = `round_index`, y = ratio) as *small multiples per
  provider*, plus a session-level distribution strip.
- **D** point → the round → the raw record.
- **P** `D` — replace or augment the planned "tokens by model" chart with the
  reuse-stacked version (A1) and put this ratio as KPI #2.
- **Fixture evidence**: overall 95.86%. Per session: Claude p10 52.4% / p50 92.1%
  / p90 99.1% / min 9.1%; Codex p10 78.2% / p50 91.4%. **Short sessions (≤5
  rounds) median 79.6% vs long sessions (≥50 rounds) median 95.9%** **[fixture]**.

**B2 — Cache warm-up curve.**
- **Q** "How many rounds before the cache is doing its job?"
- **M** Cache-read share of input by `round_index` bucket.
- **F** `claude_cache_read_input_tokens`, `claude_cache_creation_input_tokens`,
  `claude_uncached_input_tokens`, `input_tokens_total`, `round_index`.
- **S** TL **Claude only** (all three fields null on all 3,187 Codex rows). SC
  [documented, unvalidated] if the cache columns are populated. TC unknown.
- **C** Never draw the Codex series on this chart. Show it as an explicitly empty
  panel labelled "not recorded for this provider" — an absent panel teaches
  nothing; an empty labelled one teaches the coverage rule.
- **V** Stacked area (read / creation / uncached = 100%) against round bucket.
- **D** bucket → rounds in that bucket.
- **P** `D+` / `R`.
- **Fixture evidence**, Claude rows: rounds 0–9 read **83.75%**, creation 16.03%,
  uncached 0.22%; rounds 20–29 read **97.84%**, creation 2.11%; steady ~96–98%
  thereafter **[fixture]**. Read: the first ~20 rounds carry essentially all the
  cache-creation cost. **Only 2.1% of Claude rounds are fully cold**
  (`cache_read == 0`).

**B3 — Cache collapse / re-warm events.**
- **Q** "Did my cache break mid-session, and where?"
- **M** Count of round transitions where `cache_read` drops by >50% versus the
  previous round in the same session; flag the offending round.
- **F** `claude_cache_read_input_tokens`, `session_id`, `round_index`.
- **S** TL Claude only. SC unknown. TC unknown.
- **C** A drop is also produced by a legitimate context compaction, so this is a
  *pointer*, not a verdict. Word it "cache read fell sharply", never "cache miss".
- **V** In session detail: a rug/marker on the reuse line at each collapse.
- **D** marker → the round → raw record.
- **P** `S` only. Nobody needs this on a dashboard.
- **Fixture evidence**: **36 of 1,543 Claude round transitions (2.3%)**
  **[fixture]**. Low, but each one is worth ~a full prefix re-creation.

**B4 — Context growth (the thing that causes B1 to look good and cost to look bad).**
- **Q** "How fast does my context grow, and where does it plateau?"
- **M** Median `input_tokens_total` by `round_index` bucket; session peak context.
- **F** `input_tokens_total`, `round_index`.
- **S** TL 100%. SC turn-level input tokens [documented, unvalidated]. TC unknown.
- **C** Comparable across providers as a *shape*, not a level, because the
  semantics tag differs. Plot both, label the axis "input tokens as counted by the
  source".
- **V** Median line with an IQR band, x = round index (cap at p95 of session
  length, with the tail folded into a final bucket and labelled as such).
- **D** band → sessions crossing a chosen threshold.
- **P** `D+`, and the per-session version in `S`.
- **Fixture evidence**: Claude median input rises 34.1 k (rounds 0–9) → 138.8 k
  (rounds 80–89); Codex 27.2 k → 150.5 k. Session peak context p50 **83.5 k**,
  p90 **224.8 k**, max **392.0 k** **[fixture]**. Two thirds of the way to a
  200 k window by round 80 is an actionable operational fact.

**B5 — What is actually filling the context.**
- **Q** "Is my agent re-reading its own tool output?"
- **M** Share of newly appended input characters that are tool results vs user
  messages: `current_tool_result_chars / current_input_chars`.
- **F** `current_tool_result_chars`, `current_user_message_chars`,
  `current_input_chars`, `current_input_event_count`.
- **S** TL 100% (these are TraceLab-specific; currently `unmapped` in
  `tracelab-v1.json`, kept in the raw payload). SC: derivable from `content`
  lengths per role [documented, unvalidated]. TC unknown.
- **C** **Characters are not tokens.** On Claude rows `newly_append_tokens`
  exceeds `current_input_chars` in **57.4%** of rounds, aggregate ratio 1.50
  tokens per char **[fixture]** — impossible for real text, so the char counters
  cover a *narrower* scope than the token counters (system prompt, tool schemas
  and reasoning are counted in tokens but not in these chars). Never present
  chars as a token estimate; present them as "composition of the new input" only.
- **V** 100% stacked bar, two bars (Claude / Codex), segments tool-result / user /
  other.
- **D** bar segment → rounds sorted by `current_tool_result_chars`.
- **P** `R`. Superb explanatory content, poor daily metric.
- **Fixture evidence**: aggregate new-input characters are **96.9% tool results /
  3.1% user messages on Claude**, **84.1% / 15.9% on Codex** **[fixture]**. This,
  with the 90.2% `first_input_event_type == tool_result` figure, is the strongest
  single narrative the data supports.

---

### C. Time and latency

**C1 — Observed span is not active time. Say it once, loudly, then never lie again.**
- **Q** "How long did this session take?"
- **M** `observed_end_at − observed_start_at` (already in the reducer as
  `observed_start_at`/`observed_end_at`), reported *beside* a union-of-activity
  figure.
- **F** all `timing_events[].timestamp`, `tools[].emitted_at`, `tools[].result_at`.
- **S** TL 100%. SC has a *declared* `duration_seconds` at session level
  [documented, unvalidated] — a genuinely different quantity, which is exactly why
  the target schema keeps `started_at` (declared) apart from observed bounds.
  TC unknown.
- **C** Comparing TraceLab observed span to SWE-chat declared duration is a
  category error. When both exist, show both, labelled, never a blended average.
- **V** For a session: a horizontal timeline with tool intervals drawn as bars and
  idle gaps left blank. Nothing communicates "this is wall clock with holes in it"
  faster than visible holes.
- **D** bar → tool call → raw record.
- **P** `S`, plus one dashboard KPI phrased as **"observed span"** with a tooltip.
- **Fixture evidence**: total observed span 456.2 h, of which the union of tool
  intervals is 21.1 h. Per provider: Claude tool intervals cover **47.8%** of
  observed span; Codex **1.4%** **[fixture]**. Codex session spans reach
  **363.7 h** (15 days) — clearly a resumed/idle session, not 15 days of work.
  **19 of 79 multi-timestamp sessions have a single gap larger than half their
  span**, max gap 116.8 h **[fixture]**. If AgentScope ever prints "average
  session duration" without this framing it is producing fiction.

**C2 — Where the wall-clock time goes, by tool.**
- **Q** "What is my agent waiting on?"
- **M** `Σ wall_latency_ms` by tool, and its share of total tool time; plus
  p50/p90/p99 per tool.
- **F** `tools[].tool_wall_latency_ms`, `tool_name`, `provider`.
- **S** TL: `tool_wall_latency_ms` present on **5,718/5,723 = 99.9%**
  **[fixture]**. SC: **no latency fields at all** — this whole theme is
  TraceLab-only until Trace Commons is inspected. TC unknown.
- **C** Sum-of-latency and count-of-calls rank tools completely differently; show
  both or you will optimise the wrong tool. Wall latency for an agent-spawning
  tool (`Agent`) contains an entire nested session — do not average it with
  `Read`.
- **V** Two paired horizontal bars per tool: calls (n) and total hours; sorted by
  hours. Latency distribution as a separate strip/box panel on demand.
- **D** bar → tool calls sorted by latency → session → raw record.
- **P** `D+` (the planned "tool counts" chart gets a "by time" toggle — one
  control, big payoff).
- **Fixture evidence** — total tool wall time 21.1 h **[fixture]**:

  | tool | provider | calls | median | p90 | p99 | total h | share |
  |---|---|---:|---:|---:|---:|---:|---:|
  | Bash | claude | 781 | 204 ms | 70.7 s | 600.2 s | 6.02 | 28.5% |
  | Agent | claude | 16 | 202.3 s | 2,793.8 s | 8,812.7 s | 5.15 | 24.4% |
  | write_stdin | codex | 826 | 5.01 s | 60.0 s | 120.0 s | 4.42 | 20.9% |
  | Write | claude | 35 | 47 ms | 3.5 s | 4,796.7 s | 2.04 | 9.7% |
  | exec_command | codex | 2,080 | 313 ms | 1.20 s | 22.8 s | 0.82 | 3.9% |
  | shell_command | codex | 525 | 751 ms | 2.45 s | 18.8 s | 0.53 | 2.5% |
  | Read | claude | 475 | 26 ms | 281 ms | 1.98 s | 0.35 | 1.7% |
  | apply_patch | codex | 343 | 57 ms | 1.94 s | 29.5 s | 0.35 | 1.7% |

  Read it: **`exec_command` is 36% of all tool calls and 3.9% of tool time;
  `Agent` is 0.3% of calls and 24.4% of time.** A count chart and a time chart
  tell opposite stories, which is precisely why v0.1.0 should ship the toggle.

**C3 — Timeout signatures.**
- **Q** "Are these long calls doing work or hitting a wall?"
- **M** Latency histogram per tool, looking for spikes at round numbers.
- **F** `tool_wall_latency_ms`, `tool_name`.
- **S** TL only.
- **C** A cluster at a round value is *evidence of a configured limit*, not proof;
  the trace has no timeout field. Word it "clustered near 30 s".
- **V** Histogram with a log-ish x-axis, per tool, on demand only.
- **D** bin → those calls.
- **P** `D+` inside the tool drill-down.
- **Fixture evidence**: `write_stdin` has **112 of 826 calls between 29 and 31 s**
  and **10 at ≥119 s** (max 125.0 s), with p50 5.0 s and p75 30.0 s **[fixture]** —
  a textbook 30 s poll with a 120 s cap. Claude `Bash` shows **9 calls ≥600 s**
  and 2 at ~120 s **[fixture]**. This is the kind of finding that changes an
  agent's configuration the same afternoon.

**C4 — Model think time.**
- **Q** "How much of a round is the model thinking versus tools running?"
- **M** Round span from `timing_events`; time from round start to first
  `tool_call` event as a think-time proxy.
- **F** `timing_events[].timestamp`, `event_type`.
- **S** TL 100%. SC: turn timestamps exist but no intra-turn events
  [documented, unvalidated]. TC unknown.
- **C** The events are **not chronological** (see G2) so this must be computed
  from min/max, and the "first tool call" proxy silently ignores reordering. State
  it as a proxy in the definition page.
- **V** ECDF of round span, one line per provider.
- **D** → rounds above a chosen threshold.
- **P** `R` / `S`.
- **Fixture evidence**: round span p50 **5.7 s**, p90 23.8 s, p99 111.3 s, max
  6,071 s. Time to first tool call: Claude p50 4.9 s / p90 21.4 s; Codex p50
  5.3 s / p90 19.6 s **[fixture]** — strikingly similar across providers.

**C5 — Activity by day.**
- **Q** "When was work happening?"
- **M** Sessions, rounds, tokens per calendar day.
- **F** derived timestamps.
- **S** all three (all carry timestamps).
- **C** Timestamps are UTC; a "day" is a UTC day, and for a 20-user multi-timezone
  dataset that is the only defensible choice. Say so on the axis.
- **V** The already-planned bar/area by day.
- **D** day → sessions started that day.
- **P** `D` (already planned; keep).
- **Fixture evidence**: 55 distinct session-start days spanning 2025-09-24 →
  2026-06-04, max 8 sessions on 2026-05-29 **[fixture]**. Note the sample is a
  hash-stratified draw, so its daily shape is an artefact — say "in the imported
  data", never "activity".

---

### D. Tool usage and behaviour

**D1 — Tool mix.**
- **Q** "What does my agent actually do?"
- **M** Count of tool observations by name, by provider.
- **F** `tools[].tool_name`, `provider`.
- **S** TL 100%. SC has `tool_name` [documented, unvalidated]. TC unknown.
- **C** **Tool names are not stable across agent versions** — see H2. A single
  "tool counts" bar over a 9-month range silently merges three generations of the
  same shell tool. Default the chart to the *selected date range* and warn when
  the range spans a vocabulary change.
- **V** Horizontal bar sorted descending, grouped by provider, top 10 + "other".
- **D** bar → tool calls → session → raw record.
- **P** `D` (already planned; add the provider grouping).
- **Fixture evidence**: `exec_command` 2,080, `write_stdin` 826, `Bash` 781,
  `shell_command` 525, `Read` 475, `apply_patch` 343, `Edit` 226 **[fixture]**.

**D2 — Tool failure rate, with an honest denominator.**
- **Q** "Which tools fail, and how often?"
- **M** `errors ÷ observations where is_error is not null`, per tool, with the
  coverage percentage shown next to it.
- **F** `tools[].is_error`, `tool_name`.
- **S** TL: `is_error` known on **84.5%** of tool observations **[fixture]**.
  SC: **no error field documented** — the failure theme is TraceLab-only. TC unknown.
- **C** The unknowns are **not random**: 484 of 826 `write_stdin` (58.6%) and 355
  `exec_command` observations have `is_error` null **[fixture]**, so a
  whole-dataset error rate that treats null as false understates Codex
  specifically. Every error-rate figure must carry its known-denominator coverage
  in the same visual element, not in a tooltip.
- **V** Dot plot: x = error rate, y = tool, dot area = n, and a small coverage bar
  beneath each row. Suppress rows with known-n < 30 into an "insufficient data"
  group rather than drawing a 33% error rate from 3 calls.
- **D** dot → failing tool calls → session → raw record.
- **P** `D+` — a single "tool error rate 6.1% (84% coverage)" KPI on the
  dashboard, expanding to the per-tool plot.
- **Fixture evidence** (rate on known denominator, coverage in brackets):

  | tool | provider | n | known | rate |
  |---|---|---:|---:|---:|
  | write_stdin | codex | 826 | 342 (41.4%) | **11.11%** |
  | shell_command | codex | 525 | 523 (99.6%) | **10.33%** |
  | exec_command | codex | 2,080 | 1,725 (82.9%) | 6.20% |
  | Edit | claude | 226 | 226 (100%) | 5.75% |
  | Bash | claude | 781 | 780 (99.9%) | 5.26% |
  | apply_patch | codex | 343 | 332 (96.8%) | 4.82% |
  | Read | claude | 475 | 475 (100%) | 2.32% |
  | shell | codex | 122 | 119 (97.5%) | 1.68% |
  | Grep / TaskCreate / TaskUpdate / TodoWrite | claude | 158 | 157 | 0.00% |

  Overall **296 / 4,834 known = 6.12%**; Claude 4.41%, Codex 7.14% **[fixture]**.
  Editing and shelling out fail; reading and searching do not. That is a
  believable, actionable ranking.

**D3 — Retry behaviour after failure.**
- **Q** "When a tool fails, what does the agent do next?"
- **M** Share of errors immediately followed by another call to the *same* tool,
  in session order; and the length of consecutive same-tool error runs.
- **F** `tools[]` ordered by `(round_index, tool_index)`, `is_error`, `tool_name`.
- **S** TL only (needs ordered tool sequences plus an error flag; SC has no error
  flag). TC unknown.
- **C** "Immediately followed" is defined over the *recorded* sequence; a missing
  tool result (18 of them) breaks the chain. Also `is_error` unknowns silently
  shorten runs.
- **V** In session detail: the round table with error rows tinted and retry runs
  bracketed. On the dashboard: a single number.
- **D** run → the tool calls in it.
- **P** `S`, with the headline number in `R`.
- **Fixture evidence**: **196 of 288 errors (68.1%) are immediately followed by
  another call to the same tool** **[fixture]**. That is the agent's loop-recovery
  behaviour made visible, and it is one query.

**D4 — Result size and the feedback loop.**
- **Q** "Which tools flood the context?"
- **M** `result_chars` distribution per tool; `Σ result_chars` per session.
- **F** `tools[].result_chars` (currently `unmapped` — worth mapping, or at least
  surfacing from the raw payload), `tool_name`.
- **S** TL 100%. SC: derivable from `content` [documented, unvalidated]. TC unknown.
- **C** Chars, not tokens (see B5). And `input_chars` is the size of an input that
  the public release *removed*, so it can be shown but never quoted.
- **V** Box plot per tool on demand.
- **D** → the largest results.
- **P** `D+` inside tool drill-down.
- **Fixture evidence**: `result_chars` p50 **576**, p90 8,464, p99 39,885, max
  194,688; aggregate 17.9 M characters of tool output fed back into models
  **[fixture]**.

**D5 — Tools per round / rounds without tools.**
- **Q** "Is the agent batching tool calls or serialising them?"
- **M** Distribution of `len(tools)` per round; share of rounds with zero tools.
- **F** `tools[]`.
- **S** TL 100%. SC unknown granularity. TC unknown.
- **C** A zero-tool round is a *text* round (answer, plan, or a stop), not an
  error. Do not colour it as a failure.
- **V** Small histogram; or just two numbers in the session header.
- **D** → those rounds.
- **P** `S`.
- **Fixture evidence**: tools per round p50 **1**, p90 2, max 9; **9.2% of rounds
  have no tool call** (Claude 7.4%, Codex 10.1%) **[fixture]**. Agents here are
  overwhelmingly serial: one tool, one round, one round trip. That is a latency
  story as much as a token story.

---

### E. Session shape and outcomes

**E1 — Session shape distribution.**
- **Q** "What does a typical session look like here?"
- **M** Rounds per session; tool calls per session; span; peak context. Report as
  distributions.
- **F** derived.
- **S** TL 100%. SC session table [documented, unvalidated]. TC unknown.
- **C** The distribution is extremely heavy-tailed; means are meaningless. Use
  median + IQR + max, always.
- **V** ECDF or a log-x histogram of rounds per session, one line per provider.
- **D** → session list at that bucket.
- **P** `D+`.
- **Fixture evidence**: rounds per session — all: min 1, p25 5, **median 19**, p75
  70, p90 140, max 717; Claude median 12, Codex median 26 **[fixture]**. Buckets:
  1 round × 8, 2–5 × 15, 6–20 × 18, 21–100 × 25, 100+ × 14 **[fixture]**. Mean
  (59.6) is nearly 3× the median — exactly the trap.

**E2 — Single-round sessions.**
- **Q** "What are all these one-round sessions?"
- **M** Count and composition of sessions with exactly one round.
- **S** TL 100%.
- **C** Could be one-shot queries, could be truncated captures. The data cannot
  distinguish them — say so.
- **V** A line in the session list filter, not a chart.
- **P** `D+` filter.
- **Fixture evidence**: **8 of 80 sessions have exactly one round, and all 8 have
  zero tool calls** (7 Claude, 1 Codex) **[fixture]**. Several of them also have
  near-zero output (see G5) — 168,891 input tokens producing 3 output tokens.
  These look like compaction/summarisation calls or aborted starts, not work.
  Excluding them changes the median session size materially, which is why the
  session list needs this filter and the KPI needs a documented population.

**E3 — Task success.**
- **Q** "Did the agent succeed?"
- **M** **None. There is no ground truth in any of the three sources.**
- **C** No test outcome, no diff acceptance, no human rating, no session status
  field. `is_error` is a *tool* flag, not a task outcome. TraceLab even drops tool
  `input`, so we cannot reconstruct intent.
- **V** Nothing. The correct product behaviour is an explicit absence: a
  "Task outcome — not available in this data" line on the definitions page, so
  users stop looking for it.
- **P** `R` (as a documented absence). Later: allow users to attach their own
  outcome labels to sessions; that is a labelling feature, not an analytics one,
  and it should never be inferred.

**E4 — Session end reason (proxy only).**
- **Q** "How did this session end — finished, or fell over?"
- **M** Proxies: last round has no tools (text ending) vs last tool call has no
  result (truncation) vs last tool is an error.
- **F** ordered `tools[]`, `timing_events[]`.
- **S** TL only.
- **C** All three are proxies. Present as "last recorded activity", never
  "outcome". The 18 tool calls without results are the strongest signal available.
- **V** A single labelled chip in the session header.
- **P** `S`.

**E5 — Users and projects.**
- **Q** "Who and what is this workload?"
- **M** Sessions/tokens per user, per project.
- **F** `user`, `project`.
- **S** TL: `user` 100%, `project` **Claude rows only — absent on all 3,187 Codex
  rows** **[fixture]**. SC has `user_id`, `repo_id` [documented, unvalidated].
  TC unknown.
- **C** Any "by project" chart covers 33% of rows in this fixture. The chart must
  state its own coverage ("1,583 of 4,770 rounds have a project"), and the
  remaining rows must appear as an explicit "Unknown project" category — never be
  dropped, which would silently rescale every share.
- **V** Table, not chart. Sorted by tokens.
- **D** row → sessions.
- **P** `R`.
- **Fixture evidence**: 20 users, 23 Claude projects; **no project has more than
  one user and most users have exactly one project** **[fixture]** — so
  "project" here is closer to a per-user workspace than a shared repo. Do not
  present it as a team dimension.

---

### F. Reasoning

**F1 — Reasoning token share.**
- **Q** "How much of the output is thinking I never see?"
- **M** `reasoning_tokens ÷ output_tokens` by model.
- **F** `reasoning_output_tokens`, `output_tokens`, `model`.
- **S** TL: **Codex only.** `reasoning_output_tokens` is null on **all 1,583
  Claude rows** and non-null on all 3,187 Codex rows **[fixture]**. SC: not
  documented. TC unknown.
- **C** This is the sharpest "Unavailable ≠ 0" case in the dataset. Claude rows
  *do* carry 452 `reasoning` timing events with 4,754 thinking characters
  **[fixture]** — the model demonstrably reasoned; the token count simply is not
  recorded. If the UI renders Claude reasoning as 0% it states something the data
  contradicts. Render "Unavailable — provider does not record it".
- **V** Bar per model, with Claude models present but greyed and labelled.
- **D** bar → rounds → raw record.
- **P** `D+` / `R`.
- **Fixture evidence**: Codex reasoning is **46.2% of all Codex output tokens**
  (711,948 / 1,542,659). By model: `gpt-5.2-codex` 63.1%, `gpt-5-codex` 61.4%,
  `gpt-5.4-mini` 53.1%, `gpt-5.3-codex` 43.7%, `gpt-5.4` 38.0%, `gpt-5.5` 34.4%
  **[fixture]**. **32.4% of Codex rounds have exactly zero reasoning tokens**, and
  39 of 40 Codex sessions contain at least one reasoning round **[fixture]**.
  The declining share across newer models is a real, visible trend — and exactly
  the kind of thing that is invisible without a normalised store.

**F2 — Reasoning vs outcome.**
- **Q** "Does more thinking mean fewer tool errors?"
- **M** Correlation of per-round reasoning share with next-round tool error.
- **C** Tempting and unsound: no outcome measure (E3), heavy confounding by model
  and task, and only one provider reports reasoning. **Do not ship it.** If it
  ever appears it belongs in a research report with confidence intervals, not on
  a dashboard.
- **P** never (v0.1.0).

---

### G. Data quality of the trace itself

This theme is where AgentScope differentiates. Everything here is cheap (it is
computed during import anyway) and it is what makes the rest believable.

**G1 — Field coverage matrix.**
- **Q** "What did this import actually contain?"
- **M** Per target field: `known / total` after mapping, split by source and
  provider.
- **F** all.
- **S** all three, by construction.
- **C** none — this *is* the caveat surface.
- **V** A compact matrix: rows = target fields, columns = provider/source, cell =
  coverage percentage with a subtle fill. One glance answers "can I trust that
  chart".
- **D** cell → the records missing that field.
- **P** `Q` — a persistent one-line quality strip on the dashboard ("3 fields
  below 90% coverage") that expands to the matrix. This is the single most
  important progressive-disclosure element in the product.
- **Fixture evidence** — coverage after applying `tracelab-v1.json`:
  `input_tokens`, `output_tokens`, `tool_name`, `wall_latency_ms` ≈100%;
  `cache_read_tokens` / `cache_creation_tokens` **33.2%** (Claude rows only);
  `reasoning_tokens` **66.8%** (Codex rows only); `internal_latency_ms` **59.6%**;
  `is_error` **84.5%**; `repo` **33.2%**; **`exit_code` 0%**; **`status` 0%**;
  session `started_at`/`ended_at` (declared) **0%** **[fixture]**.

**G2 — Non-chronological event streams.**
- **Q** "Can I trust the ordering inside a round?"
- **M** Share of rounds whose `timing_events[]` timestamps are not
  non-decreasing.
- **F** `timing_events[].timestamp`.
- **S** TL (measured). Others unknown.
- **C** The mapping already handles this correctly by taking `min`/`max` for the
  call bounds. But any future "event timeline" view must sort, and must say it
  sorted.
- **V** A badge in the quality strip and a per-session flag.
- **P** `Q` / `S`.
- **Fixture evidence**: **212 of 4,770 rounds (4.4%)** have out-of-order events —
  Codex **6.5%**, Claude **0.4%** **[fixture]**. Provider-specific, so it is a
  property of the exporter, not of the file.

**G3 — Native identity collisions.**
- **Q** "Are the source's IDs safe to join on?"
- **M** Multiplicity of `round_id`, `trace_key`, `tool_call_id`,
  `(session_id, round_index)`.
- **S** TL (measured).
- **C** **Important and awkward**: upstream documents ~8,900 duplicate `round_id`
  and 514 duplicate `trace_key` across the full 357,161-row release, but **in this
  80-session fixture every one of those is unique — 4,770/4,770 distinct
  `round_id`, 4,770 distinct `trace_key`, 5,723 distinct `tool_call_id`, and no
  duplicate `(session_id, round_index)`** **[fixture]**. So the fixture *cannot*
  exercise the collision path. ADR-002's occurrence-identity design is still
  right; but the duplicate-detection code needs a hand-built fixture, and the
  release notes should not claim the collision handling was verified on real data
  when it was verified on synthetic data.
- **V** In the import report: "claimed identifiers: 4,770 distinct of 4,770;
  0 suspected duplicates".
- **P** `Q` / import report.

**G4 — Missing tool results and dangling calls.**
- **Q** "Did every tool call come back?"
- **M** `tool_call` events minus `tool_result` events; `result_at` nulls.
- **S** TL.
- **V** A count in the import report and a marker in the session timeline.
- **P** `Q` / `S`.
- **Fixture evidence**: 5,723 `tool_call` vs **5,705** `tool_result` events; 5
  tools with null `result_at` and null `wall_latency_ms` **[fixture]**.

**G5 — Implausible measures.**
- **Q** "Are any of these numbers nonsense?"
- **M** Rule-based flags: output tokens ≈ 0 with large input; wall latency
  negative or wildly inconsistent with `result_at − emitted_at`; reuse ratio > 1.
- **S** TL (measured).
- **C** A flag is a prompt to look, not a rejection. These records must still
  import — rejecting them would bias every aggregate.
- **V** A count in the quality strip; the flagged rows in a table.
- **P** `Q`, expand to `R`.
- **Fixture evidence**: `wall_latency_ms` reconciles to `result_at − emitted_at`
  **exactly** on all 5,718 measurable tools (p50, p99 and max difference all
  0.0 ms; zero negative latencies; zero results before their call) **[fixture]** —
  latency is internally consistent and safe to trust. But **11 sessions have
  output ÷ input < 0.0005**, including a single-round session with **168,891
  input tokens and 3 output tokens**, and **83 rounds produce fewer than 10 output
  tokens** **[fixture]**. Those are almost certainly compaction/classification
  calls; the point is that a "tokens by model" chart quietly includes 168 k of
  input that produced nothing a human read.

**G6 — Duplicate-source risk (`.claude.back`).**
- **Q** "Am I importing the same session twice from a backup directory?"
- **M** Overlap of session IDs across `store` values.
- **S** TL: `store` is `unmapped` (deliberately — provenance is per file).
- **C** In this fixture there is **no overlap**: `.claude` 30 sessions,
  `.claude.back` 10, `.codex` 40, intersection **0** **[fixture]**. But a store
  literally named `.claude.back` is a standing warning that real imports will
  contain backup copies. The occurrence-identity guarantee covers exact-file
  re-import, not the same session exported twice from two directories — which is
  exactly the case ADR-002 defers.
- **V** Import report line: "sessions appearing in more than one source file: 0".
- **P** import report.

---

### H. Comparison across agents, models and time

**H1 — Provider comparison, done honestly.**
- **Q** "Is Codex cheaper/faster/more reliable than Claude Code here?"
- **M** Side-by-side of the metrics that *are* comparable: reuse ratio, rounds per
  session, tools per round, error rate on known denominators, round span, tool
  latency by tool class.
- **C** Not comparable: absolute token totals (different semantics), cache fields
  (Claude only), reasoning (Codex only), `project` (Claude only), internal latency
  (Codex only), tool names (different vocabularies). The comparison view must be a
  *curated allow-list* of metrics, not a generic group-by — otherwise the UI will
  cheerfully render "Codex used 2× the tokens" from a 40/40 hash-stratified sample.
- **V** A two-column comparison card, each row carrying its own coverage and a
  "comparable / not comparable" marker.
- **D** row → the underlying sessions on each side.
- **P** `D+`.
- **Fixture evidence**, comparable rows: median rounds 12 vs 26; rounds with no
  tools 7.4% vs 10.1%; error rate 4.41% (99.8% coverage) vs 7.14% (77.5%
  coverage); reuse ratio p50 92.1% vs 91.4%; time-to-first-tool p50 4.9 s vs
  5.3 s **[fixture]**.

**H2 — Tool-vocabulary drift.**
- **Q** "Why did `shell_command` disappear in February?"
- **M** Tool-name counts by month, per provider.
- **S** TL (measured).
- **C** This invalidates naive long-range tool charts. It is also a genuinely
  useful finding for anyone maintaining agent configs.
- **V** A stacked area of tool-name share by month, with the changeover months
  annotated. Or, minimally, a warning banner on the tool chart when the selected
  range crosses a changeover.
- **D** month → sessions.
- **P** `D+` / `R`.
- **Fixture evidence** — the Codex shell tool is renamed twice, perfectly tracking
  the model generation **[fixture]**:

  | tool | months present | models |
  |---|---|---|
  | `shell` | 2025-09 (112), 2025-10 (10) | `gpt-5-codex` only |
  | `shell_command` | 2026-01 (445), 2026-02 (80) | `gpt-5.2-codex` only |
  | `exec_command` | 2026-03 (454) → 2026-05 (587) | `gpt-5.3-codex`, `gpt-5.4`, `gpt-5.5` |
  | `write_stdin` | 2026-03 onwards | `gpt-5.4`, `gpt-5.5`, `gpt-5.3-codex` |

  On the Claude side the same thing happens with new tools appearing:
  `TaskCreate`/`TaskUpdate`/`TodoWrite`/`Skill` appear **only in 2026-05**
  **[fixture]**. Note also that `shell` reports wall latency of 0 ms (84 calls) or
  1 ms (38 calls) **[fixture]** — that generation simply did not instrument
  latency, so its 0 ms is another "unavailable dressed as a number". A latency
  chart must exclude it or flag it.

**H3 — Model drift over time.**
- **Q** "Which models am I actually running, and since when?"
- **M** Rounds/tokens by model by month.
- **S** all three (model label + timestamp).
- **C** Model labels are free text from the source; `claude-opus-4-7` and
  `claude-opus-4-5-20251101` are the same family at different pinning granularity.
  Do **not** normalise them automatically — show the raw label, and offer optional
  user-defined grouping later.
- **V** Stacked area by month, one band per model.
- **D** band → sessions.
- **P** `D+`.
- **Fixture evidence**: 14 distinct labels; a clean generational march
  `gpt-5-codex` (2025-09/10) → `gpt-5.2-codex` (2026-01/02) → `gpt-5.3/5.4`
  (2026-03/04) → `gpt-5.5` (2026-05), and `claude-opus-4-6` (2026-03) →
  `claude-opus-4-7` (2026-05) → `claude-opus-4-8` (2026-06) **[fixture]**.
  **79 of 80 sessions use exactly one model**; the single exception mixes
  `gpt-5.4` and `gpt-5.4-mini` across 73 rounds **[fixture]** — a router or a
  deliberate downgrade, and precisely the sort of anomaly a session-detail model
  chip makes visible for free.

**H4 — Cross-source comparison (TraceLab vs SWE-chat vs Trace Commons).**
- **Q** "Can I put two datasets on one chart?"
- **M** Only these: session/round/tool counts, timestamps, tool names, and any
  metric whose `token_semantics` tags match.
- **C** SWE-chat's granularity is explicitly unvalidated ("a conversation entry is
  not necessarily a model invocation"); until `api_call_count` reconciliation is
  done, **no SWE-chat token metric may share an axis with a TraceLab one**. The
  metric layer should enforce this mechanically: a chart with mixed
  `token_semantics` in its slice returns a refusal ("not comparable: 2 token
  semantics in selection") rather than a number. That refusal is a feature.
- **V** Separate small multiples per source; never a merged series.
- **P** `R`, and a hard rule in the metric layer.

---

## 4. Prioritised shortlist

The plan already commits to 4 KPIs and 3 charts (activity by day, tokens by model,
tool counts). I would keep all three charts and change what they carry, then add
exactly three things. Everything here is SQL over the committed schema plus one
React panel; none of it needs a new table.

### v0.1.0 — ship these

| # | Insight | Why it earns the day-2 slot | Cost |
|---|---|---|---|
| **1** | **Context reuse ratio** (B1) as KPI, and A1's tokens-by-model chart **stacked into reused prefix / new input** | The single largest cost lever; 100% coverage on both providers; turns an existing planned chart into an insight at near-zero extra cost | ~2 h |
| **2** | **Tool error rate on a known denominator** (D2) as KPI + per-tool dot plot | The most actionable operational number; forces the coverage discipline into the UI on day 2 rather than day 4 | ~3 h |
| **3** | **"By time" toggle on the planned tool-counts chart** (C2) | One control; reveals that `Agent` is 24% of tool time on 0.3% of calls. Highest insight-per-line-of-code in the list | ~2 h |
| **4** | **Quality strip** (G1–G5): coverage matrix, non-chronological count, dangling tool calls, implausible-measure count | This is the product's differentiator and it makes every other number defensible. Also nearly free — the import already computes it | ~4 h |
| **5** | **Session detail timeline** (C1): tool bars with visible idle gaps, error tinting, model chip, reuse sparkline | Makes "observed span ≠ active time" self-evident instead of a caveat, and is the drill-down target for everything above | ~4 h |

KPI set I would ship (four, as planned):
1. Sessions imported *(with the population stated: "80 sessions, 4,770 recorded
   model-call observations")*.
2. **Context reuse ratio** — "95.9% of input tokens were reused prefix".
3. **Tool error rate** — "6.1% of 4,834 tool calls with a known outcome (84% coverage)".
4. **Observed span** — "456 h observed across 80 sessions; activity is not
   continuous" with the tooltip.

Note what I dropped from a conventional dashboard: total tokens as a headline
number (it is not comparable across semantics and it is not actionable), average
session duration (fiction, per C1), and any success/quality metric (no ground
truth).

### Later (in rough order)

1. Cache warm-up + collapse (B2, B3) — Claude-only, needs the empty-panel pattern.
2. Concentration / top-sessions table (A2) — one query, high value, but the KPI
   line covers 80% of it.
3. Context growth curve (B4) — needs a considered x-axis treatment for the tail.
4. Timeout-signature histograms (C3) — high delight, narrow audience.
5. Retry-after-failure (D3).
6. Tool-vocabulary drift banner (H2) — becomes urgent as soon as anyone imports a
   multi-month archive.
7. Provider comparison card (H1) — only after the metric layer can *refuse* an
   incomparable slice.
8. Model drift stacked area (H3).
9. New-input composition (B5) — a report-page essay, not a dashboard tile.
10. Cost in currency (A5) — only with a user-owned, versioned price table
    including cache-read rates, and priced-coverage shown beside the figure.
11. User-attached outcome labels (the honest replacement for E3).

Explicitly **not** on either list: anomaly detection, forecasting, "efficiency
scores", any single composite index, reasoning-vs-quality correlation (F2), and
per-file/per-repo analytics (TraceLab dropped tool `input`, so it cannot be done
here at all).

---

## 5. Honest limits

**L1. No task success, anywhere.** No test results, no diff acceptance, no
ratings, no session status. `is_error` is a tool-level flag. AgentScope must not
infer success from error rate, session length, or anything else.
*UI*: a permanent line on the definitions page — "Task outcome: not available in
any imported source." Not a blank chart; a stated absence.

**L2. No prices.** No source carries them; the plan cuts cost estimation from
v0.1.0. With 95.9% of input being reused prefix, any currency figure is dominated
by an unknown cache-read discount.
*UI*: token metrics are labelled "tokens as counted by the source". No currency
symbol appears anywhere in v0.1.0.

**L3. Observed span is not active time.** 456 h of observed span contains 21 h of
tool activity; a single Codex session spans 15 days; 19 of 79 sessions have one
gap exceeding half their span **[fixture]**.
*UI*: the field is called "observed span" everywhere, the session timeline draws
the gaps, and no "average duration" statistic is offered.

**L4. Event streams are not chronological.** 4.4% of rounds overall, 6.5% of Codex
rounds **[fixture]**.
*UI*: call bounds are min/max (already correct in the mapping); any event list is
sorted, with a "sorted by timestamp; source order differs for N rounds" note.

**L5. Native IDs are not trustworthy in general, and the fixture cannot prove it
either way.** Upstream documents ~8,900 duplicate `round_id`; the fixture has
none **[fixture]**.
*UI*: counts are labelled "recorded model-call observations", the import report
shows distinct-vs-total claimed identifiers, and the release notes say the
collision path is covered by synthetic fixtures.

**L6. Coverage is provider-shaped, not random.** Cache fields Claude-only,
reasoning Codex-only, `project` Claude-only, `internal_latency` effectively
Codex-only, `is_error` unknown on 22.5% of Codex tools, `exit_code`/`status`
absent entirely **[fixture]**.
*UI*: "Unavailable" (never 0, never blank), every aggregate carries `known/total`,
and a provider that cannot support a chart gets a labelled empty panel rather than
a silent omission.

**L7. Characters are not tokens, and the two counters disagree.**
`newly_append_tokens` exceeds `current_input_chars` on 57.4% of Claude rounds
**[fixture]**.
*UI*: character fields are only ever shown as composition shares, never converted.

**L8. The fixture is a hash-stratified 40+40 draw and is not representative.**
Its daily activity shape, provider balance and model mix are artefacts of
selection.
*UI*: every chart is scoped to "the imported data", and the import report states
the selection provenance from the manifest.

**L9. Two of three sources are unvalidated or uninspected.** SWE-chat granularity
is documented but unproven, and its `conversations.parquet` (1.31 GB, 2.69 M rows)
is far beyond the 25 MiB / 100 k-record product limits, so it needs a bounded
excerpt before it can even be imported. Trace Commons is a deliberate holdout.
*UI*: source selector shows a validation state per source; unvalidated sources
cannot share an axis with validated ones (H4).

**L10. Tool `input` was removed from the TraceLab public release.** No file paths,
no commands, no prompts. So: no per-file analytics, no command-frequency analysis,
no prompt-quality work from this source. SWE-chat *does* carry `command`,
`file_path` and `content` [documented, unvalidated] — which means those insights
are source-specific and must be gated on the source, not offered globally.

---

## 6. Display architecture and progressive disclosure

The owner's rule — *show a thing only if strictly necessary for the task at hand*
— maps onto four surfaces. The discipline is: **each surface answers one
question, and every element on it must survive the question "what would the user
do differently because of this?"**

### 6.1 Dashboard (default view) — at most 4 KPIs, 3 charts, 1 quality strip

Visible without interaction:
- 4 KPIs (§4), each with its population and coverage in the same tile, in smaller
  type. Not a tooltip: coverage that hides on hover is coverage nobody sees.
- Activity by day (bar) — orientation and range.
- Tokens by model (stacked bar: reused prefix / new input) — cost shape.
- Tool counts (horizontal bar) with the calls ↔ time toggle.
- One-line quality strip: *"Coverage: 3 fields below 90%. 212 rounds with
  out-of-order events. 18 tool calls without a result."* — a link, not a panel.

That is the whole default. Everything else in this document is reached by clicking.

### 6.2 On-demand from the dashboard (`D+`)

Opened by clicking a KPI, a chart element, or the quality strip. Each opens a
*panel*, not a page, and each contains exactly one thing:
- KPI 2 → per-tool error dot plot with coverage bars (D2).
- KPI 1 → session-shape ECDF + concentration table (E1, A2).
- Tokens chart → reuse by round-bucket (B1) and, for Claude, the warm-up area (B2).
- Tool chart → latency distributions and timeout histogram for the clicked tool
  (C2, C3), plus result-size box (D4).
- Quality strip → the coverage matrix (G1) and the flagged-record tables (G4, G5).
- Date range crossing a tool-vocabulary changeover → an inline banner (H2).

### 6.3 Session detail (`S`)

One session, one question: *what happened here?*
- Header: agent, model chip (plus a warning chip if >1 model), user, project (or
  "Unknown project"), observed span, rounds, tools, reuse ratio, error count.
- Timeline: tool bars on a time axis with idle gaps visible, errors tinted,
  dangling calls marked, cache-collapse markers on the reuse sparkline.
- Round table (virtualised): index, model, input/output tokens, reuse %, tools,
  errors, span. Collapsed by default to the first 20 rounds — a 717-round session
  must not render 717 rows before the user asks.
- Every row → the raw record viewer.

### 6.4 Raw record viewer

The terminal drill-down and the proof of provenance: the exact decoded JSON, the
file SHA-256, the record locator, the mapping revision that produced each entity,
and the emission path. Reached only from a specific row. This is where trust is
actually earned, and it should be one click from *anything* numeric.

### 6.5 Report / definitions page (`R`)

Prose and tables, read once per user: metric definitions with formulas and
denominators, the comparability rules, the stated absences (L1, L2), the
new-input composition essay (B5), output/input ratios (A3), and the source
validation states. Linked from every metric name, so the dashboard never has to
explain itself inline.

### 6.6 Rules that keep it honest

1. **No number without a denominator.** Rates carry `known/total` in the same
   element.
2. **Unavailable is a rendered state**, visually distinct from zero and from
   empty. A provider that cannot support a panel gets a labelled empty panel.
3. **Incomparable slices refuse to aggregate.** Mixed `token_semantics` in one
   series returns "not comparable (2 token semantics in selection)" with a split
   button, not a sum.
4. **Suppress small n.** Any per-group rate with a known-n below 30 collapses into
   "insufficient data" rather than rendering a 33% error rate from 3 calls.
5. **Medians, not means**, for every session-shaped distribution — with the max
   shown, because the max is where the money is.
6. **One click to a session, two to a source record**, from every chart element.
   If a number cannot be drilled, it does not belong on the dashboard.
7. **The dashboard never grows.** New insights land in panels, session detail, or
   the report. The default view is a fixed budget: 4 + 3 + 1.

---

## 7. Metric definitions (formulas, units, denominators)

| Metric | Formula | Unit | Denominator / coverage | Comparable across |
|---|---|---|---|---|
| Recorded model-call observations | `count(model_call)` | count | n/a | all |
| Context reuse ratio | `Σ prefix_tokens ÷ Σ input_tokens` | ratio | rows with both fields | within provider; label Codex as declared reuse |
| Cache-read share | `Σ cache_read ÷ Σ input_tokens` | ratio | rows with `cache_read` not null | Claude/`tracelab-claude` only |
| Cache-creation share | `Σ cache_creation ÷ Σ input_tokens` | ratio | as above | as above |
| Output-to-input ratio | `Σ output ÷ Σ input` | ratio | rows with both | within `token_semantics` |
| Reasoning share | `Σ reasoning ÷ Σ output` | ratio | rows with `reasoning` not null | within provider |
| Tool error rate | `count(is_error=true) ÷ count(is_error not null)` | ratio | **known outcomes only** | within source |
| Tool wall time | `Σ wall_latency_ms` | ms → h | tools with latency not null | within source; exclude 0 ms instrumented-absent tools |
| Tool latency percentiles | p50/p90/p99 of `wall_latency_ms` | ms | as above | per tool name only |
| Observed session span | `max(all ts) − min(all ts)` | s | sessions with ≥2 timestamps | all, **never called duration** |
| Tool-active time | duration of the union of `[emitted_at, result_at]` | s | tools with both | all |
| Rounds per session | `count(model_call)` per session | count | all sessions | all |
| Tools per round | `count(tool_call)` per model call | count | all rounds | within source (vocabularies differ) |
| Peak context | `max(input_tokens)` per session | tokens | all rounds | within `token_semantics` |
| Coverage | `known ÷ total` per field | ratio | all records in scope | all |

Two rules the metric layer must enforce mechanically, not by convention:
`token_semantics` mixing refuses to aggregate; and every rate exposes its known
denominator to the API so the UI cannot render one without it.

---

## 8. Five things I would cut before adding anything

1. **A "total tokens" headline.** Not comparable across semantics, not
   actionable, and it crowds out the reuse ratio.
2. **Average session duration.** L3 makes it fiction.
3. **Any pie chart.** Tool mix and model mix are both long-tailed; sorted bars
   win on every axis that matters.
4. **A tool-error leaderboard without coverage.** With `is_error` unknown on 58.6%
   of `write_stdin` calls, an uncovered leaderboard is actively misleading.
5. **Cross-source merged series.** Until SWE-chat granularity is validated
   against `api_call_count`, small multiples only.

---

## 9. The one-paragraph version

This data will not tell you whether the agent succeeded, what it cost in money, or
how long anyone actually worked. It will tell you, with unusual precision, that
your agents spend 96% of their input tokens re-reading a context they built
themselves out of their own tool output; that the context roughly quintuples over
the first eighty rounds; that a handful of long sessions carry most of the load;
that roughly one tool call in sixteen fails and the agent usually just tries the
same tool again; that the tools you call most are not the tools you wait on; and
that the trace itself is missing enough fields, in provider-shaped patterns, that
the honest reporting of *what is missing* is as valuable as anything you can
compute from what is there. Build the dashboard around those six facts, put a
coverage strip under them, make every number one click from the raw record, and
leave everything else behind a click.
