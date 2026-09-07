# Ledger

**An auditable journal for agent traces: read the statement, follow a footnote, inspect the evidence.**

Direction 2 · AgentScope design study · 7 September 2026.

Open [mockup.html](./mockup.html) directly from disk. No server, build, installation, external fonts, images, libraries or network requests are needed. The default screen is the import journal. “Review screens & states” in the footer opens all seven screens and their empty, loading, error and success variants. This is review tooling, not proposed product navigation.

## Who it favours

Ledger favours the analyst who imports data regularly and the reviewer who needs to defend a number. A small-team operator can read the sequence of attempts like bank transactions: committed, duplicate and failed each leave a receipt. The unknown-source analyst gets the same document language for a mapping proposal, its annotations and its approval.

The central product object is a statement backed by records. This makes provenance habitual without asking people to read raw JSON during routine work. It is less suited to continuous operations monitoring or a user who wants an IDE-like command surface.

## Information architecture

| Screen | Proposed product route | Prototype hash | Contents |
| --- | --- | --- | --- |
| 1 · Import | `/import` | `#import` | File identity, sniff result, earlier attempts, mapping, sample preview, explicit confirmation |
| 2 · Import report | `/imports/:id` | `#report/committed` | Immutable attempt receipt, source-record outcomes, emitted entities, file and mapping evidence, warnings and rejects |
| 3 · Imports history | `/imports` | `#imports` | Chronological attempts, search and status filtering; each row opens its own status scenario |
| 4 · Dashboard | `/dashboard?source=&agent=&model=&period=` | `#dashboard` | Observation statement, four footnoted KPIs, three charts, scoped sessions and quality notes |
| 5 · Session | `/sessions/:id` | `#session/0` | Identity, declared and observed interval, token coverage, model/tool observations and source record |
| 6 · Mapping assistant | `/mappings/new?upload_id=` | `#mapping` | Local profile, outbound-context review, proposal, field notes, editable draft, correspondence, validation, preview and immutable revision |
| 7 · Definitions | `/definitions` | `#definitions` | Definitions, units, semantics tags, coverage and comparability rules |

The header contains Overview, Import journal and Mappings, plus the primary Import traces action. Definitions is a quiet persistent reference link. Reports and sessions are child documents, reached through their owning records. There is no permanent diagnostic rail, assistant chat panel, global filter shelf or command palette.

In production, represent filter state in URL search parameters and preserve it on session back-navigation. Prototype filters persist in memory while visiting other screens; deep-linked hashes select pages and report/session specimens, but do not serialise filters. A browser refresh resets the prototype.

## Navigation model

- Known dataset: Import traces → file and mapping → preview → confirm exact hash/revision → run → receipt → scoped overview. Numbered sections are document clauses, not a full-screen wizard; earlier decisions remain readable.
- Unknown dataset: Mappings → local profile → review outbound context → request proposal → edit and discuss → validate → preview → save revision → separately confirm import.
- Verify a chart: select a day, model or tool → contributing sessions in the same statement → open a session → Source record. Three deliberate actions from chart to JSON; no intervening confirmation.
- Verify a KPI: numbered footnote → definition, exact value, coverage and semantics → contributing sessions. No hover-only explanation.
- Audit: journal row → receipt → expand warnings or rejects; select a reject to inspect its payload. A duplicate receipt links to the original commit.

Session observation tabs support arrow keys, Home and End. Hash navigation supports browser back/forward. Closing the native dialog returns focus to the opening control. A source drawer may lead to its import receipt; it is a continuation of evidence, not a navigation dead end.

## Disclosure model

| Task | Present by default | One deliberate step away | Why |
| --- | --- | --- | --- |
| Choose an import | Filename, exact size, detected format, record count, mapping revision | Full hash, earlier import IDs, decoded record | The user is checking compatibility before checking byte identity. A duplicate warning is promoted because it changes the decision. |
| Review preview | Sample denominator, accepted/partial/rejected counts, entity counts | Warning policies, reject sample, emission sample | A sample is not a promise about the whole file or duplicate handling. |
| Confirm import | Full SHA-256, exact revision ID, full record count and source | Mapping contract | The binding must be visible at the moment that creates a journal entry. |
| Read receipt | Status, outcomes, entities, full file hash and mapping | Warning detail, rejects browser | Identity is the substance of a receipt, so it earns its space here. |
| Read statement | Exact KPI values, coverage, current scope, three charts, quality summary | Metric definition, semantics partitions, chart data table | Coverage affects whether the number can be trusted; the detailed definition is nearby without repeating paragraphs four times. |
| Inspect session | Source, full identity, repo/user, observed and declared bounds, usage coverage, active observation table | Other observation type, diagnostics, raw record | The session is a ledger of observations. Raw JSON should not compete with it. |
| Edit mapping | Current proposal, unresolved interpretation, editable fields, validation and current preview | Local profile details, field explanation, outbound sample | Ambiguity affects approval and stays visible. Full schema and explanation prose do not need permanent panels. |

Every “one step away” control opens meaningful content. Details are inline for local evidence; a native modal drawer holds lengthy notes and raw records. A compact modal is reserved for prototype review controls. Drawer content replaces itself when following another note; dialogs are never stacked.

The mapping page has three brief margin annotations rather than a permanently open chat sidebar. They establish profile → interpretation → record, and fit the document concept. They collapse into a horizontal group at 1,050 px, and can be removed after onboarding in the product. The conversation stays below the shared draft so the editable artefact retains priority.

## Visual system

### Typography

No network fonts are required. Use the system sans stack for controls and data, Georgia for document titles, and SF Mono / Consolas / Liberation Mono for source paths, locators and hashes. These are reliable on a laptop with no network and require no font-loading layout shift.

| Role | Size / line height | Treatment |
| --- | --- | --- |
| Document title | 40 / 46 px | Georgia, normal weight, −1.4 px tracking; 34 px on narrow screens |
| Receipt title / drawer title | 26–27 / 32 px | Georgia, normal weight |
| KPI | 30 / 36 px | System sans, tabular numerals, −1.1 px tracking; 26 px at 900, 34 px at 1920 |
| Section heading | 17 / 25.5 px | 600 weight |
| Body | 14 / 21 px | 400 weight |
| Table / control / note | 12 / 18–20.4 px | Tabular numbers; exact values right aligned |
| Secondary row detail | 11 / 16.5 px | Muted; never essential data by itself |
| Document eyebrow | 10 / 15 px | Uppercase, 1.5 px tracking; used only for orientation |
| Source evidence | 12 / 22.2 px | Monospace; wraps without clipping |

The serif is a document signal, not a decoration applied to every component. Exact token totals remain sans serif and tabular. No `553M` shorthand appears; hashes wrap at arbitrary characters instead of losing bytes. Compact IDs in lists disclose their complete value in the linked detail; receipt IDs and source identities are fully available.

### Spacing and geometry

Use a 4 px base with 4, 8, 12, 16, 20, 24, 28, 32, 40 and 48 px increments. The header is 76 px high. The page is centred in a 1,280 px maximum container, with 48 px gutters at 1,280 and 28 px gutters at 900. At 1,920, the document remains centred rather than stretching numbers across the screen.

Paper surfaces have a 1 px border, 6 px radius and barely perceptible shadow. Controls use a 4–5 px radius, 36 px minimum default height; small secondary controls remain at least 30 px high. Tables use approximately 56–68 px rows where they carry a primary line and a secondary identifier. Single-line rows can be denser. There are no nested cards around individual metrics: thin vertical rules divide the statement.

At 900 px, controls wrap within the toolbar, charts retain three columns, numeric typography steps down, and mapping margin notes move below the document. The right-hand receipt note is reduced to 230 px. At 760 px, charts and two-column documents stack. Page-level horizontal scrolling is prohibited; exceptionally wide evidence tables may scroll inside their own region. Long hashes and JSON wrap. Scrollable table regions become keyboard focusable and labelled only when overflow actually exists; keep this behaviour in the React wrapper.

### Colour tokens and dark derivation

| CSS token | Light value | Dark value | Role |
| --- | --- | --- | --- |
| `--canvas` | `#f5f4f0` | `#171d19` | Workspace background |
| `--paper` | `#fffefa` | `#202923` | Document and dialog |
| `--ink` | `#252d29` | `#e8ede6` | Primary text |
| `--muted` | `#626b64` | `#acb8ac` | Secondary text |
| `--line` | `#dcdfd6` | `#3d4a40` | Non-interactive separators |
| `--control` | `#858e85` | `#829487` | Interactive control boundary |
| `--soft` | `#eeefe8` | `#2b352e` | Neutral fill |
| `--accent` | `#285744` | `#a2d0ad` | Links, data marks, focus-adjacent emphasis |
| `--accent-soft` | `#eaf1e9` | `#283f30` | Success and selected surfaces |
| `--warn` | `#855218` | `#f0c78e` | Warnings |
| `--warn-soft` | `#fcf2df` | `#3d3020` | Warning surface |
| `--danger` | `#a13930` | `#ffb0a7` | Failure text |
| `--danger-soft` | `#fff0ed` | `#422725` | Failure surface |
| `--focus` | `#245fd1` | `#94b9ff` | 3 px visible keyboard outline |

Dark is a semantic-token substitution, not image inversion. Add `--on-accent: #ffffff` in light and `#16291c` in dark for primary button text. Replace the light prototype’s literal table/chart support fills with `--surface-subtle` (`#f7f7f2` / `#252e28`), gridlines with `--line`, and raw-code fills with `--soft`. Map warning-body text to `--warn` and hover fills to `--soft`. Keep chart order and bar opacity steps; check the lowest-opacity bar against the dark paper and use solid fill if the boundary falls below 3:1. Dark is specified here; the HTML fully implements light only.

Checked light text contrasts are 14.00:1 for body, 5.47:1 for muted text, 8.28:1 for primary buttons, 7.56:1 for warning text and 6.03:1 for error text. Control borders are 3.35:1; the lowest-opacity chart bar is 3.02:1. All primary/secondary text pairs are chosen for AA normal-text contrast. Thin paper dividers are not control boundaries: controls have a separate stronger token. Badges include status words and appropriate symbols, not colour alone. The pale surfaces supply grouping rather than meaning.

### Tables and charts

Tables are the main document structure. Header casing is restrained, horizontal rules separate entries, and vertical borders are omitted. Numeric columns align right. A row’s primary text is the entity the analyst recognises; a quiet second line carries the machine identifier. Explicit links remain keyboard-accessible instead of making the entire row a click target.

The three charts are inline SVG in this mockup: daily observation bars, horizontal input-token bars by model, and tool-count bars. They share one restrained green family, no gradients, no ornamental gridlines, and no smoothed curves that imply unobserved activity. Exact model/tool values appear on the chart; daily values are in the accessible link labels and native titles, with an explicit data-table drawer for all days and tools. Model values also appear in keyboard-accessible link labels. Chart selection filters sessions and recalculates the statement. Tool selection means “sessions containing this tool”; their full session totals remain in scope, rather than silently changing the unit to individual tool occurrences.

## Component inventory and React requirements

| Component | Build / reuse | React implementation |
| --- | --- | --- |
| AppShell, DocumentHeader, SectionHeading | New composition | React Router links and page title/focus management; existing route structure retained |
| Paper, Notice, StatusBadge, Button | Small shared primitives | CSS tokens; typed status unions; no runtime UI kit |
| LedgerTable, CountStrip | Restyle existing `Table`, `Counts` | Real caption, scope headers, numeric alignment, internal overflow; preserve pagination |
| MetricWithFootnote, MetricNote | New | Metric DTO owns definition, unit, coverage and semantics; show `Unavailable` for zero known usage |
| SourceDrawer / NoteDrawer | Extend existing drawer | Native `HTMLDialogElement.showModal`, refs for opener/return focus, Escape handling; render `payload_text` directly |
| Disclosure | Native element | `<details>/<summary>`; controlled opening only when rejects demand attention |
| ImportWorksheet / Receipt | Recompose existing pages | Separate upload/mapping/preview/commit state, invalidate preview on binding changes, disable repeat submissions |
| ScopeToolbar / SessionLedger | Existing queries + new controls | URL-backed source, agent, model, period and drill-down scope; reset pagination on filter changes |
| Three charts + DataTable | New; Recharts in product | Recharts bars with explicit units, scoped click handlers, accessible textual equivalent; SVG prototype has no dependency |
| ObservationTabs | New lightweight primitive | Roving tab index, arrow/Home/End navigation, labelled tab panel |
| MappingDraft / FieldExplanation | New | Typed field rows and error references; immutable revision boundary; dirty state invalidates validation and preview |
| OutboundContextReview / Correspondence | New | Recipient/model and filtered sample reviewed before request; editable message; pending/error/refusal handling |
| ResourceState / ErrorNotice | Extend existing | `role=status` progress, preserved context, actionable error, retry; no fake zero while loading |

React 19 and TypeScript are sufficient. No heavy framework is justified. Reuse the current API adapter, `useResource`, formatting helpers and routing rather than introducing a state/query migration during the design implementation. Adopt planned TanStack Query when it removes measured duplication, not as a prerequisite to applying this visual system. Vitest and the existing testing-library setup can exercise most disclosure and state behaviour; a Playwright smoke test should cover the whole import/evidence path once a permitted browser is available.

## Screen-by-screen design and states

### 1. Import — a numbered worksheet

File compatibility comes first. The known sample starts selected for review, with its precise 681,057-byte size, gzip/JSONL result, 4,770-record count and earlier committed receipt. Replace opens an accessible file chooser/drop zone. The mock accepts the supplied sample by filename; other files receive an explicit prototype limitation instead of a fabricated hash. Oversize and unsupported-format errors are distinct.

Preview is 200 records, with 8 session contributions, 200 model observations and 240 tool observations as an **illustrative** sample. Full fixture totals are not presented as preview results. Warning counts, zero rejects and an emission sample are real expandable sections. Confirmation appears only after preview and exposes the full hash and exact `map_82934058a2f6af1cbfc6` revision binding. A checkbox plus the run button creates the explicit commitment boundary.

| State | Behaviour |
| --- | --- |
| Empty | “Choose the bytes to import”; start from sample or actual file control via Replace. Formats and limits remain next to the task. |
| Loading | Upload/profile skeleton or live “Previewing 200 records…”; preview/run disabled until complete. |
| Error | Oversize upstream file: 413, 25 MiB limit, use a bounded excerpt. Unsupported format and unparsed arbitrary-file messages preserve the chooser. Production validation errors retain the file and mapping. |
| Success | Preview enables exact-identity confirmation. Since these bytes already exist, the run creates a duplicate receipt, not another 80 sessions. |

Production also handles malformed mapping errors inline and a raced commit (409) with a link to the winning attempt, rather than automatic resubmission.

### 2. Import report — an immutable receipt

The receipt has a green top rule, status at the signature position, and four numbered sections. Accepted, partial, duplicate, rejected and ignored count **source records**. The next section counts entities. A successful fixture receipt shows 80 sessions, 4,770 model calls, 5,723 tool calls; warnings are 11,168 null and 14,633 absent field occurrences; zero rejects.

The full file hash belongs on this page, not in a permanent workspace sidebar. A compact margin note explains that a receipt is an audit snapshot, while dashboard totals come from accepted observations. Failed receipts do not fabricate outcome zeros. Duplicate receipts show 4,770 duplicates and zero new entities, linked to the original commit.

| State | Behaviour |
| --- | --- |
| Empty | No receipt yet; direct action to import a file. |
| Loading / running | Counts unavailable until the response completes. A live pending message replaces outcome numbers. Prototype reviewer can complete the simulated request. |
| Error / failed | Rollback and exact error are primary; zero inserted entities and a retry route. The independent failed-fetch state gives a service-recovery action. |
| Success | Committed receipt, or duplicate receipt with unchanged totals. The separate “Committed with rejection” specimen opens its rejects section immediately. |

The reject specimen uses `line:1042`, `model_call`, `$.usage.input_tokens`, `invalid_type`, and `expected integer, got string '12,431'`. The browser filters by code and opens a raw payload. This is an explicitly separate illustrative 2,000-record file with 1,999 accepted and one rejected; it does not contaminate the clean fixture. It deliberately makes no claim of a real hash for those invented bytes.

### 3. Imports history — the journal

The default screen is the operator’s durable record: four attempts, newest first, date and timezone clear. Search covers filename, source and full ID; status filters immediately. Same-file duplicate and earlier failure sit next to the original commit, showing that attempts and dataset growth are different concepts.

| State | Behaviour |
| --- | --- |
| Empty | First-journal message and Import a file action. Search with no matches has its own Clear filters action. |
| Loading | Row-sized skeletons; no temporary “0 attempts”. |
| Error | Local service unavailable; retry without suggesting data was deleted. |
| Success | Exact records and added entities per attempt. Full receipt opens from filename, ID or explicit arrow. Current one-page scope is stated; no meaningless pagination controls. |

Additional attempts, timestamps and the reject sample are illustrative. The supplied fixture’s committed receipt is the numerical anchor. In production the number of attempts comes from pagination metadata rather than a hard-coded journal title.

### 4. Dashboard — the observation statement

Four columns read like a statement: 80 sessions, 4,770 recorded model calls, 553,447,877 input tokens and 1,204,331 output tokens. All values are exact. Coverage is visible under each number; count coverage describes enumerated imported identities/observations, not completeness of upstream data. Token footnotes explain known/total calls and partition input usage by accounting semantics.

Filters are local to this statement. Three charts lead directly to its contributing-session table. Selected day/tool scope appears as a removable annotation. Daily grouping uses recorded call-start day in UTC. Every generated call shares its session’s start day in this small illustrative dataset. Production must bucket actual call timestamps and return sessions containing those calls; a session spanning days may contribute to more than one bucket. Do not substitute session-start grouping for call-start grouping.

| State | Behaviour |
| --- | --- |
| Empty | No observations in scope with Reset filters. Zero known token coverage yields **Unavailable**, including inside the metric drawer. Empty session/model identity counts may legitimately be 0. |
| Loading | Skeletons replace numeric content; no stale values labelled as the new filter scope. Production may retain old numbers only with explicit stale-scope labelling. |
| Error | Failed scope query preserves filters and offers retry. A failed chart should not erase successfully loaded metrics. |
| Success | Exact totals, coverage, charts, quiet quality strip and paginated sessions. Footnote opens definition and evidence path. |

Quality notes cover rejects, missing input/output usage, unusable timestamps and unlinked tools. The fixture supplies zero rejects and complete input usage. Other zero diagnostic counts and complete output coverage are prototype assumptions, labelled in the notes; the API must supply them in production.

### 5. Session detail — observations with references

The supplied exemplar shows the complete external identity, source, `claude-code`, `project_8f998460`, `user_b87fa13e`, observed bounds `2026-06-04T02:51:06.901Z` and `2026-06-04T02:52:00.698Z`, and an observed span of 53.797 seconds. Declared bounds are unavailable. Input usage is 48,187 tokens, known for 2 / 2 calls.

Model calls are first; tool calls are a tab, not a second competing table. The two model specimens contain 16,147 and 32,040 input tokens. Three tool specimens are Bash, Read and Edit. Each observation opens its source JSON with full file hash, locator, emission path and mapping revision. Supplemental synthetic sessions have generated observation tables with pagination and direct raw-record specimens, so chart drill-downs do not stop at summary-only pages.

| State | Behaviour |
| --- | --- |
| Empty | Session identity without observations: explain the absence and return to overview. Each observation tab should also have a type-specific empty row in production. |
| Loading | Preserve route identity; skeleton evidence. Source drawer independently loads its record and announces progress. |
| Error | Session fetch recovery retains the scope route. Drawer fetch failure retains full hash and locator so retry targets the same bytes. |
| Success | Identity and interval, known/total usage, observations and native source dialog. Diagnostics are collapsed when clear. |

Diagnostic examples demonstrate `conflicting_value` and `reversed_interval` without asserting that the clean specimen has them. Real blocking or conflicting diagnostics should open by default and link every contributing record. Cache-read usage is **Unavailable · 0 / 2 calls** in the example; prefix tokens are never silently reclassified as cache reads.

### 6. Mapping assistant — a reviewed interpretation

The starting document profiles the `swe-chat-conversations.parquet` 2,000-row excerpt, describing the 1.3 GB upstream size without pretending that it can pass the 25 MiB upload limit. Field types and presence counts are one expansion away. All seven required profile fields are represented, including nested role/content/tool calls.

No proposal appears until the outbound-context review is confirmed. The sample visibly excludes content, tool arguments, repo values and conversation identity. Schema, field coverage, model labels, token values, timestamps, current draft and submitted messages may leave the machine. A production build must display the actual configured recipient and model; the mock clearly labels its provider as simulated.

The proposal identifies a material ambiguity: root usage cannot be copied onto every assistant turn. It proposes conversation-level observations with a distinct `swe-chat-conversation` semantics tag. The analyst explicitly accepts that interpretation and chooses epoch seconds. Each editable field has a footnote explanation. Unsupported paths and an incorrect timestamp unit produce linked inline errors; no save is possible before valid preview. A message mentioning epoch/seconds updates the time transform and invalidates the preview. Other messages receive a clearly simulated explanation rather than pretending to invoke a model.

| State | Behaviour |
| --- | --- |
| Empty | Start from a bounded local excerpt and profile; no empty chat pretending to understand a file. |
| Loading | Proposal request and conversation pending states; request button disabled, progress announced. Current draft persists. |
| Error | Truncated proposal after one repair: explain failure, preserve draft, no revision/import. Field errors stay at their inputs; model refusal/timeout use the same recoverable document region in production. |
| Success | Reviewed proposal → validate → preview → save immutable revision → separate hash/revision confirmation → simulated import receipt. |

The excerpt hash, saved mapping ID, counts and generated payloads are explicitly illustrative. Saving and importing mutate only in-memory prototype state. Production records provider/model/prompt version, sanitised context summary, explanations, ambiguities and mapping parent/revision through backend contracts. A later edit creates a draft from the saved immutable revision; never updates the saved revision in place.

### 7. Definitions — notes to the statement

A readable reference document contains sessions, model calls, input/output tokens, tools, cache reads and observed span, with units, semantics and comparison rules. Quality definitions are one click away. Metric footnotes should deep-link to these same domain-owned definitions rather than duplicate prose maintained by the UI.

| State | Behaviour |
| --- | --- |
| Empty | Definitions unavailable; no invented fallback semantics. Retry when the workspace is available. |
| Loading | Preserve heading and reference context, skeleton definition rows. |
| Error | Explain definition service failure; do not render a metric as if its meaning were known. |
| Success | Full reference with explicit known/total policy, known zero vs unavailable, accounting partitions and observed-time limitations. |

## Accessibility

- Real header/navigation/main/footer landmarks, one h1 per screen and hierarchical section headings. Native tables have captions and scoped headers. Main receives focus after route changes; a Skip to content link is available first.
- Text and icons are supplementary to explicit status labels. Essential information never relies on colour, hover, chart shape or placeholder text.
- All controls have visible or programmatic labels. Mapping errors use `aria-invalid` and `aria-describedby`; validation focuses the first offending control. Confirmation is an associated checkbox label, not an unlabeled toggle.
- Native modal dialogs provide focus containment and background inertness. Escape closes; opening moves focus to the close control; closing restores the original opener even when drawer content has changed. The source preformatted region is focusable and wraps long records.
- Every SVG bar is a keyboard-operable link with an exact-value accessible name. The chart-values drawer exposes tabular equivalents for daily/tool bars; model labels and exact values remain visible and accessible. Production Recharts requires explicit keyboard targets rather than relying on pointer `onClick` alone.
- Observation tabs implement arrow/Home/End interaction and roving tab index. Standard buttons/links support Enter; native buttons also support Space. File selection is available without drag-and-drop.
- Progress is announced through live regions. Errors use `role=alert`; status updates do not replace focus unnecessarily. Respect reduced motion; shimmer stops when requested.
- At 200% zoom, the layout takes the narrow breakpoint rather than preserving a fixed 1,280 px canvas. Tables may scroll internally; overflowing scroll regions receive a label and keyboard focus target. Screen-reader and actual-browser zoom testing remain release checks.

## API fit and implementation cost

The visual direction deliberately reuses the current thin slice’s route shapes and native building blocks. No API shape is renamed to make the mock easier.

| Existing contract | Use |
| --- | --- |
| `POST /api/uploads` | Immutable byte identity, sniff result, first decoded records, earlier exact-byte imports |
| `GET /api/mappings` and `/{id}` | Mapping choice, revision, document and validation issues |
| `POST /api/imports/preview` | Sample denominator, entity counts, warnings, rejects and emissions; no persistence |
| `POST /api/imports` | Revalidation and single-transaction commit; duplicate/failed add no observations |
| `GET /api/imports`, `/{id}`, `/{id}/rejects?code=` | Journal, receipt, filtered rejects with raw payload |
| `GET /api/sessions`, `/{id}` | Scoped session list, observation tables, declared/observed intervals and diagnostics |
| `GET /api/raw-records?file_sha256=&locator=` | Display `payload_text` verbatim; never `JSON.stringify(payload)` because browser numeric precision can change evidence |
| `GET /api/metrics/summary?source=&agent=` | Available day-1 counts and input-token definition/coverage/semantics |

**Required planned extensions:** output-token summary, chart buckets, metric quality counts, model/period/import scopes, definitions, profiler, outbound assistant context/proposal/revision endpoints, mapping validation/save and immutable revision metadata. Client-side filters over one 50-row session page must never masquerade as whole-dataset aggregation. The synthetic 80-session prototype is complete in memory; production must query metrics and contributing sessions under the same backend scope.

`running` is not a persisted status in the current v0.1 HTTP contract. The mock models it as a local pending POST, not an invented jobs API. The consolidated plan’s overlapping-file gate is broader than its explicit identity decision: the design only promises exact-file/source idempotency, and discloses that overlapping-export reconciliation is deferred.

### Approximately 12 hours of frontend work / 1.5 days

| Work | Budget | Release result |
| --- | --- | --- |
| Token stylesheet, shell, document/table primitives, responsive styles | 2 h | Shared Ledger visual system |
| Recompose import, receipt and history; preserve existing API actions | 2.5 h | Known-source path and audit journal |
| Statement KPIs, filters, three Recharts charts, definitions/quality notes | 2.5 h | Day-2 analytics, conditional on metric endpoints being ready |
| Session tables, tabs and reusable evidence dialog | 1 h | Metric → session → exact record |
| Profile/proposal/edit/validate/preview document | 2.5 h | Thin day-3 assistant path, conditional on provider/profile contracts |
| Keyboard, responsive, state regression and smoke checks | 1.5 h | Focused release verification |

This is a tight implementation budget for an experienced engineer extending the existing pages, not a promise that backend work fits into it. Backend metric and mapping work belongs to the plan’s separate days 2 and 3. If those contracts are late, ship the complete existing import/receipt/session path and expose an honest unavailable state for dependent sections; do not display fixture numbers in the product.

**Ships in v0.1.0:** document shell, light tokens and dark token wiring, core tables and disclosures, upload/preview/confirmation, exact receipt and history, four KPIs and three charts when backed by the planned endpoints, scoped session evidence, concise definitions, and a minimal reviewed mapping proposal/editor flow. Reuse existing request handling and native elements.

**Deferred:** elaborate correspondence timelines and diffs, saved views, journal exports, animated chart transitions, virtualisation, automatic mapping suggestions on every upload, large-file streaming, multi-user collaboration, authentication, overlapping-export reconciliation and a command palette. The prototype review menu never ships. Rich redaction controls are deferred; explicit preview of the bounded outbound context is required now.

## Risks and trade-offs

1. **An authoritative-looking document can lend false certainty.** Exact coverage, source-specific semantics and clear specimen labelling are mandatory. The paper aesthetic does not replace validation.
2. **Footnotes can hide meaning from a first-time user.** Coverage and concise comparability warnings remain visible. Footnotes are clickable buttons with meaningful accessible names and reuse the same glossary definitions.
3. **Serif titles may suggest a report tool more than an engineering tool.** Limit them to document headings. Tables, controls, numbers and evidence retain familiar technical typography.
4. **Full hashes consume space.** Show them in receipts, source drawers and final confirmation, where byte identity is the task; collapse them at the earlier compatibility stage.
5. **Aggregation semantics are not automatically comparable.** Conversation-level SWE-chat observations stay in their own semantics group. Input totals cannot justify cross-agent efficiency or cost claims.
6. **Source data needs stricter handling than ordinary JSON.** The real raw drawer must preserve `payload_text`. Reject responses currently expose `payload` but no exact text; request a compatible exact-text extension or locate the raw source through its file and locator before claiming byte-exact reject evidence.
7. **Local filtering can create a misleading dashboard.** All backend queries need one consistent scope. The thin slice does not yet have every proposed filter/chart endpoint.
8. **The 12-hour budget is aggressive.** Native details/dialog and a small shared CSS system make it plausible, but assistant and metric backend dependencies dominate. Avoid a framework migration or a generic visual mapping designer.

## Why Ledger, and where it loses

| Compared with | Ledger’s advantage for AgentScope | Where Ledger loses |
| --- | --- | --- |
| Workbench | The meaning and origin of each number are understandable without learning an inspector or command vocabulary. Receipts make an import attempt durable and readable. | Expert keyboard users will move faster with a persistent inspector, split views and a command palette. |
| Console | The record behind a chart is a primary object. An honest duplicate or failed import is as easy to inspect as a successful dataset. Calm documents suit intermittent review. | Less immediate for monitoring many changing datasets; no global sticky filters or always-visible anomaly surface. |
| Guided | Experienced analysts can scan a complete worksheet, revisit earlier clauses and read a receipt without advancing through a wizard. The mapping revision remains the shared artefact. | New users receive less hand-holding. They must understand sample/full-run and observation/session distinctions; a strict wizard can teach these more explicitly. |

AgentScope’s distinguishing promise is trust, not live monitoring or a general coding workspace. Ledger puts that promise into a repeatable interaction: a number has a note; an observation has a reference; an import has a receipt. It is strongest for daily known imports, auditing and number verification, with a deliberately modest assistant surface for the weekly unknown-source job.

## Prototype fidelity and verification

The fixture filename, size, SHA-256, mapping ID/revision, record count, entity totals, input/output totals and supplied session identity/interval/input usage match the brief. The other 79 sessions are generated allocations that reconcile exactly to those totals. Per-day, model and tool breakdowns, output coverage, non-reject quality zeros, additional attempt IDs/times, raw JSON specimens and assistant profile/preview/full-run numbers are illustrative. This is stated in the prototype footer and at sensitive evidence surfaces. No mock payload is presented as retrieved file bytes.

The HTML contains no fetches, external script/style imports or image requests. CSS and JavaScript are inline. All seven routes render from disk. 72 DOM interaction, state, structural and consistency checks passed without runtime errors. Functional checks use the repository’s existing jsdom package without changing application files. Checks cover route rendering, import preview and confirmation, duplicate completion, receipt states, code-filtered rejects, all chart drill-down types, pagination, source drawers, mapping context confirmation, invalid/valid drafts, preview invalidation, save/import simulation and generic page states.

A real Chromium launch was attempted using the installed browser, but the workspace sandbox denied macOS Mach-port registration before startup. Consequently **visual screenshots, computed layout at 900/1280/1920, native dialog focus trapping, real browser zoom and screen-reader behaviour are not browser-verified here**. The responsive breakpoints and overflow handling were statically reviewed, and dialog/navigation behaviour was exercised with DOM shims. These browser-specific checks remain required before implementation sign-off. No application tests/build were run because application code was not changed.
