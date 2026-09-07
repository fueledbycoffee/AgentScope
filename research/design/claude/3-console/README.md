# Variant 3 — Console

**Name.** Console.

**Concept.** One sticky scope bar is the spine of the app: every number on every data screen is computed under it, and drilling down (chart click, quality counter, KPI) is the same mechanism as filtering, because a drill simply appends a chip to that bar. KPIs and charts lead; the path from a suspicious number to the exact source bytes is scope → sessions → session → source record, three clicks, no dead end.

**Who it favours.** Job 3 (reviewer checking a number) first, job 1 (daily import of a known dataset) second. Job 4 (operator) gets an honest ledger with the same components. Job 2 (onboarding an unknown file) is served but not flattered: the assistant is a split-pane screen off the import flow, not the centre of the product.

References: Plausible for the calm single-page overview with a visible scope, Grafana for the global, sticky selector that everything obeys, Vercel analytics for tabular numerals and quiet chrome.

## Information architecture

| Route | What lives there | Bar above it |
|---|---|---|
| `#/overview` | Four KPIs, three charts, quality strip, first eight sessions in scope | Scope bar |
| `#/sessions` | Full session list under scope; the drill target of every chart click and quality counter | Scope bar (with drill chips) |
| `#/sessions/:id` | Identity, interval (declared vs observed), tokens with coverage, model-call and tool-call observations, diagnostics, Source record drawer | Scope bar (context kept; not applied to the detail) |
| `#/imports` | Ledger of every attempt: running, committed, duplicate, failed | File bar (scope does not apply) |
| `#/imports/:id` | Import report: status lead, record outcomes, entities, warnings, files with SHA-256, rejects browser with code filter and raw payload drawer | File bar showing import id, source, mapping revision, start |
| `#/import` | Four disclosure steps on one page: File, Mapping, Preview, Confirm and run | File bar showing file, hash, records, chosen mapping |
| `#/assistant` | Field profile, redaction disclosure, proposed mapping table with inline validation, conversation pane, validate → preview → save → import | File bar showing file, excerpt size, provider and model, "What leaves this machine" |
| `#/mappings` | Mapping revisions (secondary) | File bar |
| `#/definitions` | Every metric: definition, unit, semantics tags, comparability | File bar |

Session detail keeps the scope bar so the analyst can go back to the list without losing where they came from. Import and assistant replace it with a file-identity bar because scope has no meaning there; the same 52 px slot is used so the frame does not jump.

## Navigation model

- A 48 px rail with five routes (Overview, Sessions, Imports, Mappings, Definitions) and one primary action, Import. No sidebar; there is nothing to put in one.
- The scope bar (52 px, sticky under the rail) holds four selects (Source, Agent, Model, Period), drill chips, Clear, and the scope receipt: `80 sessions · 4,770 model calls · from 1 import`. The receipt is what makes the numbers trustworthy at a glance; it is recomputed on every change and announced through `aria-live`.
- Drill-down is chip-based: a bar in *Activity by day* appends `day 2026-06-04` and opens Sessions; a bar in *Tokens by model* sets the Model select; a bar in *Tool calls* appends `tool Bash`; a quality counter appends `quality missing usage`. Removing the chip returns to the previous scope. There is one mechanism for filtering and drilling, so there is one thing to learn.
- Rows are links; the whole row is clickable, the id is a real anchor for keyboard and middle-click.
- Hash routing in the mockup; React Router in the build. Scope lives in the URL query so a screen can be shared and reloaded.

## Disclosure model

On screen by default, because the task needs it:

- Overview: four KPI values with a one-line coverage fraction, three charts, one quality line, eight sessions. Nothing else.
- Sessions: the table.
- Session: identity, interval, tokens, the two observation tables, and diagnostics only if there are any.
- Import: the current step expanded; finished steps collapse to a one-line receipt in their header (`tracelab-sample.jsonl.gz · jsonl (gzip) · 681,057 bytes · 4,770 records`).
- Report: status lead, three count panels, files, rejects.

One deliberate step away:

- Definition, unit, exact value, coverage, semantics breakdown, cache tokens: popover on the `i` beside a KPI label (a `<button aria-expanded>`, Escape closes, focus returns).
- Exact value of an abbreviated KPI: printed under the value in small type (`exact 553,447,877`), so nothing is hidden behind hover. Abbreviation only above 99,999.
- Quality details and the "list these sessions" action: the strip expands in place.
- Source bytes: `<dialog>` drawer from any observation row, with file, SHA-256, locator, mapping revision, and `payload_text` verbatim.
- Reject payload: `<dialog>` drawer with the offending path highlighted.
- First decoded records and emissions sample on Import: `<details>`.
- What leaves the machine for the assistant: drawer with sent / not sent lists and the exact payload.
- Everything about mappings and definitions: their own routes.

Why: the four jobs start from a number or from a file, never from a definition or a hash. Definitions and hashes must be reachable in one step from the number they qualify, and they are; they must not compete with it.

## Visual system

**Type.** Geist for UI, Geist Mono for ids, hashes, locators, paths and raw JSON only. Scale (px): 11 / 12 / 13 body / 14 / 16 / 20 h1 / 28 KPI / 36 reserved. Weights 400 and 500 only, 600 for the brand. Every number is set with `font-variant-numeric: tabular-nums` (`tnum`) so columns and KPIs line up when scope changes. Body line-height 1.45, KPIs 1.1.

**Spacing.** 4-based: 4 / 8 / 12 / 16 / 24 / 32 / 48. Panels pad 14, table cells 12, rows 36 px high. Radii 4 / 6 / 10 (controls / buttons and chips / panels).

**Colour tokens, light.**

| Token | Value | Use |
|---|---|---|
| `--bg` | `#F4F5F7` | page |
| `--surface`, `--surface-2`, `--surface-3` | `#FFFFFF`, `#F8F9FB`, `#EEF0F3` | panels, table heads and hover, skeletons |
| `--line`, `--line-strong` | `#E2E5E9`, `#C6CCD4` | rules, control borders |
| `--ink`, `--ink-2`, `--ink-3`, `--ink-4` | `#171A1F`, `#3F4753`, `#5F6B7A`, `#63707E` | text ramp; ink-4 is the lowest allowed for text (4.5:1 on white) |
| `--accent`, `--accent-ink`, `--accent-soft`, `--accent-line` | `#1D5BD6`, `#1A4FBB`, `#E8EFFC`, `#B7CBF5` | links, active scope, chips |
| `--s1` … `--s5` | `#1D5BD6`, `#0E8C7F`, `#B9730A`, `#7C8794`, `#6A4FC9` | chart series (blue, teal, amber, slate, violet) |
| `--ok`, `--warn`, `--bad` (+ `-soft`) | `#157A46`, `#9A6200`, `#B42318` | status pills, notices, quality dots |
| `--focus` | `#1D5BD6` | 2 px outline, 2 px offset |

Contrast measured: ink-3 5.4:1, ink-4 5.1:1, accent-ink 7.3:1 on white; status text on its soft background 4.5 to 5.6:1; chart fills 4.1 to 6:1 against white (graphics need 3:1). No gradients, no shadows except popover and drawer.

**Dark derivation.** The same token names are redefined under `[data-theme="dark"]` (the mockup's Dark button does exactly this). Surfaces invert as a ramp (`#0E1013 / #15181D / #1A1E24 / #22272F`), ink ramp inverts (`#E7EAEE / #C2C8D0 / #98A1AD / #8C95A2`), hue is kept and lightness raised for accent, series and status (`#6E9BFF`, `#3FBFAE`, `#E5A340`, `#4CC27F`, `#E5B04A`, `#F27466`), soft backgrounds become dark tints of the same hue. Charts read fills from tokens (`fill: var(--s1)`), so they follow without code. `color-scheme` is set on both so native controls match. Measured dark contrast: ink-3 6.8:1, accent 8.3:1, status text 5.6 to 7.2:1.

**Density.** Data is dense (13 px tables, 36 px rows, 8-column session table at 1280); chrome is not (one rail, one bar, no card shadows, no icons except the `i` definition button and the chip ×).

## Component inventory

| Component | Notes | React |
|---|---|---|
| ScopeBar | four selects, chips, receipt; state in URL search params | small; `useSearchParams`, one `Scope` context read by every query |
| FileBar | replaces ScopeBar on non-data routes | trivial |
| KpiCard | value, coverage dot and fraction, `Unavailable` when coverage is 0, `exact` line when abbreviated, definition button | trivial |
| Popover | anchored, `aria-expanded`, Escape and outside click, focus return | ~60 lines or Radix Popover; no need for a kit |
| DayBars, HBars | inline SVG in the mockup; Recharts `BarChart` in the build with `onClick` on bars and a custom `Tooltip`; the keyboard path (bars as `role=button`, focus hint line under the chart) must be reproduced with Recharts' `tabIndex` on `Bar` shapes or a visually-hidden data table | Recharts, a day of care |
| QualityStrip | four counters, one expanding detail, chip action | trivial |
| DataTable | caption with count, sticky head, right-aligned numeric columns, row link, footer pagination | one component; TanStack Table not needed at this size |
| Drawer | `<dialog>` with `showModal`, header, scrolling body, Escape, backdrop click | exists in the thin slice, restyle |
| JsonText | renders `payload_text` verbatim with light colouring and one highlighted span | trivial; never re-serialise `payload` |
| StatusPill, Notice, StateBlock (loading, empty, error), Skeleton | shared | trivial |
| ImportSteps | four disclosure sections with header receipts; progress bar with `role=progressbar` and a live region | half a day |
| MappingTable | editable path and transform cells, inline errors with a "did you mean" fix, ambiguity notes | a day with validation wiring |
| Chat | list with `aria-live`, textarea, submit | trivial UI; the work is in the backend |

## Screen-by-screen

**1. Import.** Step 1 is a drop zone (real `<input type=file>` behind a label). After upload: one-line receipt in the header, SHA-256, sniff result (`jsonl, gzip, 4,770 records`), a warning notice when the same bytes were imported before with links to both attempts, and the first decoded records behind `details`, each openable in a drawer. Step 2 lists mappings that read the sniffed format as radio cards with a one-sentence description, plus "Ask the assistant"; when no mapping reads the format (parquet) the step says so and the assistant is the primary action. Step 3 previews 200 records without writing: sampled/accepted/rejected, entities, warnings, emissions sample behind `details`. Step 4 is a confirm receipt that repeats records, file, source, mapping revision, file hash and mapping id, states the expected outcome (`duplicate, nothing inserted`) when applicable, then one button; running shows a progress bar and a live count, then navigates to the report.
States: empty is the drop zone; loading is the progress bar with `aria-live`; error (413 over 25 MiB, 409 race) is a `notice bad` inside the step with the fix and the upload kept.

**2. Import report.** A status lead in the product's voice: committed (`Committed in 27 s. 4,770 of 4,770 records accepted, 0 rejected. Open the overview scoped to this import.`), duplicate (points at the original import), failed (the exact error, `nothing inserted`, and the next action), running (progress bar and live count). Three count panels: source-record outcomes (five, zeros muted), entities, warnings with an `i` explaining `absent` vs `null`. Files table with the full SHA-256 and mapping id. Rejects panel: code select with counts, table, `Raw payload` drawer with the offending value highlighted and a "Fix in mapping assistant" action. Empty rejects is a sentence, not an empty table.

**3. Imports.** One table, newest first: id, status pill, source, file, mapping revision, records, sessions, model calls, rejected (red when non-zero), started. Dashes for entities on duplicate and failed rows, never zeros. Empty: "No imports yet" with the Import action. Loading: skeleton rows. Error: the error block with retry.

**4. Overview.** Four KPI cards: Sessions (with the number of imports in scope), Model calls (with tool calls), Input tokens, Output tokens; the last two carry a coverage dot and fraction (`4,770 / 4,770 calls`; amber when partial, red at zero) and the exact value when abbreviated. The definition popover holds the definition, unit, coverage, the exact number, the by-semantics split and cache-read tokens (`Unavailable` outside tracelab-claude). Three charts: Activity by day (14 bars, click lists that day's sessions), Tokens by model (horizontal, click scopes to the model), Tool calls (horizontal, click lists sessions using the tool); hover shows exact values, focus writes the same into a hint line under the chart. Quality strip: rejects, missing usage, unknown timestamps, unlinked tools, one click expands the explanation and offers "List these sessions". Then the first eight sessions with a link to all.
States: loading shows skeleton KPIs, chart placeholders and rows, the receipt skeletons too; empty (no sessions match) shows `Unavailable` on every KPI with `coverage 0 / 0 calls`, empty charts and a Clear scope / Import pair; error replaces the body with one alert that says what failed and that stale numbers are not shown. Contradictory scope (claude-code + gpt-5.5-codex) naturally produces the empty state.

**5. Session detail.** Three panels in one row: Identity (external id, source with the import it came from, agent, repo, user), Interval (observed start and end with the span and the sentence "span of accepted observations, not active time"; declared start and end or `Unavailable` with the reason), Tokens (input and output with per-session coverage, cache read or `Unavailable, not defined for tracelab-codex`, semantics tag). A diagnostics notice only when there is one. Model-call observations table (id, seq, model, started, ended, input, output or `Unavailable`, semantics, Source record). Tool-call observations table (id, model call or an `unlinked` pill, tool, emitted, wall latency, error yes/no/Unavailable, Source record). The Source record drawer shows file, SHA-256, locator, mapping revision, a sentence that numbers are shown as stored, the JSON text, and links to the import report.
States: loading skeleton panels; not found is an error block with a link to Sessions; empty tables print a sentence.

**6. Mapping assistant.** Left: field profile as a compact grid computed locally (name, type, null rate bar, one sample line); the proposed mapping table (rule, target, editable source path, transforms, why + ambiguity) with a caption counting ambiguities and invalid rows, one row showing an inline error with a "did you mean `$.repo`" fix; a footer with the validation state (`syntax ok · semantic 1 error · execution not run`) and the four actions Validate → Preview 200 rows → Save as revision → Import, each enabled only when the previous succeeded. Right: a sticky conversation pane; sending a message adds the reply and marks the changed row `changed`. "What leaves this machine" is in the file bar and in the profile header; it opens a drawer with sent / not sent lists and the exact payload.
States: before the model answers the table shows skeleton rows and the chat a status line; when the provider fails (timeout, malformed JSON after one repair) the chat shows the diagnostic and the table stays editable by hand; the empty state is a file with no profile yet, which cannot happen from this route.

**7. Definitions.** One table: metric, unit, definition, semantics tags, comparability rule. Reached from every KPI popover and from the warnings `i`.

## Accessibility

- Real headings on every screen (`h1` page, `h2` panels), tables with captions (visually hidden where the panel header already names them), `th scope=col`, numeric columns right-aligned.
- Drawers are `<dialog>` opened with `showModal`, so focus is trapped, Escape closes, focus returns; backdrop click closes.
- Popovers are `button[aria-expanded]` + `role=dialog`, Escape and outside click close, focus returns to the button.
- Chart bars are `role=button` with `tabindex=0` and a full `aria-label`; Enter and Space activate; focus writes the exact value into a visible hint line, so keyboard users get what hover users get.
- Scope receipt, progress text and the chat log are `aria-live=polite`; the error state is `role=alert`.
- Visible 2 px focus ring on everything, including table rows' anchors and SVG bars.
- Reduced motion disables the skeleton shimmer and transitions.
- Contrast AA verified for all text tokens in both themes (numbers above).
- No horizontal page scroll at 900 px: the scope bar scrolls inside itself, tables scroll inside their panel, charts are `viewBox` SVG, the split pane collapses.

## Implementation cost in the timebox

Ships in v0.1.0 (about 1.5 days of UI): ScopeBar with URL state, KpiCard + Popover, Overview with three Recharts charts and click-to-drill, QualityStrip, DataTable, Sessions, Session with drawer, Imports, Report with rejects and drawer, ImportSteps, the three state blocks, tokens with the dark override. Definitions is a static table from the metric layer (an hour).
Day 3: MappingTable, Chat, redaction drawer; the profile grid is a straightforward render of the profiler output.
Deferred: keyboard access to Recharts bars beyond what `tabIndex` on `Bar` gives (fallback: a visually hidden table under each chart, cheap), sparkline in KPI cards, pagination beyond Previous/Next, saved scopes.

## Risks and trade-offs

- Recharts click and keyboard behaviour needs verification early on day 2; the SVG in the mockup is the reference behaviour if Recharts fights it.
- Scope-in-URL means every query key includes scope; with TanStack Query that is the point, but the API must accept `model` and `period` on `/metrics/summary` and `/sessions` (only `source` and `agent` exist today). Day-2 contract change.
- Keeping the scope bar on Session detail while not applying it can confuse; the receipt still shows the list's numbers. Mitigation: the receipt is visually subordinate and the breadcrumb says where you are.
- A quality strip of zeros is honest but dull; the design makes the dots grey rather than green so it does not congratulate.
- The Import page collapses finished steps to receipts; someone who wants to see the whole preview again has to expand. That is the disclosure principle applied, and it is a click.

## Why this beats the other three for AgentScope, and where it loses

Wins: the product's promise is that every number has a definition, a coverage and a source. Console puts the number first and every trust surface exactly one step from it, in the same place every time (the `i`, the coverage fraction, the row, the drawer). Filtering and drilling being one mechanism is the fastest possible path for job 3, and the receipt beside the scope makes "what am I looking at" impossible to lose, which Workbench (many panes) and Guided (many steps) both blur. It is also the cheapest to build well with React 19 + Recharts: one bar, one table component, one drawer.

Loses: to Ledger on job 4, where an auditor wants footnoted, document-like provenance rather than a table with a drawer; to Guided on job 2, where a first-time mapping benefits from a stepped flow more than from a split pane; to Workbench for power users who want a command palette and an inspector that stays open while they move. Console accepts those losses because the daily and ad-hoc jobs (1 and 3) dominate usage and are where a monitoring surface earns its place.
