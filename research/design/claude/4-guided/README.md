# Variant 4 · Guided — "Passage"

**Concept in one sentence.** Every task is a short route with numbered stops; the rail on the left is not a decoration but a receipt that fills with verified facts (bytes, hash, mapping revision, dry-run counts) as you pass each stop, so that by the last stop the rail *is* the provenance record, and the dashboard is where the route lands.

Files: `README.md` (this document) and `mockup.html` (self-contained, opens from disk, hash routing).

Reviewer deep links inside the mockup: `#/import?step=3`, `#/assistant?step=3`, and the "Demo data" selector in the top bar (happy path · bytes seen before · empty database · loading · backend error).

## Who it favours

| Job | How the variant serves it |
|---|---|
| 1 · Import a known dataset (daily) | Four stops, three clicks when nothing is wrong: drop the file, keep the recommended mapping, glance at the dry run, confirm with the hash. Nothing else is on screen. |
| 2 · Onboard an unknown dataset (weekly) | **The favoured job.** Five stops with the assistant as a side conversation next to the mapping table. The table is the only artefact that gets saved; the conversation can only edit it, never the database. Redaction is a stop of its own, before anything is sent. |
| 3 · Check a number (ad hoc) | KPI → definition popover (one click) → chart bar → matching sessions (one click) → session → "Source record" drawer with hash and locator (one click). Three clicks, no dead end. |
| 4 · Audit imports (ad hoc) | The history is one ledger table; every report is a receipt with file hash, mapping revision, an outcomes bar and a rejects browser whose raw payloads open in a drawer. |

It favours the analyst who imports and onboards. The reviewer and the operator are well served but not privileged: they enter through the dashboard and the history, not through a route.

## Information architecture

| Route | What lives there | Reached from |
|---|---|---|
| `#/import` | The import route: File → Mapping → Preview → Confirm. Stepper in the rail, one stop on stage at a time. | Top bar; empty states. |
| `#/imports` | Ledger of every attempt (committed, duplicate, failed), newest first. | Top bar. |
| `#/imports/:id` | Import report: status line, receipt (file, SHA-256, mapping revision, timings), record-outcome bar, observations inserted, field warnings, rejects browser with code filter and raw-payload drawer. | Ledger row, success banner after a run, "Seen before" line in the import route, session header. |
| `#/dashboard` | Filters, four KPIs, three charts, quality strip, sessions table. `?import=` scopes it to one import. | Top bar, success banner, report header. |
| `#/sessions/:id` | Identity receipt, declared vs observed interval, token coverage, model-call and tool-call observations, diagnostics, "Source record" drawer. | Sessions table row, chart drill-down. |
| `#/assistant` | The onboarding route: Profile → Send → Mapping (table + conversation) → Dry run → Save and import. | "Neither fits?" link on the Mapping stop of the import route; later also from the ledger. |
| `#/definitions` | Every metric: definition, unit, semantics tag, comparability rule. | "Definitions" button on the dashboard, footer of every definition popover. |

Two routes are flows (import, assistant); four are destinations (ledger, report, dashboard, session); one is a reference (definitions). The top bar only lists the three entry points an analyst types in her head: Import, Imports, Dashboard. Session, report and assistant are reached by context, never from the bar.

## Navigation model

- **Top bar** with three entries and a brand link. The current entry is underlined with the accent; the session page highlights "Dashboard", the assistant highlights "Import", so the bar always says which route you are inside.
- **Rail** (left, sticky) inside flows: numbered stops, the current one filled, completed ones ticked and clickable to go back, future ones inert. Under a completed stop, its fact in monospace (`681,057 B · d044a766e1…`, `tracelab-v1 · rev 1`, `200 sampled · 0 rejected`). A footer line states the promise of the route: "Nothing is written until the last stop."
- **Stage bar** at the bottom of every stop: Back on the left, the one primary action on the right, named for what happens ("Run a dry run", "Import 4,770 records", "Save and import 2,000 rows"). A status text sits between them while something runs.
- **Breadcrumbs** on destinations reached by context (report, session).
- **Drill-down** is a click on a chart bar: it sets a removable chip above the sessions table and scrolls to it. The URL does not change; the chip is the state.
- Hash routing in the mockup; React Router in the product, same paths.

## Disclosure model

On screen: only what the current stop or destination needs to be judged. One deliberate step away: definitions, raw bytes, the first twenty records, the payload of a reject, the semantics breakdown of a token sum.

| On screen | One step away | Why |
|---|---|---|
| File stop: name, bytes, full SHA-256, format, record count, "Seen before: yes/no" | First 20 decoded records (`<details>`), how the format was detected (popover) | The five facts decide whether to continue; the records are for doubt. |
| Mapping stop: two radio cards, recommendation reason, the assistant link | Mapping document, superseded revisions | A known file needs a choice, not an editor. |
| Preview stop: sampled/accepted/rejected, emitted counts, warning counts, rejects (or the designed "none") and five emissions | Definitions of observation, null vs absent (popovers) | Enough to see "clean" or "not clean"; enough to see what a row becomes. |
| Confirm stop: a receipt with exactly what will be written | Nothing. | The last look must be complete on its own. |
| Report: status sentence, receipt, outcome bar, observations, warnings, rejects table | Raw payload of each reject (drawer), dashboard for this import | An audit reads top-down; the bytes open only when asked. |
| Dashboard: four KPIs with coverage, three charts, quality strip, ten sessions | Definition of each KPI (popover), semantics breakdown (in the popover), all definitions (page), sessions behind a bar (chip) | A number without its coverage is not shown; a definition is one click, never inline prose. |
| Session: identity, declared vs observed side by side, four token measures with coverage, two observation tables, diagnostics | Raw JSON of one observation with file hash and locator (drawer) | The page proves the numbers; the drawer proves the page. |
| Assistant, Mapping stop: the editable table with per-row explanation and status, the conversation | Profile (previous stop), what was sent (previous stop), mapping document | The table is the shared artefact; the conversation is beside it, not above it. |

Rules applied everywhere: no card has a shadow (panels are hairline-bordered surfaces); KPIs are one panel divided by hairlines, not four cards; no eyebrow labels, no icons in the chrome; abbreviations (`291.2M`) appear only on chart axes with the exact value in the bar's title and in the KPI; "Unavailable" is a designed value, never `0` or `—` for a measure.

## Visual system

**Typography.** Instrument Sans (400 / 500 / 600) for interface text; IBM Plex Mono (400 / 500) strictly for hashes, ids, locators, paths, timestamps in tables and the rail facts. Scale, on a 14 px base with ratio ≈ 1.25:

| Token | Size | Use |
|---|---|---|
| `--t12` | 12 px | coverage lines, chart axes, rail facts, row messages |
| `--t13` | 13 px | table body, filters, secondary copy |
| `--t14` | 14 px | body, buttons, labels |
| `--t16` | 16 px | section headings (`h2`), brand |
| `--t20` | 20 px | stat values, monospace page titles (ids) |
| `--t26` | 26 px | page and stop titles (`h1`) |
| `--t34` | 34 px | KPI values only |

Line height 1.5 for text, 1.25 for headings; letter-spacing −0.5 % on headings; `font-variant-numeric: tabular-nums` on every numeric column and value.

**Spacing scale.** `--s1` 4 · `--s2` 8 · `--s3` 12 · `--s4` 16 · `--s5` 24 · `--s6` 32 · `--s7` 48 · `--s8` 64. Rail 248 px, stage max 760 px (widens on the assistant's Mapping stop), conversation 300 px, page max 1440 px. Radii: 4 px controls, 8 px panels, pill for badges and chips. Three radii, nothing else.

**Colour tokens (light).**

| Token | Value | Role |
|---|---|---|
| `--ground` | `#F2F4F6` | page |
| `--surface` / `--surface-2` / `--surface-3` | `#FFFFFF` / `#F7F8FA` / `#EDF0F3` | panels / table heads, rule rows / skeletons |
| `--line` / `--line-strong` | `#DCE1E6` / `#B4BDC7` | hairlines / control borders |
| `--ink` / `--ink-2` / `--ink-3` | `#1C2733` / `#465360` / `#5F6C79` | text / secondary / tertiary (5.37:1 on white) |
| `--accent` / `--accent-strong` / `--accent-soft` / `--accent-line` | `#0F6B5C` / `#0B5346` / `#E1F0EA` / `#9CCBBC` | current stop, primary action, links, "committed" |
| `--warn` / `--warn-soft` / `--warn-line` | `#7E5200` / `#FFF3D6` / `#E8C46B` | open questions, partial coverage, quality flags |
| `--danger` / `--danger-soft` / `--danger-line` | `#B3261E` / `#FBEAE8` / `#EBA39D` | errors, rejects, failed |
| `--info` / `--info-soft` | `#2C5AA6` / `#E7EEF9` | duplicate, informational notes |
| `--focus` | `#2456C8` | focus ring (2 px, 2 px offset), distinct from the accent so focus is never mistaken for selection |
| `--c1` / `--c2` / `--c3` / `--c-muted` | `#0F6B5C` / `#4E6FA6` / `#C48A2C` / `#CFD6DD` | chart series: same-semantics, other-semantics, tools, ignored |

Every text/background pair used was checked: the lowest is tertiary text on the page ground at 4.87:1; all others are above 5.3:1.

**Dark derivation.** Same token names, values remapped under `:root[data-theme="dark"]` (and `prefers-color-scheme: dark` guarded by `:root:not([data-theme="light"])`). Ground `#131A21`, surfaces `#1A2229` / `#202A32` / `#28333C`, lines `#2F3A44` / `#465360`, ink `#E6EBF0` / `#B4BDC7` / `#8B98A5`, accent lifted to `#3FA58F` with soft `#153A33` and line `#2A6B5C`, warn `#E0A93A` on `#3A2A08`, danger `#F08A83` on `#3B1512`, info `#8FB4EE` on `#15243A`, focus `#7FA4F5`, chart series lifted one step (`#3FA58F` / `#8AA6DB` / `#E0A93A`). Shadows become 1 px inner hairlines; the skeleton gradient uses surface-2/3. No component references a raw colour, so dark is a token file and one line of `color-scheme: dark`.

**Density.** Tables at 13 px with 8 px vertical padding (6 px in `compact`); stat panels and KPIs at 16–24 px padding; forms at 36 px controls. Data is dense, chrome is not.

## Component inventory

| Component | Notes | React need |
|---|---|---|
| `TopBar` | three links, current from route, demo selector removed in product | `NavLink` |
| `Route` + `Stop` (rail) | stops with `aria-current="step"`, done stops are buttons, facts as monospace children | small; state from the flow's reducer |
| `Stage` + `StageBar` | title, lede, content, Back / primary / status | plain |
| `Receipt` (`<dl class="facts">`) | label/value grid; used for file, confirm, report, session identity | plain |
| `StatRow` | hairline-divided counts with a coverage line; `na` variant renders "Unavailable" | plain |
| `KpiPanel` | four cells, help button per KPI, coverage line, exact value in `title` | plain |
| `Popover` | anchored to the help button, `role="dialog"`, closes on Escape / outside click / resize, returns focus | ~60 lines; or Floating UI later |
| `Drawer` | native `<dialog>`, right-anchored, `showModal()`, backdrop click closes, focus returns to opener | ~40 lines (already in the thin slice) |
| `DataTable` | caption, `scope="col"`, numeric class, row link, `tbl-empty` state | plain; TanStack Table not needed at 50 rows |
| `RejectsBrowser` | code `<select>`, table, payload drawer | plain |
| `OutcomeBar` + `Legend` | five outcomes, non-zero segments never thinner than 4 px | plain |
| `BarChart` | Recharts `BarChart` with `onClick` → chip; axis formatter uses abbreviations, tooltip shows exact; mockup draws the same in inline SVG with `role="button"` bars | Recharts (planned) |
| `QualityStrip` | four pill links, flagged when non-zero | plain |
| `Chip` | removable filter from a chart click | plain |
| `Dropzone` + `UploadProgress` | `<input type="file">` behind the button, `role="status"` progress | plain |
| `MappingTable` | rule rows, editable source-path cells, per-row message row (`aria-describedby`), status badge, "Accept as proposed" | controlled inputs; validation is a pure function on the DSL document |
| `Conversation` | log with `aria-live="polite"`, suggestion buttons, textarea, Enter to send | plain; streams later |
| `RedactionPanels` | Sent / Kept here | plain |
| `Skeleton`, `EmptyState`, `ErrorNote` | designed states, `role="alert"` with Retry | plain |

Nothing needs a component framework. Recharts is the one runtime dependency beyond React Router and TanStack Query.

## Screen-by-screen notes (with states)

### 1 · Import (`#/import`)
- **File.** Success: receipt with name, exact bytes, full SHA-256, format sentence, record count, "Seen before". Loading: progress panel (`role="status"`) with phase text (storing → hashing → counting) and exact byte counter. Error: danger note under the dropzone ("upload service … 413 file over 25 MiB" in product). Empty: the dropzone itself is the empty state. Duplicate: "Seen before: yes — imp_… on date" plus an info note explaining that re-import inserts nothing, with the choice to continue for the ledger.
- **Mapping.** Success: two radio cards (recommended first, reason stated, superseded badged), assistant link. Empty: "No saved mapping accepts Parquet with these columns" leads to the assistant. Loading: the dry run runs from this stop's primary button with an inline status.
- **Preview.** Success: three stat rows, rejects (table or designed none), five emissions. Error: the dry run's error replaces the stats with a note and keeps Back. Nothing written is stated in the lede.
- **Confirm.** A receipt and one button that names the count. Running: progress with exact record counter in a live region. Done: navigates to the report with a success banner. Failed: the report shows "Failed. Nothing was inserted." with the reason.

### 2 · Import report (`#/imports/:id`)
- Success: status badge + one sentence saying what happened; receipt; outcome bar; observations; warnings; rejects. Duplicate: sentence and outcome bar with all records in the duplicate segment; no observations section. Failed: sentence with the `ReaderError`, no rejects ("the reader failed before any record was evaluated"). Loading: title and receipt skeletons. Error: alert with Retry. Not found: designed empty with the id format hint.
- Rejects browser: code filter, table (locator, rule, path, code, field, reason), "Raw payload" opens a `<dialog>` with the reason, hash, locator and the payload text as stored.

### 3 · Imports history (`#/imports`)
- Success: one table, rows are links, partial/duplicate counts under accepted. Empty: "Nothing imported yet" with the primary action. Loading: skeleton rows. Error: alert with Retry.

### 4 · Dashboard (`#/dashboard`)
- Success: filters (source, agent, model, period), KPI panel (definition popover, coverage, excluded count "not zeroed"), three charts, quality strip, sessions table. Chart click → chip + filtered table; empty chip result is a designed empty with "Clear the chart selection". Empty database: KPIs show "Unavailable" with coverage 0 / 0 and the empty state below. Loading: KPI and table skeletons. Error: alert with Retry.
- The scoped view (`?import=`) says so in the lede with a link back to all imports.

### 5 · Session (`#/sessions/:id`)
- Success: monospace external id as title, identity receipt, declared vs observed with "Unavailable" designed for declared, four token measures with coverage, observation tables with "Source record" buttons, diagnostics. Source drawer: file, hash, locator, import link, `payload_text` verbatim. Loading and error as above. Not found: hint that sessions are addressed by `ses_…`.

### 6 · Mapping assistant (`#/assistant`)
- **Profile.** Column table (type, non-null, distinct, example); nothing has left the machine.
- **Send.** Two panels: Sent / Kept here; provider and token size; "Write the mapping by hand" as the alternative. Loading: waiting panel with provider and typical time. Error: provider unreachable note with the `.env` variable and the by-hand alternative.
- **Mapping.** Table with rule rows, editable source paths validated as you type (unknown column → nearest column from the profile; missing `$.` prefix), status badges OK / Open / Error, per-row explanation with "Accept as proposed" on open questions, "Validate mapping" summary line. Conversation with the intro message, three suggestion buttons, free text; replies list what they changed and edit the table (visible as a changed cell and a note). Primary button disabled while any row is in error.
- **Dry run.** Same preview component with swe-chat numbers (194 accepted, 6 partial, 0 rejected; 1,318 absent timestamps explained).
- **Save and import.** Name, source, revision (read-only "1 (new)"), note, provenance of the proposal; "Save without importing" or "Save and import 2,000 rows". Running: progress; done: report with success banner.

### 7 · Definitions (`#/definitions`)
- One table: metric, definition, unit, semantics tags, comparability. Each row has an id so popovers can deep-link.

## Accessibility notes

- Real headings: one `h1` per route (stop titles are `h1` inside the flow), `h2` for sections, `h3` in panels and popovers.
- Stepper is an `<ol>` with `aria-current="step"`; completed stops are buttons; the rail is an `<aside aria-label="Progress">`.
- Every table has a `<caption>` (visually hidden where the heading already names it) and `scope="col"` headers; numeric columns are right-aligned with tabular figures.
- Drawers are native `<dialog>` opened with `showModal()`: focus trapped, Escape closes, backdrop click closes, focus returns to the opener. Payloads are in a focusable `<pre>` so keyboard users can scroll them.
- Popovers are `role="dialog"` with `aria-expanded` on the trigger, focus moves in, Escape returns it.
- Live regions: upload, dry run and import progress are `role="status"`; the conversation log is `aria-live="polite"`; errors are `role="alert"`.
- Inline validation sets `aria-invalid` and `aria-describedby` to the message row.
- Chart bars are `role="button"` with `tabindex="0"`, an `aria-label` that reads the exact value, and Enter/Space activation; in Recharts the same is achieved with `accessibilityLayer` plus a visually hidden data table.
- Focus ring is a dedicated blue token, 2 px with offset, on every interactive element; buttons keep contrast when disabled by opacity on a still-legible base.
- `prefers-reduced-motion` disables skeleton shimmer, spinners and progress transitions.
- Responsive to 900 px: the rail becomes a horizontal strip above the stage, the conversation drops below the table, KPIs go 2 × 2, charts 2 + 1, tables scroll inside their container; the page never scrolls horizontally.

## Implementation cost in the timebox

Ships in v0.1.0 (≈ 1.5 days of UI):
- Day 1 (half day): tokens and type in `index.css`, `TopBar`, `Route`/`Stop`, `StageBar`, `Receipt`, `StatRow`, `Drawer` (exists), `DataTable`, the import flow as a four-stop reducer (`step`, `upload`, `mapping`, `preview`), report and history pages. This replaces the thin-slice pages with the same API calls.
- Day 2 (half day): dashboard with Recharts (three bar charts, click → chip), `KpiPanel` with `Popover`, quality strip, session page reusing `Receipt`/`StatRow`/`Drawer`, definitions page from the metrics endpoint.
- Day 3 (half day): assistant flow: profile table, redaction panels, `MappingTable` with validation from `/api/mappings` issues, `Conversation` on the analysis endpoints, reuse of the preview block and the confirm receipt.

Deferred: drag-and-drop styling beyond the native input, streaming replies, multi-file imports in one route (the receipt already lists files as a table), period filter server-side, popover positioning library, dark theme toggle (tokens are ready; the toggle is a `data-theme` attribute).

## Risks and trade-offs

- A stepped route slows an expert who wants everything on one page. Mitigated: the known-file path is three clicks, completed stops are clickable, and `?step=` deep links exist for support and tests.
- The rail facts compete with the stage for the eye if they grow. Rule: one line per stop, monospace, tertiary colour, and only facts that are also on the confirm receipt.
- Chart click sets a chip rather than a URL, so a drilled-down view is not shareable. Acceptable for a single analyst; adding `?day=` later is cheap.
- Inline validation in the mapping table is only as good as the profiler's column list; nested paths need the DSL's semantic validator, which the mockup approximates.
- Two flows share components but not state; a user who leaves the assistant mid-way loses the draft until drafts are persisted (day 3 stretch).

## Why this beats the other three for AgentScope, and where it loses

**Wins.** The product's promise is trust, and trust is built at the moment of commitment: the confirm receipt, the redaction stop, the "nothing is written until the last stop" line. A workbench shows everything and asks the user to find the moment; a console starts at the numbers and hides how they got there; a ledger reads well after the fact but does not help an analyst onboard an unknown Parquet file at 9 a.m. Passage puts the assistant where the owner wants it, beside a table that the user owns, with a stop that shows what leaves the machine before it leaves. It is also the cheapest to build correctly: a stop is a plain component, and the same receipt, stat row and table serve seven screens.

**Loses.** For the reviewer who checks one number a week, the console's global sticky filters and larger charts are faster; here the dashboard is a destination with modest charts. For the operator auditing dozens of imports, the ledger's footnoted document reads better than a receipt per page. And a keyboard-first power user will prefer the workbench's palette and inspector over Back/Continue.
