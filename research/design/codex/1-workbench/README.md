# Workbench — evidence within reach

**One persistent, keyboard-driven workspace where the current task owns the canvas and its evidence opens in a single inspector.**

Direction 1 · Codex · AgentScope design study · 7 September 2026.

Open [mockup.html](./mockup.html) directly from disk. No server, build, dependencies, external assets, or network requests are needed. The initial screen is the dashboard. This is one design variant, with seven connected screens and a fully designed light theme.

## Who this favours

The returning analyst who wants to move quickly between import, investigation, and mapping without changing applications or losing context. It also gives the occasional reviewer a predictable evidence path and the operator a compact audit ledger. Familiarity pays off: keyboard shortcuts accelerate frequent work, while every shortcut has a visible control.

This is a local analytical instrument, not an organisation management product. There is no account menu, team switcher, notification center, decorative activity feed, or global AI chat. The fixed “Local workspace” label establishes the destination and privacy boundary; it does not imply multi-workspace support.

## Information architecture

The prototype uses simple hashes. Production keeps the existing React Router routes and adds the mapping and definition surfaces.

| Screen | Prototype | Production route | Responsibility |
|---|---|---|---|
| 1 · Import | `#import` | `/import` | Select immutable bytes, choose mapping, sample execution, confirm exact binding, run |
| 2 · Report | `#report` | `/imports/:id` | Attempt status, record outcomes, inserted entities, file provenance, warning and reject inspectors |
| 3 · History | `#history` | `/imports` | Newest-first attempts, status filter, source, revision, counts, UTC time |
| 4 · Dashboard | `#dashboard` | `/dashboard` | Scoped metrics, chart selection, matching sessions |
| 5 · Session | `#session` | `/sessions/:id` | Identity, observed and declared bounds, observations, evidence |
| 6 · Mapping | `#mapping` | `/mappings/:draftId` | Profile, proposal, field edits, explanations, conversation, validation, preview, immutable save |
| 7 · Definitions | `#definitions` | `/definitions` | Metric definitions, units, coverage, semantics and comparability |

The rail has four task destinations: Dashboard, Import traces, Imports, Mappings. Definitions and Commands sit below them. Reports belong to Imports; sessions belong to Dashboard. Neither becomes an extra permanent rail item. The command palette can open the example report and session directly for review.

Production filter state belongs in the URL: source, agent, model, UTC period, chart selection and pagination. Session links retain that return URL. The prototype retains filters and selection in memory while changing hashes; refresh returns the supporting example session and default scope. This deliberate prototype limitation is not the production navigation specification.

## Navigation model

- `⌘K` / `Ctrl+K` opens a searchable command palette. Arrow keys move through commands; Enter opens one; Escape closes it. A visible Commands button does the same.
- `1` Dashboard, `2` Import, `3` Imports, `4` Mappings. Shortcuts do not fire while editing inputs or while a dialog is open.
- The canvas is the place to work. A single right-hand modal inspector is the place to explain or verify. It preserves the underlying scroll position and selection. Escape or its close button returns focus to the invoking control through native dialog behavior.
- Observation tabs change the relevant table, not the session route. Preview tabs expose emissions, warnings and rejects without expanding an already long page.
- A chart selects a subset in the session table. The selection is named and removable. A session opens its observation table; “Source record” opens raw JSON. **Three clicks from chart to source**, with the selected scope restored on return.
- Breadcrumbs communicate location; they are not a second navigation menu. No drag-only interactions, hover-only actions, resizable panes, or terminal metaphors are required.

## Disclosure model

| Task | Always on the canvas | One deliberate action away | Why |
|---|---|---|---|
| Decide whether to import | File, detected format, records, mapping, bounded preview, same-byte warning | Full hash and decoded record via Inspect file; confirmation displays full hash and revision together | A hash matters at identity verification and commit, not as ambient decoration |
| Understand the result | Final status, all five record outcomes, inserted entities, file and hash | Missing-field policy and reject payload | Record outcomes establish the transaction result; individual failures need an inspector |
| Check a KPI | Exact value, coverage, visible definition button | Definition, unit, semantics and contributing sessions | Coverage changes interpretation now; the formal definition is requested evidence |
| Investigate a session | External identity, agent/repo context, intervals, coverage, selected observation table | Full identity, user, diagnostics, raw record | Provenance does not compete with the data under investigation |
| Edit a mapping | Field bindings, ambiguity, validation, relevant conversation | Profile, per-field explanation, exact outbound context, preview | The mapping is the shared artifact; the assistant never becomes the primary product |
| Audit attempts | Status, filename/ID, revision, source, counts, time | Full attempt, hashes, error and reject payload | A ledger row should answer “which attempt?” before “what exact bytes?” |

The inspector is deliberately a native modal `<dialog>`, not a second permanently occupied column. Background controls become inert, which makes keyboard behavior unambiguous and prevents accidental mutation during review. The import context column is fixed because destination, duplicate risk and mapping compatibility affect the current decision. The mapping conversation earns permanent space only on the mapping task.

The small **Demo: populated / empty / loading / error** selector in the top bar and **Prototype: attempt outcome** on the report are review controls, excluded from the shipped product. They make non-happy paths inspectable without fake network failures. They are not global application settings.

## Visual system

### Composition and density

A 188 px neutral task rail, 57 px utility bar and 28 px canvas gutters establish the 1280 px layout. The page background is a cool near-white; white sheets have a one-pixel border and 5–7 px corners. There is no decorative gradient, hero, oversized icon or shadow on a normal data card. The inspector alone receives a restrained shadow because it changes depth.

The dashboard is a four-column KPI band, three compact charts, a quality strip and a full-width session table. Cards divide meaning rather than turning every label into a card. Rows use horizontal separators, a muted header, tabular numeric alignment and a restrained hover fill. Table captions are real semantic captions; visible headings identify tables where useful. IDs use a system monospace face, while descriptive text uses the UI sans face.

At 1920 px the rail stays fixed, canvas padding becomes 40 px, charts gain height and the content is capped at 1630 px. Reading lines do not stretch across the entire display. At 900 px the rail becomes 156 px and gutters 20 px; the KPI and chart bands remain intact. The mapping conversation moves below the table in two columns. Long hashes wrap; fixed table layouts wrap supporting IDs without causing horizontal page scroll. Below the required width, the rail becomes icons and charts stack as a courtesy fallback.

### Typography

No font download is required. Use `Inter` if installed, then the OS UI font (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, sans-serif). In production, self-host Inter only if already available in the build budget. Monospace: `ui-monospace`, `SFMono-Regular`, `Consolas`.

| Role | Size / approximate line height | Weight |
|---|---|---|
| Page title | 25 / 31 px | 650 |
| KPI value | 27 / 40 px; 23 px at 900; 34 px on wide displays | 600 |
| Inspector title | 18 / 27 px | 650 |
| Panel heading | 14 / 21 px | 650 |
| Body / controls | 13 / 19.5 px | 400 / 550 |
| Table row / supporting body | 12 / 18 px | 400 |
| Labels / metadata / code | 11 / 16.5 px | 400–550 |
| Table headers / chart labels / context caps | 10 / 15 px | 550–650 |

The smallest sizes are metadata, not instructions or primary controls. Numeric cells use `font-variant-numeric: tabular-nums`. Page titles have slightly tighter tracking; code preserves default spacing. A browser zoom increase is supported by wrapping grids and rows.

### Spacing, shape and interaction

Spacing scale: **4, 8, 12, 16, 20, 24, 32, 40 px**, with 2/6 px optical adjustments for compact badges and 14/18/28 px structural spacing where the data grid benefits. Normal row height is about 49–57 px with secondary metadata; single-line mapping rows are approximately 51 px. Button targets are generally 32–35 px high, compact icon controls at least 24 px through their enclosing hit area. No layout relies on a tiny unlabeled hit target.

Radii: 3 px keyboard hints, 4 px inputs and status chips, 5 px buttons, 7 px sheets, 10 px palette. One-pixel neutral borders define grouping. Focus is a 3 px blue outline with 3 px separation; focus is never conveyed solely by a background tint. Hover deepens a neutral fill. Disabled controls retain labels and nearby prerequisites. Skeleton movement is disabled by `prefers-reduced-motion`.

### Semantic colour tokens and dark derivation

The light theme is fully implemented. Dark is a direct token derivation for the eventual product, not a partially designed toggle in the prototype.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F5F6F8` | `#11171C` | Workspace background |
| `--surface` | `#FFFFFF` | `#192128` | Sheets and inspector |
| `--rail` | `#EEF0F3` | `#141C22` | Persistent navigation |
| `--ink` | `#202932` | `#EDF2F5` | Primary text |
| `--muted` | `#596574` | `#A9B5C0` | Supporting text |
| `--faint` | `#6A7482` | `#94A3AF` | Small metadata |
| `--line` | `#DFE3E8` | `#33414C` | Dividers |
| `--hover` | `#F0F3F5` | `#24323C` | Row/control hover |
| `--accent` | `#146B61` | `#78CBB7` | Links, active task, evidence actions |
| `--accent-soft` | `#E6F3EF` | `#193C34` | Selected/success background |
| `--amber` | `#8A590C` | `#EBC279` | Warnings |
| `--amber-soft` | `#FFF4DE` | `#3D301C` | Warning background |
| `--red` | `#AE3C39` | `#F6A19B` | Errors |
| `--red-soft` | `#FFF0EE` | `#422825` | Error background |
| `--blue` | `#536AAD` | `#9CACE4` | Secondary series |
| `--purple` | `#8577AA` | `#B9A9D7` | Reserved categorical series |
| `--focus` | `#335FC1` | `#9DBDFF` | Keyboard focus |

Additional surface roles: table header/code `#F8F9FA` → `#1D2831`; muted chart rail `#F0F3F5` → `#2D3A44`; chart grid `#E8EBEF` → `#33414C`; selected rail `#DCE8E5` → `#244238`; inspector backdrop `#17212D30` → `#00000070`. Convert the prototype’s corresponding literal tints to these semantic tokens when extracting CSS. Dark primary buttons use a light accent fill with `#102D27` text rather than white; dark theme is not CSS inversion. Status always includes a text label or shape, so red/green distinctions are supplementary.

### Table and chart design

Numbers are exact with thousands separators; no token total is abbreviated. Full hashes appear in confirmation, report, and source inspector. Truncated display IDs have a full identity or evidence view one action away. Raw JSON text is selectable and copyable without syntax-highlighter dependencies.

Charts are inline SVG in the mockup. Daily bars count sessions by observed start; tool bars count observations; model bars sum reported input values. Mark labels and accessible names carry exact values; native SVG titles expose them on pointer hover. Enter/Space on a focused mark selects matching sessions. Production Recharts should provide a focus-visible tooltip and the same exact-value accessible names; do not depend on native SVG title behavior for keyboard tooltips. Tool counts are printed exactly. Chart axes may use compact labels only if the exact data value remains exposed.

No smoothed curves or invented trends. No cost metric. No implication that a combined token sum measures equivalent work across accounting semantics. Missing timestamps need an explicit reachable bucket in production. Coverage 0 is **Unavailable**, never 0; a known zero remains a real numeric value.

## Component inventory and React implementation

| Component | Build / reuse | React requirements |
|---|---|---|
| `WorkspaceShell`, `TaskRail`, `PageHeader` | Replace existing header, retain routes | `NavLink`, active parent matching, focus title after route changes |
| `CommandPalette` | Small native dialog, no package | Controlled query, filtered commands, keyboard traversal, focus restoration |
| `InspectorDialog` | Generalise existing `SourceDrawer` | Native `showModal()`, opener ref, close cleanup, stable query key |
| `MetricCell`, `CoverageLabel` | Refine current KPI | Typed values, null guard, authoritative definition and coverage |
| `MetricInspector` / `DefinitionsTable` | New thin presentation | One metric registry shared by both surfaces |
| `ChartPanel` | Recharts per plan, no heavy UI framework | Scope props, accessible mark actions, selected dimension, exact tooltip |
| `DataTable`, `StatusChip`, `Pagination` | Restyle existing `Table`/`Pagination` | Native table/caption/headers; explicit row links; keyboard-safe pagination |
| `UploadSheet`, `PreviewTabs`, `CommitInspector` | Recompose current Import page | Busy guard, upload/mapping/preview binding; stale-preview invalidation |
| `ImportReport`, `RejectInspector` | Reuse current request functions | Separate record/entity maps, status branches, code filter resets offset |
| `SessionIdentity`, `ObservationTabs` | Recompose current Session page | Preserve return scope; paginated calls in production if needed |
| `RawRecordView` | Reuse source request, correct rendering | Render `payload_text` exactly; never `JSON.stringify(payload)` |
| `MappingTable`, `FieldExplanation`, `AssistantConversation` | New day-3 UI | Draft state, field issues, revisions, sanitized context approval, proposal-only API |
| `ResourceState`, `InlineIssue`, `Toast` | Refine current error handling | Live regions, stable error details, retry, retained last-known data |

React 19 + TypeScript + existing React Router and CSS are sufficient. Native dialogs avoid a focus-management library. Recharts is the planned chart dependency. TanStack Query may replace `useResource` when the team adopts the consolidated plan, but shell/styling should not be blocked on that migration. No heavy component framework, node editor, resizable docking system, or generic IDE infrastructure.

Keep the prototype’s inline functions out of production. Extract typed components and derive filters, totals and query keys from a single scope object. Server validation remains authoritative even after client validation. Avoid JS arithmetic on arbitrary-width token values; v0.1 fixture totals are safely representable, but API serialization for larger totals needs an explicit exact-integer contract.

## Screen-by-screen states

### 1. Import

**Populated / success:** The supplied fixture is preloaded to demonstrate the working sheet. Format, gzip detection, byte size and record count appear beside the file. Mapping selection invalidates preview. Preview tabs distinguish source records from entity emissions; warnings are field occurrences. Confirmation shows the entire SHA-256, immutable mapping ID/revision and destination, with the bounded-preview limitation.

The fixture already has a committed attempt. Running it again is intentionally a duplicate result, not a second successful insertion. “Earlier import” opens the clean report. The local file picker and drop target accept selection, enforce the 25 MiB boundary, and explicitly offer the supplied fixture rather than claiming to parse arbitrary files.

**Empty:** A bounded drop target, readable file types/limit, native file input, sample-file alternative. No mapping or preview before a file is selected. **Loading:** Hash/sniff or preview-specific progress text; relevant primary action disabled; live announcement. **Error:** Oversized file explains the excerpt requirement; service or validation failure keeps selected bytes/mapping, exposes structured details and a retry. A changed mapping cannot use the old preview. **Success after run:** Navigate to the final report only after the transaction returns.

### 2. Import report

**Populated / success:** Committed is the first information. Five mutually exclusive source-record outcomes remain distinct from inserted entity counts. The clean fixture shows 4,770 accepted; 80 sessions; 4,770 model calls; 5,723 tool calls; no rejects. Full file hash is visible because the task is audit. Warning details are in the inspector.

**Duplicate:** 4,770 duplicate records, zero inserted entities, explicit unchanged totals, original attempt reachable through history. **Failed:** Error message, transaction rollback, zero inserted entities; unavailable record outcomes are not presented as rejected records. Retry returns to confirmation work. **Running:** Indeterminate local pending transaction state, no fabricated percentage or committed entities. The current API returns final statuses only; running is client lifecycle, not an invented backend job resource.

**Empty:** Select an attempt from history. **Loading:** Report structure and progress label, no zero-filled counts. **Error:** Missing/unreachable attempt with retained context and Retry/Imports escape path. **Reject browser:** Code filter, locator, rule, path, message and raw payload disclosure. The specified line:1042 `invalid_type` example is clearly a separate illustrative record, never mixed into the zero-reject fixture. An unmatched code has a designed no-results state.

### 3. Imports history

**Populated / success:** Newest first. Filename with attempt ID, status, source and revision, source outcomes, inserted entities, date and time. The committed fixture, a duplicate attempt and a failed attempt demonstrate an honest ledger. Counts never add snapshots into analytics totals.

**Empty:** Explain that the first import creates the ledger; a single Import traces action. **Loading:** Keep column geometry, skeleton rows, announce loading. **Error:** Keep the last successful list visible in production with a stale timestamp and inline Retry; initial failure uses a full-width error sheet. **Filter-empty:** Keep the status control and an explicit reset action. Production uses the existing limit/offset contract; the three-row prototype ends explicitly at “End of ledger”.

### 4. Dashboard

**Populated / success:** Exactly four KPIs: sessions, model calls, input tokens and output tokens. Coverage stays beside values, definition is one click away. Source/agent/model/UTC period filters apply to both metrics and charts; a chart selection further narrows only the contributing-session table and labels that difference. Three charts and the quality strip directly serve investigation. No ambient import log or assistant prompt.

**Empty scope:** Sessions/calls can be known 0; token coverage 0 produces Unavailable. Session table explains no matches and clears filters. **Empty workspace:** Import call to action; no meaningless charts. **Loading:** Maintain the previous geometry, announce scope loading; production can retain previous data with an explicit refreshing label, never silently mix scopes. **Error:** Explain failed scope fetch, retain filters, retry without resetting intent. A failed chart is not a zero-valued chart. **Success drill-down:** Named selection and focused session caption announce the matching row count.

Unknown timestamps and unlinked tools belong in reachable quality subsets when present. Prototype zeroes for these details are illustrative. The warning inspector distinguishes absent/null field counts from records and incomplete token coverage. Cache reads remain confined to the documented semantics.

### 5. Session detail

**Populated / success:** Source/external ID, agent/repo context, input tokens and 2 / 2 coverage, observed interval and declared Unavailable. User/internal identity are one click away. Model and tool tabs expose observation IDs, model/tool, token or latency values, linkage, semantics and Source record. The source inspector includes full hash, exact locator, emission path, mapping revision and raw JSON.

**Empty observations:** Identity remains, with no invented zero duration or token total. **Loading:** Preserve session heading and observation-table skeleton. **Error:** Session not found / raw record unavailable are separate failures. A raw-record failure stays in the inspector, preserving the selected observation and a retry. **Success:** Closing the inspector restores focus and leaves the session intact. Returning to sessions keeps the chart selection.

Diagnostics have their own one-step inspector. Conflicting values show the competing contributions; reversed intervals retain timestamps but do not compute a duration. The illustrative diagnostic example is labeled separately from the clean sample. Observed bounds are never “active time”.

### 6. Mapping assistant

**Populated / proposal:** A local 2,000-row excerpt of the 1.3 GB upstream file, field profile, editable mapping table, per-field explanations, ambiguity and a narrow conversation pane. The assistant’s initial suggestion is demo content, not an actual provider result. Before a new message, Review & send opens outbound context and requires the explicit Send action.

The meaningful ambiguity is usage scope: root-level conversation totals cannot be repeated for every assistant turn. Resolve by leaving per-call usage unknown and preserving raw values. Validate → Preview → Save revision → Review & import are separate write boundaries. Edits invalidate validation and preview. Saved revision is immutable and editing locks in the demo. Production offers a distinct “Create draft from revision” action rather than mutating saved revisions.

**Empty:** Profile a bounded local excerpt; no empty chat asking for an entire upstream file. **Loading:** Profile progress or pending proposal; retain draft and prevent competing submission. **Error:** Inline path/type/unit issues, unresolved ambiguities block execution, truncation/refusal/malformed proposal retains previous draft. One bounded provider repair attempt, then actionable diagnostics. **Preview success:** Explicit sample outcomes, emissions, warnings, rejected samples and Unavailable token coverage. **Save success:** Immutable revision indicator and import action. **Import success:** A separate clearly simulated SWE-chat report, never relabeled TraceLab data.

No provider key in the browser. The configured endpoint/model, sanitized sample, field profile, mapping and actual outgoing message must be visible before sending in production. Redaction is not a blanket “safe” claim: paths and free text can still identify sensitive material. The model never commits entities.

### 7. Definitions

**Populated / success:** A compact registry with definition, unit, coverage/semantics and comparability for each KPI, chart and quality metric, plus cache read and observed interval. Deep links from KPI inspectors should target the corresponding row in production.

**Empty:** Missing registry is a configuration/data state; explain and offer reload rather than inventing definitions. **Loading:** Table structure with skeleton rows. **Error:** Keep cached definitions with a version/stale marker if available; otherwise retry. **Success:** Stable versioned definitions shared with dashboard inspectors, sourced from the domain metric registry rather than independently authored labels.

## Data and API fidelity

Read before designing: `research/design/00-brief.md`; all existing pages in `web/src/pages`; `components.tsx`; `index.css`; `App.tsx`; `docs/api/v0.1.md`; `docs/planning/2026-09-07-consolidated-plan.md`.

The mock uses the exact supplied filename, 681,057 bytes, full hash, mapping ID/revision, 4,770 records, 80 sessions, 4,770 model calls, 5,723 tools, 553,447,877 input tokens, 1,204,331 output tokens, warning counts, and example session identity/interval/input coverage. Raw source JSON is **illustrative**, since the brief supplies its shape but not the original row bytes. Source inspectors explicitly say this.

To make filters and charts honestly interactive, 79 supporting sessions and all chart distributions are deterministic illustration data. Their counts and sums reconcile to the supplied aggregate and the example session; they are not empirical research findings. Output coverage is illustrated as complete, not asserted as an additional supplied fact. Preview sample entity counts, assistant profile counts, tool timings, rejection payload excerpt, auxiliary attempt timestamps and SWE-chat outcome/hash are also labeled illustrations. The exact original record would be returned by the production raw-record endpoint; the design does not claim its generated payload matches the supplied file hash.

### Contract dependencies

| Available now | Requires planned API/domain work |
|---|---|
| Upload + format sniff + same-byte attempts | Field profiling and outbound-context manifest |
| Mapping list/read | Propose/revise/validate/save immutable draft revision |
| Bounded import preview + commit | Multi-file binding if shipped on day 2 |
| Reports/history/reject code filter | Server-side history status filtering, or explicit bounded-page filtering |
| Sessions, observations, exact raw `payload_text` | Model/period/import/tool query scope and chart-contributor filters |
| Sessions/model/tool/input summary | Output KPI, charts, quality summary, shared definition registry |

Do not pretend the day-1 API already supports model/period/import filtering or asynchronous job polling. The consolidated plan asks for an import-scoped dashboard; this prototype returns from the TraceLab report to the workspace dashboard, whose initial data contains only that committed fixture. Production must add an explicit import scope contract to maintain that meaning with multiple imports. The plan’s “overlapping files do not inflate counts” gate must be interpreted against D4’s actual guarantee: exact-file idempotency is guaranteed; general overlapping-export reconciliation remains deferred.

## Accessibility

- Native headings, landmarks, labelled controls, native tables with captions and scoped column headers. Skip link lands on main content. Route changes focus the page title; chart selection focuses the session caption.
- Keyboard-complete palette, controls, tabs-as-pressed-buttons, chart marks and source actions. The mock uses ordinary buttons for mutually exclusive view switches, avoiding a partially implemented ARIA tab pattern.
- All drawers and the palette use modal `<dialog>` for native focus containment and Escape handling. Closing returns to the invoking control. Do not mount an inspector as an unlabelled generic side div in React.
- Every chart has an accessible group label; each mark announces category and exact numeric value and supports Enter/Space. Production adds persistent focus tooltips and an equivalent data table if Recharts mark navigation cannot meet this contract within the timebox.
- Primary/supporting text and semantic status text are chosen for AA contrast. Muted chart fills and dividers carry no information alone; accessible names and text give values. Final production audit must include computed contrast for all theme combinations and 200% zoom; the token specification alone is not a certification.
- Visible blue focus; controls retain their label in disabled state; field errors connect with `aria-describedby` and `aria-invalid`; validation moves focus to the first invalid field.
- Live regions announce preview, import, selection, validation and copy status. Errors have `role=alert`. Do not announce every animation frame or streamed character.
- Full raw text remains selectable, wrapped and keyboard-scrollable. Copy has a local-file fallback and reports failure honestly. Render source as text, never trusted HTML.
- Reduced motion removes skeleton shimmer. No essential behavior relies on transition completion, colour perception, hover, drag, or double-click.

## Implementation cost within the timebox

**Approximately 11.5–12 hours of frontend work across the 1.5-day UI allocation**, assuming the planned domain/API endpoints land on time. This is an aggressive integration estimate, not a promise to build missing backend work in CSS time.

| Work | Hours | Release allocation |
|---|---:|---|
| Token system, rail, page/table primitives, responsive shell | 1.5 | Day 2 |
| Inspector reuse, focus behavior and command palette | 1.0 | Day 2; palette is first cut if delayed |
| Recompose upload/preview/report/history, reject inspector | 2.0 | Day 2 |
| KPI band, three Recharts panels, scope/table drill-down | 2.0 | Day 2, API dependent |
| Session observation tabs, provenance and definitions | 1.0 | Day 2 |
| Mapping table, explanation/context inspector, proposal conversation | 2.5 | Day 3, profile/assistant API dependent |
| Responsive/keyboard verification and required integration smoke | 1.5–2.0 | Day 2/3 |

**Ships in v0.1.0:** known import and duplicate path; complete attempt report and reject inspector; compact ledger; four trustworthy KPIs and the three planned charts; existing raw-record path; definitions; bounded mapping proposal/edit/validate/preview/save/import after day-3 endpoints exist. Keep status and request errors explicit throughout. The light theme is the implementation priority of this study; tokenise now so dark can follow without reworking components.

**Defer:** pane resizing/docking, multiple workspace tabs, persistent command history, advanced key chords, virtualized 100k-row grids, multi-select comparisons, visual DSL graph, bulk reprocessing, transcript search, exports, AI questions about analytics, long-running background jobs, URL import and universal cost comparisons. Full dark-theme implementation/QA is a follow-up unless integration leaves room; both themes remain the product requirement. No multi-user/auth surfaces.

If schedule slips, remove command keyboard acceleration before removing accessible evidence access, the three-click source path, precise outcomes or coverage. The native buttons still provide the complete product. Retain basic definition inspectors before adding visual polish to charts.

## Risks and trade-offs

1. **An expert surface can intimidate a first-time analyst.** Import still has a visible next action and numbered sections; avoid adding onboarding chrome to every task. Guided will teach unfamiliar schemas better.
2. **Modal inspection pauses comparison.** This buys a clear keyboard boundary and implementation simplicity. Side-by-side raw-record comparisons and pinned inspectors are deferred.
3. **Density puts pressure on metadata size.** 10–11 px is reserved for supporting labels. Primary values, controls and failure instructions stay larger. Verify zoom and real long IDs before shipping.
4. **One inspector can lose an explanation when replaced by source evidence.** Close returns to the owning canvas; no nested modal maze. A future inspector back stack should be justified by observed workflows, not built speculatively.
5. **The planned dashboard exceeds the current contract.** Keep API work explicit above. Do not ship browser-only aggregates over a paginated subset while presenting them as workspace totals.
6. **A mixed-semantics token sum can be misread.** Label it as reported values, expose semantics, never price or rank equivalent work from it. A future semantics filter may be required by the domain registry.
7. **Mock interactions are intentionally finite.** Conversation supports usage-scope and epoch-unit corrections; other messages are acknowledged as unsupported demo actions. Local file selection uses the supplied fixture after an explicit explanation. This file is not an ingestion engine or an LLM client.

## Why Workbench for AgentScope, and where it loses

| Compared with | Workbench advantage | Where Workbench loses |
|---|---|---|
| Ledger | Fast switches between making a mapping, importing and investigating; compact observations stay actionable | Less naturally printable; the narrative of one import is less calm and documentary |
| Console | Import and mapping are first-class tasks rather than configuration surrounding analytics; evidence gets a consistent inspector | A monitoring-heavy user gets less wallboard impact and fewer always-visible trends |
| Guided | Frequent analysts can inspect or edit directly without replaying a wizard; context persists across tasks | First-time schema onboarding needs more confidence and explicit explanation than a familiar operator does |

AgentScope’s four jobs share a working set: a file, a mapping, observations and source records. Workbench gives that set one home and spends space on the current question. Its distinguishing investment is consistent inspection and keyboard motion, not a decorative theme applied to the same long forms.

## Review walkthrough

1. Open the file on Dashboard. Inspect Input tokens, then close with Escape.
2. Select the June 4 activity bar, open the example `claude:781a3b4c…` session, and choose Source record. Full hash, locator, emission path and illustrative raw JSON appear. Escape; Back to sessions retains selection.
3. Press `2`. Switch preview tabs, inspect file, and Review import. The full bytes/revision binding and same-byte warning are shown. Run import → pending → Duplicate.
4. Press `3`. Filter history by committed and open the fixture report. Try the report’s prototype status selector and separate reject example; filter rejects to invalid_json to see no results.
5. Press `4`. Open field profile, resolve the usage ambiguity, deliberately enter an unknown source path and Validate. Repair it, Validate, Preview, Save revision, then Review & import excerpt.
6. Before saving, send “created_at is milliseconds”; review outbound context, simulate send, and observe the invalidated preview and changed transform.
7. Use the top-bar demo selector for empty/loading/error on any screen. Use Commands to reach Definitions, report or the example session. Reload resets this offline study.

## Verification

Completed: inline JavaScript syntax check and **52 passing DOM checks** using the repository’s existing jsdom, without installing dependencies. These cover all seven populated/empty/loading/error routes, chart selection, agent/model intersection and Unavailable values, metric/source inspectors, full-hash confirmation, running-to-duplicate transition, reject-code filtering, mapping ambiguity resolution, inline validation, preview/save, conversation unit correction, stale-preview invalidation, command filtering, and reconciliation of all four supplied aggregate totals. A static scan confirms no network URLs.

**Visual browser QA remains unverified.** Both installed Chromium and Chromium Headless Shell failed to launch in this restricted environment (browser process aborted). No screenshot review or measured 900/1280/1920 viewport overflow result is claimed. Responsive breakpoints, wrapping constraints, focus styles and reduced-motion rules are implemented, but native dialog focus containment, rendered contrast and final viewport composition should be checked by opening the file in a normal browser. The DOM checks stub native dialog/scroll behavior and cannot establish those properties.

Only this assigned directory contains authored deliverables. No repository source, dependency manifest, API implementation or git command was used or changed.
