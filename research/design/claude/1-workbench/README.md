# Workbench

One workspace, three panes: a navigation rail, a work area that shows only the task, and an inspector that holds everything a number needs to be trusted (definition, coverage, provenance, raw bytes), always exactly one keystroke away.

Open `mockup.html` from disk. Screens 1 to 7 are routed by hash (`#/import`, `#/imports`, `#/imports/:id`, `#/dashboard`, `#/sessions`, `#/sessions/:id`, `#/assistant`, `#/definitions`). Press `?` for the keyboard map, `⌘K` for the command palette, `i` for the inspector. The "States" menu in the top bar switches any screen to its loading, empty or error state.

## Who it favours

The analyst who does this every day (job 1) and the reviewer chasing a number (job 3). Both want zero ceremony and a short, predictable path: land on the dashboard, filter with the keyboard, select a figure, read its definition and coverage in the inspector, jump to the contributing sessions, open a call, open its source bytes. Four keystrokes, no page reloads, nothing moves.

It serves job 2 (onboarding an unknown file) through the same mechanism: the mapping table is the work, the assistant's reasoning and the conversation live in the inspector next to it. It serves job 4 (audit) adequately but not lovingly: the ledger is a dense table with an honest row per attempt, not a document.

## Information architecture

| Route | Lives there | Reached by |
|---|---|---|
| `#/import` | Drop zone, then in place: file line (name, bytes, sniffed format, record count, hash), "seen before" notice, mapping select, preview strip and tabs (emissions, rejects, warnings), confirm block, run progress | rail `g i`, palette |
| `#/imports` | Ledger of attempts: status, source, file, mapping revision, records, rejected, entity counts, started | rail `g h` |
| `#/imports/:id` | Report: status and lede, outcome strip (accepted, partial, duplicate, rejected, ignored), entity and warning strip, files with full SHA-256, rejects browser with code chips | ledger row, import run, palette by id |
| `#/dashboard` | Scope filters, four KPIs, quality strip, three charts, sessions table | rail `g d` |
| `#/sessions` | Same screen, scrolled to and focused on the sessions table | rail `g s` |
| `#/sessions/:id` | Identity strip, diagnostics notice, model-call table, tool-call table; source-record drawer | table row `Enter`, chart, palette by id |
| `#/assistant` | Field profile, proposed mapping table (editable); explanations, ambiguities and the conversation in the inspector | rail `g m`, report of a failed parquet import, empty import state |
| `#/definitions` | Every metric: definition, unit, semantics tags, comparability | rail `g f`, quality strip, KPI inspector |

The rail is the only global navigation. There is no dashboard-per-import route; the report's "Open in dashboard" sets the scope to that import's source. Sessions are not a top-level entity with their own list page: they are the bottom of the dashboard, because every session list is a scoped list.

## Navigation model

- **Rail** (208 px, collapses to 52 px icons under 1180 px): two groups, Import and Analyse. Active route highlighted; chord hints appear on hover.
- **Command palette** (`⌘K` / `Ctrl K`): go to any route, run scoped actions ("Filter dashboard: agent codex"), open any import or session by id or external id, switch demo states. `>` restricts to actions. Arrow keys, `Enter`, `Esc`.
- **Chords**: `g` then `i h d s m f`. Linear's model; no modifier, no conflicts with typing because chords are ignored inside inputs.
- **Tables**: `j` `k` move the selected row and update the inspector, `Enter` opens the row, `o` opens the source record of a model or tool call.
- **Dashboard**: `1` to `4` select a KPI, `/` focuses the first filter, `Esc` clears a chart selection.
- **Breadcrumb** in the top bar names where you are and, on the dashboard, the scope in words.

Everything the mouse can do, the keyboard can do, and the reverse. Nothing is keyboard-only.

## Disclosure model

The owner's rule, applied literally: the work area carries the task; the inspector carries the trust; the drawer carries the bytes.

| On screen (always) | One step away (where) | Why |
|---|---|---|
| Exact values: every KPI, count and token sum as a full integer with thousands separators | Definition, unit, coverage per semantics tag, comparability, contributing sessions (inspector, on KPI select or `1`-`4`) | The number is the task; the reason to believe it is a question you ask, once |
| Coverage as a fraction and a 2 px gauge under each token KPI and in every session row | Which calls are unknown and why (quality strip links, inspector) | Coverage is what makes a sum honest, so it is never hidden; the detail is not needed to read the number |
| Quality strip: rejects, calls without usage, unknown timestamps, unlinked tool calls | The rejects browser of the import in scope; definitions | Four counts tell you whether to trust the dashboard; the evidence is one click |
| Charts with abbreviated axes | Exact value in a tooltip and in the inspector on select | Abbreviation is allowed only with the exact value one hover away |
| Session identity strip; declared vs observed interval; input tokens with coverage | Provenance (import, file hash, mapping revision), interval as ISO text (inspector) | Identity is what you scan; provenance is what you verify |
| Locator under every call id | Source record drawer (`<dialog>`) with file hash, locator, contributing entities and `payload_text` verbatim | The path from row to bytes is one click and never a dead end |
| Rejects table: locator, rule, path, code, message | Raw payload and a suggested fix (inspector on row select) | The message is enough to triage; the payload is enough to fix |
| Mapping table: target, path, transform, null policy, confidence | Why the assistant chose it, its ambiguity, sample values, the conversation (inspector) | The table is the artefact you edit; the explanation is context you read on demand |
| "What left this machine" button on the assistant screen | Popover listing exactly what was sent and what was excluded | The redaction is a promise; it must be readable, not prominent |
| Import: file line and "seen before" notice appear only after a file is dropped; preview only after a mapping is chosen; confirm only after a preview ran | Mapping document (inspector, "Show mapping"); first decoded record (inspector on file) | A flat page that grows in place, not a wizard: no step you cannot see, no step shown before it exists |

The inspector is closed until something is selected and opens itself on first selection; `i` toggles it; under 1000 px it overlays instead of squeezing. The work area is a CSS container, so opening the inspector reflows KPIs, charts and strips exactly as a narrower window would.

## Visual system

**Type.** IBM Plex Sans for the interface with tabular figures everywhere (`font-variant-numeric: tabular-nums` on `body`); IBM Plex Mono only for literal machine values: ids, hashes, locators, paths, JSON. Scale (px / line height): 11/16 micro (table headers, coverage lines, hints), 12/18 small (table cells, labels), 13/20 body, 14/20 emphasis, 16/22 h2, 20/26 h1, 26/32 KPI numerals (22/28 when the work area is under 860 px). Weights 400, 500, 600. Headline letter-spacing −0.01 em, numerals −0.02 em.

**Spacing.** 2, 4, 6, 8, 12, 16, 20, 24, 32, 48 as `--s-1` to `--s-10`. Row height 28 px for controls, 24 px for small controls; table rows 30 px at rest.

**Radii.** 3 px for controls, chips and inputs; 6 px for panels and dialogs. Nothing else is rounded.

**Colour tokens (light, design of record).**

| Token | Value | Use |
|---|---|---|
| `--canvas` | `#F3F4F6` | app ground |
| `--surface` / `--surface-2` / `--surface-3` | `#FFFFFF` / `#F7F8FA` / `#EEF0F3` | panels / table heads, insets / tags, skeletons |
| `--line` / `--line-strong` | `#E2E5EA` / `#C6CCD5` | rules / control borders |
| `--ink` / `--ink-2` / `--ink-3` | `#15181D` / `#4B5563` / `#6B7280` | text / secondary / tertiary (all AA on surface) |
| `--accent` / `--accent-ink` / `--accent-soft` / `--select` | `#0E6B7F` / `#0A5364` / `#E3F1F4` / `#ECF5F7` | links, primary button, selection |
| `--ok` / `--warn` / `--danger` (+ `-soft`) | `#1B7A45` / `#8A5A00` / `#B42318` | committed / partial, warnings, Unavailable-by-policy / rejects, failed |
| `--series-1` / `-2` / `-3` / `-muted` | `#0E6B7F` / `#6FB3C4` / `#8C6A2F` / `#B9C0CA` | charts: claude semantics, second claude model, codex/openai semantics, unselected |
| `--focus` | `#0E6B7F` | 2 px ring, 2 px offset |

No shadows, no gradients. Hierarchy comes from surface layering and 1 px rules. Status is carried by a pill with a dot, never by colour alone.

**Dark derivation.** Same token names, values flipped, nothing else changes; a draft set is included under `:root[data-theme="dark"]` and can be previewed from the States menu. Rules: canvas darkest (`#0F1216`), surfaces step lighter (`#161A20`, `#1B2028`, `#222833`); lines lighten (`#2A313B`, `#3C4552`); ink inverts (`#E6E9EE`, `#A9B2BE`, `#8A94A2`); accent and status hues brighten two steps so they keep AA on dark surfaces (`#5FB6CB`, `#57B47C`, `#D9A54A`, `#F08A80`); soft tints become 12 to 16 % of the hue over surface; chart series shift the same way with the muted series darkening. Tooltips already use `--ink` on `--ink-inverse`, so they invert for free. Final dark values need a contrast pass before shipping; the structure needs none.

**Density.** 13 px base and 12 px tables; 50-row pages; six-cell strips instead of cards; four KPIs in one ruled row. Density is spent on data and withheld from chrome: the top bar is 44 px with one search field and three quiet buttons.

## Component inventory

What React needs, in build order. Nothing requires a component library; Recharts replaces the inline SVG.

| Component | Notes |
|---|---|
| `AppFrame` | CSS grid with `data-inspector` state; container query on the work area; rail collapse and inspector overlay at breakpoints |
| `Rail`, `TopBar`, `Breadcrumb` | `aria-current`, chord hints |
| `CommandPalette` | `<dialog>`, combobox semantics, item groups, id search over a small client index (imports and the current sessions page) |
| `Inspector` | Discriminated union of contexts (`page`, `file`, `mapping`, `report`, `importrow`, `reject`, `kpi`, `bar`, `sessionrow`, `session`, `call`, `diag`, `mapfield`, `definition`, `preview`); one `<aside>` with a heading and sections |
| `SourceDrawer` | `<dialog>` right drawer; renders `payload_text` verbatim; returns focus to the opener |
| `Shortcuts` | `<dialog>` with a `<dl>` per group |
| `Strip`, `KpiRow`, `Gauge` | Ruled count strips; KPI with heading-button, exact numeral, coverage fraction and gauge; `Unavailable` state |
| `QualityStrip` | Four counts with links |
| `DataTable` | Caption with meta, sticky head, numeric alignment, `tabindex` rows, `aria-selected`, roving `j`/`k`, row double-click open; scrolls in its own wrapper |
| `Notice` | Info / warn / danger / ok; `role="alert"` for errors, `role="note"` otherwise |
| `Tabs` | Roving tabindex, arrow keys |
| `Charts` | Recharts `BarChart` for days and tools, horizontal `BarChart` for models; `onClick` on bars drives scope and the sessions list; tooltips show exact integers; `aria-label` on each bar |
| `ImportFlow` | Drop zone, file line, mapping select, preview strip and tabs, confirm block, progress with `aria-live` |
| `RejectsBrowser` | Code chips as `aria-pressed` toggles; row select to inspector |
| `MappingTable` | Editable path inputs with `aria-invalid`, policy selects, confidence bar, status glyph; validation against the profile on change |
| `ProfileList` | Selectable `<li>`s; redacted columns marked |
| `Conversation` | Messages and a textarea; `Enter` sends, `Shift Enter` newlines |
| `DemoStates` | Dev-only menu; removed from the production build |

Shared hooks: `useHashRoute`, `useKeyChords`, `useRovingRows`, `useInspector` (context), `useScope` (filters in the URL query so a scope is a shareable link).

## Screens

### 1. Import
- **Success**: drop or pick, the file line appears in place with bytes, sniffed format, record count and short hash (full hash and first record in the inspector). "Seen before" is a panel footer, not a modal: it names the earlier import and says what re-importing does. Mapping select filtered to the sniffed format. Preview runs with a progress bar and a live region, then the outcome strip and the three tabs. Confirm block states records, file, source, full SHA-256, mapping id and revision, and the transaction guarantee; the button is "Import 4,770 records". Run replaces the block with a progress panel and navigates to the report on commit.
- **Empty** (no mapping for this format): info notice pointing to the assistant; the file stays stored.
- **Loading**: skeleton lines in the file panel while hashing and counting.
- **Error**: 413 over 25 MiB explained with the reason for the limit and the fix.

### 2. Import report
- **Success**: status pill and lede in one sentence (file, source, mapping revision, commit time, duration). Outcome strip: source records, accepted, partial, duplicate, rejected, ignored; zeros are dimmed, partial is amber, rejected is red. Second strip: sessions, model calls, tool calls, one cell per warning code with its meaning. Files table with the full SHA-256 wrapped, never truncated. Rejects browser: chips per code, rows select into the inspector with raw payload and a fix.
- **Duplicate**: same layout, all records counted as duplicate, a note explaining byte-level detection and linking the original.
- **Failed**: danger notice with the `ExceptionType: reason` string and a next action; strips show zero; rejects empty state explains that no rule ran.
- **Empty** (rejects): "No record was rejected" with the distinction between warnings and rejects.
- **Loading**: a running import with progress, applied count, rejected-so-far and a live region.
- **Error**: 404 with the id and a way back.

### 3. Imports history
- **Success**: one row per attempt, newest first, status pill, short id with the full id on hover and in the inspector, mapping revision, records, rejected in red when non-zero, entity counts (dash when nothing was inserted), started to the minute. Footer counts by status. Row select fills the inspector with files, hash, revision, error, duplicate-of.
- **Empty**: "No imports yet" with the import button and the promise that attempts that insert nothing are still listed.
- **Loading**: skeleton rows. **Error**: network failure with host and a retry.

### 4. Dashboard
- **Success**: filters as four selects (source, agent, model, period). KPIs in one ruled row, exact integers, coverage fraction and gauge; a KPI with coverage 0 reads "Unavailable" in a lighter weight. Quality strip below. Three charts: model calls by day (click a bar to list that day's sessions), input tokens by model (click to scope to the model), tool calls by tool (click to list sessions that used it). A chart selection is a chip above the KPIs and a note in the sessions caption; it narrows the list, not the KPIs, and `Esc` clears it. Sessions table with coverage per row. Every KPI, bar and row selects into the inspector; "Sessions contributing" scrolls to and focuses the table.
- **Empty**: counts read 0, sums read Unavailable with "coverage 0 / 0 calls", and the sessions panel explains the impossible combination (codex with claude-opus-4-7) and offers to clear the filter. This is the real behaviour of the filters, not only a demo.
- **Loading**: KPI skeletons with labels kept, one status line. **Error**: 400 `invalid_input` quoting the offending filter value and the exactness rule.

### 5. Session detail
- **Success**: strip with source (import id), agent (with its origin), repository and user, observed interval as a duration with the exact bounds, declared interval as Unavailable with the reason, input tokens with coverage and semantics. Diagnostics as a warning notice quoting both records; "Show both records" opens them in the inspector with one-click drawers. Model-call and tool-call tables with the locator under each id; `o` on a selected row opens the drawer. Cache read is Unavailable for codex semantics, shown as text, never as 0.
- **Source record drawer**: file name and full hash, locator, contributing entities and mapping revision, a copy button, and `payload_text` verbatim including a `trace_key` above 2⁵³ that a re-serialised JSON would have rounded.
- **Empty**: a session whose observations were all rejected, linking to the rejects. **Loading**: skeleton strip. **Error**: 404.

### 6. Mapping assistant
- **Success**: the file profile (12 columns with type, null and distinct counts, value distribution, redaction marks) beside the mapping table (11 fields across 3 rules with status glyph, target, editable path, transform, null-policy select, confidence). Selecting a field puts its explanation, ambiguity, sample values and the conversation in the inspector; three ambiguities are marked and each has a proposed resolution. Editing a path revalidates against the profile with a "did you mean" suggestion and disables Preview and Save while errors exist. The conversation accepts free text; a reply that changes a row updates the table and clears the ambiguity. "What left this machine" is a popover listing exactly what was sent, what was masked, what was excluded, and the request's token cost. Validate reports errors and open ambiguities; Preview puts sampled outcomes and rejects in the inspector; Save turns the draft pill into the revision id and offers the import.
- **Empty**: profile ready, no proposal; two actions (propose, start empty).
- **Loading**: "Proposing" panel naming the provider and the redaction, with the repair-attempt rule.
- **Error**: `provider_malformed` after two attempts, where the raw responses are kept, and the three ways forward.

### 7. Definitions
- **Success**: one table, eight metrics, definition, unit, semantics tags, comparability rule. Selecting a row shows which sources in the workspace can report the metric.
- **Empty**: explains that an empty registry means a build without the metric module. **Loading** and **error** as elsewhere.

## Accessibility

- Landmarks: `nav` (rail, breadcrumb), `header`, `main` with a skip link, `aside` inspector labelled by its heading. One `h1` per screen, `h2` per panel or chart, `h3` in the inspector sections.
- Every table has a `<caption>` (visually hidden where the panel head already names it), `scope="col"`, numeric columns right-aligned with tabular figures.
- Drawers and modals are `<dialog>` with `showModal`, focus returned to the opener on close, backdrop click and `Esc` close.
- Rows are focusable with `aria-selected`; the roving `j`/`k` never traps focus. Tabs use `role="tab"` with arrow keys. Chips are `aria-pressed`. KPI tiles are a heading containing a button, not a button containing a heading.
- Charts: each bar is a focusable `role="button"` with an `aria-label` carrying the exact value; the SVG has a `<title>`; the tooltip also appears on focus.
- Live regions: one polite region for progress, previews, validation results and scope changes; error notices are `role="alert"`.
- Contrast: all ink tokens are at least 4.8:1 on white; the amber and red are used for text only on their soft tints or white; focus ring 2 px with offset, visible on the accent button by the offset.
- `prefers-reduced-motion` disables the two animations (running dot, skeleton sheen).
- Nothing relies on hover: every hover state has a select or focus equivalent.

## Implementation cost in the timebox

**Ships in v0.1.0** (about 1.5 days of UI): AppFrame with rail, top bar and inspector; hash routes for screens 1 to 5 and 7; DataTable with roving rows; Strip and KPI row; Recharts with click-to-scope; source drawer; notices and the four states per screen; command palette with go-to and id lookup. The thin slice already has the API for all of it; the metrics summary needs `output_tokens` and per-day, per-model and per-tool series, which the day-2 metric layer plans.

**Ships day 3**: the assistant screen (profile list, mapping table, inspector conversation, redaction popover). It reuses the table, inspector and notice components; the new work is the editable row and the validation call.

**Deferred**: persisted inspector width; palette search over all sessions server-side (v0.1 searches the loaded page and exact ids); saved scopes; dark theme final values; per-user shortcut remapping; the "Show mapping" inspector view for a mapping's full DSL document (v0.1 shows the summary only).

Cost drivers to watch: the inspector context union grows with every screen (keep it a plain switch over a typed union, not a plugin system); keyboard handling must stay in one hook to avoid conflicts; container queries need no polyfill on the supported browsers.

## Risks and trade-offs

- **Three panes at 1280 px are tight.** The work area drops to 696 px with the inspector open; tables then scroll inside their panel. Mitigated by the container query (KPIs and charts reflow), by moving locators under ids, and by the inspector closing by default. Still, a 1280 px laptop user will toggle `i` often.
- **Learned interface.** Chords, `j`/`k`, `o` and the palette reward the daily user and are invisible to a first-time reviewer. Mitigated by hover hints on the rail, kbd hints in captions, and the `?` map; but the first session will be mouse-driven, and it must work fully that way (it does).
- **The inspector can become a junk drawer.** Every screen will want to put something there. The rule is fixed here: definition, coverage, provenance, explanation, and nothing that the task itself needs.
- **Chart selection semantics.** A bar narrows the sessions list but not the KPIs; the model bar changes the scope. This asymmetry is deliberate (the model is a filter; a day is a selection) but must be documented in the UI, which the chip wording does.
- **Demo-state toggle** is a mock device; the shipped app derives states from query status.

## Why this beats the other three for AgentScope, and where it loses

**Beats Ledger** for jobs 1 and 3: the ledger's document form reads well but is slow to operate; the workbench turns "check a number" into a keystroke sequence and keeps the chart, the list and the bytes on one screen. **Loses** to Ledger on job 4 and on calm: an auditor reading an import report as a footnoted statement gets a better narrative than a strip and a table.

**Beats Console** on trust surfaces: the console leads with charts and makes definitions a secondary route; here no number is ever further than one keystroke from its definition and coverage, and the quality strip sits between the KPIs and the charts, where it interrupts a wrong reading. **Loses** to Console on monitoring rhythm: sticky global filters and drill-down as the only motion are simpler to learn for someone who only ever looks at the dashboard.

**Beats Guided** for the daily import: no steps to click through when nothing is wrong; the import page grows in place and the confirm block is the only ceremony. **Loses** to Guided on job 2 the first time: a stepped onboarding with the conversation as the main event holds a newcomer's hand better than a table with an inspector, and the mapping assistant is the one screen where hand-holding pays.

The workbench wins if AgentScope is used the way the brief describes: by one analyst or a small team, often, on data they are accountable for. It loses if the primary audience is occasional readers of a report.
