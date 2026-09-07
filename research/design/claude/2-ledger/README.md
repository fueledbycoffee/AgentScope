# Ledger

**Concept.** AgentScope as an auditable journal: every import is an entry, every figure is a line item with a superscript that opens its definition and coverage, and a provenance sheet walks any figure down to the bytes it came from in one numbered chain.

Open `mockup.html` from disk. Hash routes: `#/import`, `#/imports`, `#/imports/<id>`, `#/dashboard`, `#/sessions`, `#/sessions/<id>`, `#/mapping`, `#/definitions`. The "Mockup state" control at the bottom right (not part of the product) switches every screen between normal, loading, error and empty.

## Who it favours

The **reviewer checking a number** and the **operator auditing imports**. Both need the trust surfaces (definition, coverage, mapping revision, file hash, raw record) to be the primary content rather than an overlay on it. The daily analyst importing a known file is well served (four clicks, nothing decorative in the way) but is not the design's hero. The onboarding analyst gets a competent, table-centred assistant rather than a guided flow.

## Information architecture

| Route | What lives there | What is one step away |
|---|---|---|
| `#/import` | File (hash, sniff, record count, earlier imports of the same bytes), mapping, preview statement, confirm | emissions sample (`<details>`), the mapping itself (link to assistant) |
| `#/imports` | The journal: one row per attempt, date, entry, status, accepted, rejected, observations, sessions held (running balance) | per-entry body via `<details>` (hash, size, mapping id, full outcome, progress, error); the full report |
| `#/imports/<id>` | Status stamp, outcome statement (records with double-ruled total; observations), warnings, files with full SHA-256, rejects browser with code filter | reject payloads (`<details>`), dashboard, journal |
| `#/dashboard` | Scope line, four figures, three charts, quality strip, exact by-model table | scope form (popover), definitions (footnote), provenance (sheet), sessions behind any bar (link) |
| `#/sessions` | Sessions in scope or behind a chart click, with per-session exact tokens and coverage | session detail |
| `#/sessions/<id>` | Identity, declared vs observed intervals, token statement, model-call and tool-call observations, diagnostics | source record for any observation (sheet), trace from the session up to the figure (sheet) |
| `#/mapping` | Disclosure of what left the machine, field profile, proposed mapping table with inline validation, conversation, preview, save as revision, import | exact payload sent to the provider (`<details>`) |
| `#/definitions` | Every metric: definition, unit, semantics, comparability | targeted from every footnote |

## Navigation model

A running head: brand plus six section links, underlined for the current section. No sidebar, no breadcrumbs, no command palette. Movement is by reading: a figure's superscript opens a note; the note offers "Read note N below", "Trace to source" and "Definitions"; the provenance sheet links onward to the session, the mapping revision and the import entry. Every screen ends with a **Notes** section listing, in order of first use, every definition the page relied on, so the printed or exported page stays self-explanatory.

Chart bars are real links (`<a>` inside SVG) to `#/sessions?day=…`, `?model=…`, `?tool=…`; quality-strip counts link to `?issue=…`. Chart to session to source bytes is three clicks: bar, session row, "Source record".

## Disclosure model

On screen, always:

- the figure, its unit, and its coverage as "known / total calls" (Unavailable in italic when coverage is 0, never 0);
- the status of an entry and what it changed (accepted, rejected, observations, sessions held after it);
- full SHA-256 and full integers; abbreviation only inside chart labels, with the exact table directly beneath.

One deliberate step away:

- **Definitions**: superscript footnote, popover (role group, Escape closes, focus returns), plus the Notes section at the foot of the page and the Definitions route. Three routes to the same text so nobody has to remember where it is.
- **Provenance**: a right-hand `<dialog>` sheet with a six-step chain (figure, definition, contributing sessions, session, observation, source record). Opened from a figure it starts at step 1; from a session at step 4; from an observation at step 6 with steps above folded. The raw record is `payload_text` from the server, never re-serialised, with the contributing field highlighted.
- **Journal entry detail**: `<details>` per row, so the table stays scannable and keyboard-complete.
- **Rejects payloads, emissions sample, exact assistant payload**: `<details>`.
- **Scope**: a one-line sentence ("all sources, all agents, all models, June 2026") and a Change button that opens a form. Filters are not four permanent dropdowns because most sessions never change them.

Why: the owner's principle is that everything must earn its place. A statement is the format whose whole tradition is "the number, then the note". Notes are cheap on screen (a superscript) and rich when asked for.

## Visual system

**Type.** One superfamily, three cuts, all from Google Fonts: IBM Plex Serif (headings, prose, statement figures and totals), IBM Plex Sans (tables, controls, notes), IBM Plex Mono (hashes, ids, paths, raw bytes). Serif was chosen because the product reads like a document, and Plex's serif has true tabular figures at every weight. `font-variant-numeric: tabular-nums` on every figure.

Scale (px): 11, 12, 13, 14, 16, 20, 26, 34. Table body 13; UI 14; prose 15 serif at 1.6; h1 34; figures 26 serif; totals 16 serif. Line lengths capped at 66ch for prose and notes.

**Spacing.** 4, 8, 12, 16, 24, 32, 48, 72. Content column 1120 px max with 32 px margins at 1280; 24 px margins under 960.

**Colour tokens (light).**

| Token | Value | Use |
|---|---|---|
| `--paper` | #FCFCFA | page |
| `--paper-2` / `--paper-3` | #F3F3EF / #E8E8E2 | notices, raw blocks, skeletons |
| `--ink` | #191C22 | text, bars, primary button, statement rules |
| `--ink-2` | #555B66 | secondary text (6.5:1) |
| `--ink-3` | #8A8F99 | non-text marks only |
| `--rule` / `--rule-2` | #DADBD5 / #AEB0A8 | hairlines, control borders |
| `--accent` / `--accent-ink` / `--accent-wash` | #1E4B94 / #163A74 / #EDF1F8 | links, footnotes, focus, running status |
| `--good` / `--warn` / `--bad` + washes | #1D6B49 / #8A5A00 / #A4281E | status stamps, zero coverage, rejects |

All text pairs are at or above 4.5:1 on paper. Charts use ink only; colour is reserved for status so a green or red mark always means something.

**Dark derivation.** Same token names, swapped values: `--paper` #14161A, `--paper-2` #1C1F25, `--paper-3` #262A31, `--ink` #E9E9E4, `--ink-2` #A5AAB4, `--ink-3` #6E737D, `--rule` #2C3038, `--rule-2` #444952, `--accent` #8FB0E8 (7:1 on #14161A), `--good` #6FC199, `--warn` #E0B25C, `--bad` #E88A7F, washes at 12 % of each hue over `--paper-2`, `--scrim` rgba(0,0,0,.6). Bars stay `--ink`. Nothing else in the CSS references a literal colour, so the switch is a `[data-theme=dark]` block plus `prefers-color-scheme`.

**Density.** Tables at 13 px with 8 px vertical padding and horizontal hairlines only (no vertical rules, no zebra; hover tint). Numbers right-aligned; totals double-ruled in the accounting convention. Radius 3 px on controls, 0 on tables and sheets. No shadows except the popover and the sheet.

## Component inventory

Existing in the thin slice and reused: `Table` (extended into `Statement` with caption, `num` columns, total row), `JsonView` (replaced by a `Raw` block that renders `payload_text`), `ErrorNotice`, `ResourceState`, `Pagination`.

To build (React 19, no UI kit):

| Component | Notes |
|---|---|
| `DocHead` | h1, serif lede, right-aligned meta |
| `Part` | section with ruled h2 and optional aside |
| `Statement` | table with caption, sub-caption, `num` cells, `total` row |
| `Figures` | four-up KPI grid; renders `Unavailable` and zero-coverage colour from the API's `value: null` |
| `Footnote` + `NotesProvider` | context that numbers notes in order of first use per route and renders the Notes section; popover with `aria-expanded`, outside-click and Escape handling |
| `ProvenanceSheet` | `<dialog>`; props `level`, `metricKey`, `sessionId`, `rawRef`; fetches `/api/raw-records` lazily; fold/unfold per step |
| `Journal` | the imports table with `<details>` rows, progress bar with `role=progressbar`, live region for running entries |
| `Stamp` | status with dot; `running` pulses unless reduced motion |
| `Notice` | info / warn / bad / good |
| `ScopeLine` + `ScopeForm` | sentence plus popover form; URL-synced |
| `DayBars`, `HBars` | day-one inline SVG; Recharts `BarChart` on day two with `onClick` navigation and `<title>` tooltips |
| `QualityStrip` | four counts with links |
| `Drop` | file input styled as a drop zone; status line with live region |
| `MappingTable` | editable rows, `colgroup` widths, inline validation messages tied by `aria-describedby` |
| `Conversation` | log with `aria-live=polite`, textarea form |
| `MockupState` | dev-only, not shipped |

React needs: react-router for hash or history routes; TanStack Query for the resources; a tiny `useNotes` context; `dialog.showModal()` via ref (already in the thin slice).

## Screen-by-screen

**1 Import.** Empty: a single drop zone and one sentence; nothing else on the page. Loading: status line with live region ("Storing and hashing …"). Success: file facts as a definition list with full hash, an "imported before" notice linking to the earlier entry, mapping select defaulted to the only compatible bundled mapping, preview as two statements (records, observations) plus warnings and rejects sample, then a Confirm part that states the whole action in one sentence with the hash and the expected outcome (here: duplicate). Error: HTTP 413 rendered as a notice with the byte counts and what to do; the form is not lost.

**2 Import report.** Committed: green stamp, outcome statements with double-ruled totals, warnings with per-code explanations, files with full SHA-256, rejects browser with code filter and stored payloads. Duplicate: grey stamp, notice naming the entry that holds the bytes, empty observations. Failed: red stamp, the exception verbatim, what was not examined, what to do. Running: blue pulsing stamp and a progress bar; the report says "so far". Loading: skeleton statement. Error: not-found notice with a retry.

**3 Imports history.** The journal. Empty: "No imports yet" with a single action. Loading: skeleton rows. Error: notice. Success: rows with a running "Sessions held" balance so an auditor can read what the database contained after each entry; rejected counts in red, zeroes greyed.

**4 Dashboard.** Empty: one sentence and one action. Loading: skeleton. Error: the API's `invalid_input` detail shown verbatim. Success: scope sentence, four figures (with the codex scope demonstrating "Unavailable, coverage 0 / 402"), three ink-only charts whose bars are links, quality strip with amber counts linking to affected sessions, exact by-model table under the abbreviated chart.

**5 Session detail.** Identity list; intervals table putting declared and observed side by side and flagging a reversed declared interval; token statement with coverage per measure; observation tables with a "Source record" button per row; diagnostics table. Loading: skeleton. Error: not-found. Empty tables: one sentence each ("This session recorded no tool calls").

**6 Mapping assistant.** Disclosure notice first (what left the machine, to whom, when, with the exact payload one step away). Field profile. Proposed mapping as an editable table with per-row why and an "Ambiguous" mark; one row invalid until the timestamp unit is chosen, at which point Preview, Save and Import unlock. Conversation as a sticky side column (stacks under 1100 px); replies never write. Empty: no file. Loading: profile skeleton. Error: assistant timeout, with the point made that validation and preview keep working without it.

**7 Definitions.** One table; the same text the footnotes use, so the two cannot drift.

## Accessibility

Real heading order (h1 per route, h2 per part, h3 in figures and chain). Tables have captions (visually hidden where the heading already names them) and `scope` on headers. Drawer is `<dialog>` with `showModal`, backdrop click and Escape close, focus returned to the opener. Footnotes are `<button aria-expanded>`; the popover is `role=group` with a label; Escape closes and refocuses. Live region announces route loads, filter changes, copies and the sheet opening. Progress uses `role=progressbar`. SVG bars are `<a>` elements with `aria-label` and `<title>`, so they are tabbable and named. Focus is a 2 px accent ring with 2 px offset everywhere; `main` is focused on route change without a ring. Reduced motion disables the sheet slide, the pulse and the simulated delays. Colour never carries meaning alone (stamps have words; zero coverage is written out).

## Implementation cost in the timebox

Ships in v0.1.0 (about 1.5 days of UI): tokens and type; `DocHead`, `Part`, `Statement`, `Figures`, `Notice`, `Stamp`, `Journal`, `Footnote`/Notes, `ProvenanceSheet` (levels session and observation), import flow, report with rejects, dashboard with Recharts bars and click-through, sessions list and detail, definitions route. Most of it is markup and CSS over data the API already returns.

Deferred: provenance level "figure" (needs a metric-to-sessions endpoint), running-import live updates (needs polling or SSE), the mapping assistant's conversation and inline validation are day-3 work by plan and reuse `MappingTable` and `Notice`, dark theme block (tokens are ready; a half day to verify contrast), print stylesheet.

## Risks and trade-offs

- Serif figures and a document column read as calm but can feel slow to an analyst who wants a wall of numbers; density is carried by tables, not by cramming the page.
- Footnote numbering per route means the same note can be ¹ on one page and ⁴ on another; the popover title and the Definitions route make the number secondary.
- The journal's running balance is derived (sessions after each commit); it must be computed server-side at commit time and stored on the import row, or omitted.
- Charts as links to filtered session lists requires the sessions endpoint to accept `day`, `model` and `tool` filters, which the v0.1 contract does not yet have; day two adds them.
- The provenance chain's step 3 (contributing sessions) is a real query and is the one piece that is easy to promise and slow to build.

## Why this beats the other three for AgentScope, and where it loses

The product's promise is trust, and trust is a documentary property: a definition next to a number, a hash next to a file, an entry that stays in the book after it failed. Ledger makes those the content. Workbench puts them in an inspector, Console under a tooltip, Guided in a later step; in each the figure is on stage and its provenance is backstage. Ledger also costs the least: it is tables, rules and type, with one dialog and one popover, no palette, no split panes, no stepper state machine.

It loses to Workbench for a power user who lives in the tool all day and wants keyboard-first navigation and an always-visible inspector. It loses to Console when the primary job becomes monitoring many imports over time with sticky global filters. It loses to Guided for the onboarding job specifically: the assistant screen here is a competent table with a side conversation, not a walk-through, and a first-time user of the DSL would get more help from a stepped flow.
