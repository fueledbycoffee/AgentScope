# Brainstorm: what useful knowledge can AgentScope extract from agent traces, and how should it be shown?

Owner request (2026-09-07): "What important and useful data can we extract from
data like this and how can we display it." Two independent brainstorms (Claude
Opus 5, Codex gpt-6-astra high) answer this from the same material; the owner
then merges them with their own input.

## Material to ground the answer

- TraceLab v0.0.1 fixture: `fixtures/tracelab/tracelab-sample.jsonl.gz`
  (80 sessions, 4,770 rows, one row per model call "round" with nested
  `timing_events[]` and tool calls; providers claude / codex; fields include
  provider, project, session_id, round_index, round_id, model,
  input_tokens_total, prefix_tokens, newly_append_tokens,
  claude_uncached_input_tokens, claude_cache_creation_input_tokens,
  claude_cache_read_input_tokens, output_tokens, reasoning_output_tokens,
  timing_events (event_type, timestamp, source, content_chars, tool name,
  latency), user, store, trace_key). Scan it: `scripts/scan_tracelab.py`,
  provenance in `docs/datasets/README.md`.
- SWE-chat (ODC-BY, gated; conversations Parquet under `data/raw/swe-chat/`
  if present): conversation turns with roles, contents, tool calls, model,
  usage, repo, created_at.
- Trace Commons: Parquet with session/turn/tool structure (see the datasets
  README).
- What AgentScope already normalises: `backend/src/agentscope_app/domain/schema.py`
  (sessions, model calls, tool calls; token fields with `token_semantics`;
  wall and internal tool latency; declared vs observed intervals; provenance
  to the exact source record). Metric rules: every metric has a definition, a
  unit, a coverage (known / total) and comparability constraints across
  sources and token semantics; unknown is shown as "Unavailable", never 0.

## What the answer must contain

1. A catalogue of insights, each as: the question a user asks; the metric or
   view that answers it; the fields it needs; which of the three sources can
   support it and with what coverage; the comparability caveat (when it is
   misleading to compare across sources, models, or token semantics); the
   best visual form; the drill-down path to sessions and source records.
   Organise by theme (cost and tokens, caching efficiency, time and latency,
   tool usage and behaviour, session shape and outcomes, reasoning, data
   quality of the trace itself, comparisons across agents and models).
2. A prioritised shortlist for v0.1.0 (ships in the 4-day timebox on top of
   the four KPIs and three charts already planned: activity by day, tokens by
   model, tool counts) and a second list for later.
3. Honest limits: what the data cannot support (no ground truth on task
   success, no prices unless configured, non-chronological timing events,
   non-unique ids) and how the UI should say so.
4. Display recommendations: which insights belong on the dashboard, which in
   session detail, which as a report or table, and which should only appear on
   demand (progressive disclosure: show a thing only if strictly necessary).

Write your answer as a markdown document at the path you were given, 600 to
1,500 lines is fine if it is dense; no filler.
