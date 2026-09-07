# AgentScope UI design study: shared brief

Issue #27. Owner request (2026-09-07): before day 2, produce eight enterprise-grade
UI/UX designs (four by Claude, four by Codex gpt-6-astra) from this brief, review
them side by side, pick a winner. The winner shapes #8 to #16.

## The product in one paragraph

AgentScope imports traces of AI coding agents (TraceLab JSONL today; SWE-chat
and Trace Commons Parquet next), normalises them through a declarative mapping
(the DSL, with an LLM assistant that proposes mappings for unknown files), and
shows a dashboard of sessions, model calls, tool calls and tokens with provenance
back to the exact source record. Its promise is **trust**: every number has a
definition and a coverage, every row links to the bytes it came from, nothing is
silently rounded, deduplicated or inferred. It is used by a single analyst or a
small team on a laptop or an internal server, not by a crowd.

## Who uses it and what they need to get done

1. **Analyst importing a known dataset** (daily): drop a file, confirm the
   mapping, see that the import is clean, get to the dashboard. Wants zero
   ceremony when nothing is wrong and precise explanations when something is.
2. **Analyst onboarding an unknown dataset** (weekly): profile a new file, get a
   proposed mapping from the assistant, read the explanations and ambiguities,
   ask questions, edit fields, validate, preview, save, import. Wants to stay in
   control; the model never writes to the database.
3. **Reviewer checking a number** (ad hoc): a KPI looks odd; needs to see its
   definition, its coverage, which sessions contribute, and the raw record behind
   one of them. Wants a path from chart to session to source bytes in three
   clicks with no dead ends.
4. **Operator auditing imports** (ad hoc): what was imported, when, from which
   bytes, with which mapping revision, what was rejected and why, what happened
   when a file was re-imported. Wants an honest ledger.

## Screens that must exist (mock these)

| # | Screen | Must show | Currently (thin slice, see `web/src/pages`) |
|---|--------|-----------|---------------------------------------------|
| 1 | Import | file upload, format sniff result, record count, earlier imports of the same bytes, mapping choice, preview (entities counted, warnings, rejects sample, emissions sample), confirm with file hash + mapping revision, then run | one long page |
| 2 | Import report | status (committed / duplicate / failed / running), source-record outcomes (accepted, partial, duplicate, rejected, ignored), entity counts, warnings, imported files with SHA-256, rejects browser with code filter and raw payload | one page + rejects table |
| 3 | Imports history | list of import attempts with status, source, mapping revision, counts, time | table |
| 4 | Dashboard | four KPIs (sessions, model calls, input tokens, output tokens) each with definition and coverage ("Unavailable" when coverage is 0, never 0); three charts (activity by day, tokens by model, tool counts); filters (source, agent, model, period); quality strip (rejects, missing usage, unknown timestamps, unlinked tools); click on a chart reaches the matching sessions | KPIs + sessions table |
| 5 | Session detail | identity (source, external id, agent, repo, user), declared vs observed interval, token coverage, model-call observations, tool-call observations, diagnostics (conflicting values, reversed intervals), "Source record" opening the exact raw JSON of one observation with file hash and locator | page + drawer |
| 6 | Mapping assistant (day 3) | field profile of an unknown file, redaction notice for what leaves the machine, proposed mapping with per-field explanation and ambiguities, conversation to revise, editable mapping table with inline validation, preview, save as revision, import | does not exist yet |
| 7 | Definitions | every metric's definition, unit, semantics tags, comparability rules | does not exist yet |

## Hard constraints

- React 19 + TypeScript + Vite; vitest; no heavy component framework unless the
  design argues for it and the cost fits the timebox (4 days total for v0.1.0,
  UI work is roughly 1.5 of them). Recharts is the planned chart library.
- Accessible: keyboard complete, visible focus, real headings, tables with
  captions, live regions for progress, drawer as `<dialog>`, contrast AA.
- Exact numbers: tokens and hashes are never rounded or truncated in a way that
  loses information; abbreviations (12.4k) only with the exact value one hover
  or click away.
- Works at 1280 px and at 1920 px; degrades to 900 px; no horizontal page scroll.
- Light and dark theme are both required eventually; design the light theme
  fully and state how dark follows (tokens).
- No external UI kits at runtime in the mockups: a single self-contained HTML
  file per variant, inline CSS and JS, Google Fonts allowed, no other network.

## The principle the owner insists on

**Show a thing only if it is strictly necessary for the task at hand.** Every
element on screen must earn its place; everything else is one deliberate step
away (disclosure, drawer, popover, inspector, secondary route). Empty states,
loading states and errors are designed, not defaulted. Density is welcome when
the content is data; chrome is not.

## Design directions (one per variant, to guarantee spread)

Each team produces one variant per direction. A designer may substitute a
direction only for one that is materially different from the other three and
says why.

1. **Workbench.** One workspace, task-first, keyboard-driven, dense; command
   palette, inspector panel, everything in place. References: Linear, Datadog
   notebooks, Warp.
2. **Ledger.** Provenance-first, document-like, calm; imports and sessions read
   like an auditable journal, every number footnoted to its definition and its
   source bytes. References: Stripe dashboard, Mercury, printed financial
   statements.
3. **Console.** Monitoring-first; KPIs and charts lead, drill-down is the
   primary motion, filters are global and sticky. References: Grafana, Vercel
   analytics, Plausible.
4. **Guided.** Flow-first; import and onboarding are stepped, the assistant is a
   side conversation with the mapping table as the shared artefact, the
   dashboard is the destination. References: Retool, Airtable import, Notion
   database setup.

## Deliverable per variant

Directory `research/design/<team>/<n>-<slug>/` with:

- `README.md`: name; one-sentence concept; who it favours; information
  architecture (routes and what lives where); navigation model; disclosure
  model (what is on screen, what is one step away, and why); visual system
  (type scale, spacing scale, colour tokens for light with dark derivation,
  density); component inventory (what needs building, what React needs);
  screen-by-screen notes for screens 1 to 7 with the empty, loading, error and
  success states; accessibility notes; implementation cost in the timebox (what
  ships in v0.1.0, what is deferred); risks and trade-offs; why this beats the
  other three directions for AgentScope and where it loses.
- `mockup.html`: self-contained, opens from disk, shows screens 1 to 6 at a
  minimum (7 optional) with in-page navigation (hash or tabs), realistic data
  (below), interactive enough to demonstrate the disclosure model (drawers,
  popovers, steps actually open). 1280 px wide layout, responsive down to 900.

## Realistic data to use

- Fixture: `tracelab-sample.jsonl.gz`, 681,057 bytes, SHA-256
  `d044a766e12c7eceae2eb1ed71e42d95cf0aec2f10c8d61a06cecc0381fb9897`,
  4,770 records, format jsonl, source `tracelab`, mapping `tracelab-v1`
  revision 1 (`map_82934058a2f6af1cbfc6`).
- Import result: 80 sessions, 4,770 model calls, 5,723 tool calls, 0 rejects,
  warnings null 11,168 and absent 14,633, input tokens 553,447,877 with
  coverage 4,770 / 4,770 calls, output tokens 1,204,331, cache read tokens
  known for `tracelab-claude` semantics only.
- Agents: `claude-code`, `codex`. Models: `claude-opus-4-6`, `claude-opus-4-7`,
  `gpt-5.5-codex`. Tools: Bash, Read, Edit, Glob, Grep, Agent, WebFetch.
- Session example: external id `claude:781a3b4c-a1a5-9325-16d3-4029ecc3fe43`,
  repo `project_8f998460`, user `user_b87fa13e`, observed
  2026-06-04T02:51:06.901Z to 2026-06-04T02:52:00.698Z, 2 model calls, 3 tool
  calls, 48,187 input tokens, coverage 2 / 2 calls. A source record is the raw
  JSON row (provider, project, session_id, round_index, round_id, model,
  input_tokens_total, prefix_tokens, newly_append_tokens, timing_events[]...).
- Import ids look like `imp_3e21f89dbaef419a8f60`, sessions `ses_c736618a…`,
  model calls `mc_ce3dc337…`, tool calls `tc_1a94c2b1…`.
- A second, unknown file for the assistant screen: `swe-chat-conversations.parquet`,
  1.3 GB upstream, excerpt 2,000 rows, columns `conversation_id`, `turns[]`
  (role, content, tool_calls[]), `model`, `usage.prompt_tokens`,
  `usage.completion_tokens`, `created_at` (epoch seconds), `repo`.
- Rejects example: `line:1042`, rule `model_call`, path `$.usage.input_tokens`,
  code `invalid_type`, message "expected integer, got string '12,431'".

## Evaluation grid (used on the review dashboard)

Each criterion 1 to 5.

1. Fit to the four jobs (import known, onboard unknown, check a number, audit).
2. Disclosure discipline: nothing on screen without a reason; nothing needed is
   more than one step away.
3. Trust surfaces: definitions, coverage, provenance and exactness are visible
   at the right moment.
4. Enterprise polish: consistency, states, accessibility, density, typography.
5. Implementation cost within the timebox with React 19 and Recharts.
6. Distinctiveness: does the variant explore something the others do not.
