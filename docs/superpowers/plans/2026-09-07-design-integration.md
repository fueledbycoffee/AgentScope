# Plan: design integration, Console shell, tokens and reusable components (issue #30)

Design of record: `research/design/claude/3-console/README.md` (ADR-006). This
issue lands the foundation every later screen composes from and re-hosts the
four thin-slice pages in it with no functional change. Feature work (charts
with real data, quality strip data, drill from charts) is #11; the assistant
is #15; the second source is #16.

## 1. Tokens, type, theme

- `web/src/styles/tokens.css`: the Console token set verbatim (`--bg`,
  surfaces, lines, ink ramp, accent, five series, status with soft variants,
  focus, shadows, radii `--r-1..3`, spacing `--sp-1..7`, type scale
  `--fs-0..7`, `--sans`, `--mono`, `--rail-h`, `--scope-h`). Light on bare
  `:root`; dark redefined under `@media (prefers-color-scheme: dark)` guarded
  as `:root:not([data-theme="light"])` and again under `:root[data-theme="dark"]`
  so the viewer's choice wins both ways; `color-scheme` set in both.
- `web/src/styles/base.css`: reset, body on `--bg`/`--ink`, `tabular-nums`
  everywhere digits align, type scale classes, 2 px focus ring with 2 px
  offset on everything, reduced-motion rule, table and control primitives.
- Fonts: Geist and Geist Mono self-hosted from `@fontsource-variable/geist`
  and `@fontsource-variable/geist-mono` (no runtime network), with the
  fallback stacks from the design.
- `useTheme()`: `light | dark | system`, persisted in `localStorage`, applied
  as `data-theme` on `<html>`; a small toggle in the rail. No flash: the
  choice is applied in `main.tsx` before render.

## 2. Shell and routing

- `AppShell`: 48 px rail (brand, Overview, Sessions, Imports, Mappings,
  Definitions, primary action Import, theme toggle) and the 52 px bar slot
  under it. Data routes (`/overview`, `/sessions`, `/sessions/:id`) render
  `ScopeBar`; `/import`, `/imports`, `/imports/:id`, `/mappings`,
  `/definitions` render `FileBar` with route-specific identity (import id,
  source, mapping revision, start; file, hash, records, chosen mapping). The
  slot never changes height, so the frame never jumps.
- Routes: `/overview` (the current dashboard page re-hosted: four KPIs from
  `/metrics/summary` and the sessions table), `/sessions` (the full session
  list under scope, same query as today), `/sessions/:id`, `/imports`,
  `/imports/:id`, `/import`, `/mappings` (list from `GET /mappings`, one
  detail expander per row), `/definitions` (the definitions the metrics
  summary already returns, one table). `/dashboard` redirects to `/overview`.
  `/assistant` is not routed until #15.
- Scope lives in the URL search params (`?source=&agent=` today; `model` and
  `period` are added by #11 when the API accepts them, so no disabled controls
  are rendered). `useScope()` reads and writes it; every query key includes
  it. Drill chips are the same params (`day`, `tool`, `quality`) and appear as
  removable chips; #30 ships the chip mechanism and the receipt
  (`n sessions · n model calls · from n imports`, `aria-live=polite`), #11
  wires chart clicks to it.

## 3. Reusable components (`web/src/components/`)

Each with vitest coverage and designed loading, empty and error states:

- `KpiTile`: label, value (abbreviated above 99,999 with the exact value
  printed beneath), coverage dot and fraction in the same element,
  `Unavailable` when coverage is zero or the value is null, definition
  button.
- `DefinitionPopover` (`Popover` primitive): `button[aria-expanded]` +
  `role=dialog`, Escape and outside click close, focus returns; content is
  definition, unit, semantics, coverage, exact value.
- `ScopeBar`, `ScopeChip`, `ScopeReceipt`, `FileBar`.
- `DataTable`: caption with count, sticky header, numeric columns
  right-aligned (`align: "num"`), row link affordance (the id is a real
  anchor), empty sentence, footer `Pagination`. Virtualisation is a documented
  hook for #11, not built here.
- `Drawer`: native `<dialog>` with `showModal`, header, scrolling body,
  Escape, backdrop click, focus return. `SourceRecordDialog` on top: file,
  SHA-256, locator, mapping revision, "numbers shown as stored" sentence,
  `JsonText` rendering `payload_text` verbatim with a `derived` label for
  decoded Parquet rows, links to the import report.
- `QualityStrip` (four counters, expanding detail, chip action) as a pure
  component; its data arrives with #10/#11, so #30 shows it only in the
  gallery.
- `StatusPill` (committed / duplicate / failed / running / pending),
  `Notice` (info / warn / bad), `StateBlock` (loading with `Skeleton`, empty,
  error with retry), `Pagination`.
- Chart wrappers over Recharts (`DayBars`, `HBars`): token colours via CSS
  variables, axis abbreviation with the exact value in the tooltip and in a
  focus hint line, bars focusable (`tabIndex` on `Bar`; fallback a visually
  hidden data table under the chart), `onSelect(value)` contract for the
  drill. Rendered with sample data in the gallery; real series arrive in #11.

## 4. Re-hosting the four pages

Import, Imports history, Import report and Session detail keep their
behaviour and tests, restyled onto the shell and the components: tables
become `DataTable`, notices `Notice`, the source drawer `SourceRecordDialog`,
resource states `StateBlock`. The existing vitest suite must stay green with
only label and structure updates (route names, heading levels).

## 5. Gallery and checks

- `/gallery` route registered only when `import.meta.env.DEV` (lazy import so
  nothing ships in the production bundle): every component in every state,
  both themes side by side.
- `tokens.test.ts`: parses `tokens.css`, computes WCAG contrast for every
  text token against every surface it is used on in both themes, asserts
  ≥ 4.5:1 for text and ≥ 3:1 for series fills against `--surface`.
- Accessibility assertions in vitest: dialog focus trap and return, popover
  Escape, chip removal by keyboard, skip link, one `h1` per route.
- The Playwright smoke test is #12; this issue only makes the path
  Overview → Sessions → Session → Source record navigable through the shell.

## 6. Cost and order

1. Tokens, base, fonts, theme (2 h).
2. Shell, routing, `useScope`, `ScopeBar`/`FileBar` (3 h).
3. Primitives: `Popover`, `Drawer`, `DataTable`, `StateBlock`, pills and
   notices, `KpiTile` (3 h).
4. Chart wrappers with Recharts and the gallery (2 h).
5. Re-host the four pages, update tests, contrast test (2 h).

About 1.5 days. Out of scope: real chart data and drill wiring (#11), quality
data (#10), assistant screens (#15), virtualised tables, saved scopes.

## Revision 2: what the Codex review changed (2026-09-07)

`2026-09-07-design-integration-review-codex.md` (BLOCK, 16 findings) shaped
the implementation directly, per the round-cap rule. Decisions:

1. **Scope keys are only what the API applies** (`source`, `agent`). Drill
   chips, `model` and `period` are not URL keys until #11 ships their
   endpoints; the chip is a gallery-only component. Values are encoded in the
   key so `&` and `=` survive.
2. **Receipt without fabrication**: sessions and model calls from the metrics
   summary; the imports count is omitted until an endpoint provides it. The
   source-record dialog shows mapping and import only when the caller knows
   them.
3. **Navigation keeps the scope**: `/` and `/dashboard` redirect with the
   search string; session rows and the "All sessions" link carry it; a scope
   edit resets `offset`; the offset is a URL parameter so Back works.
4. **No query library**: callbacks depend on a memoised scope object keyed by
   its encoded string, so identical scopes never refetch; the existing
   late-response rejection stays.
5. **Scope controls are text inputs with suggestions** (values seen in the
   loaded sessions), controlled by the URL, committed on Enter or blur; a
   facets endpoint is #11.
6. **Temporary deviations, owners**: four tiles are the metrics the API has
   (output tokens, comparability: #10); Overview shows eight sessions with a
   link to all (as designed); the Definitions table renders what the summary
   returns (#10). The overview keeps the sessions usable when the metrics
   fail (the receipt says unavailable), a deliberate departure from "replace
   the body" until the receipt has its own endpoint.
7. **Behaviour decisions in tests**: history rows show a dash for entities on
   duplicate and failed attempts; the batch, preview-invalidation, duplicate
   submission and late-completion safeguards are unchanged.
8. **Theme before first paint**: an inline script in `index.html` stamps the
   saved choice; the toggle exposes light / system / dark; storage failures
   fall back to system.
9. **Gallery shows one theme at a time** (tokens are root-scoped); the
   side-by-side idea is dropped.
10. **Fonts**: the tokens name the Fontsource variable families first
    (`Geist Variable`, `Geist Mono Variable`) with the design's fallback
    stacks; no runtime font request.
11. **Charts**: Recharts bars carry `tabIndex`, Enter/Space activation and a
    focus hint line, plus a visually hidden exact-value table; the browser
    check of the keyboard path belongs to #12, and charts stay out of the
    production bundle until #11 (verified: no Recharts chunk in `dist`).
12. **Dialogs**: shared jsdom mocks toggle `open`; unit tests cover cancel,
    unmount and focus return; native modality is a #12 browser check.
13. **Gallery exclusion** is a compile-time `import.meta.env.DEV` branch around
    the dynamic import; the production build emits one JS chunk without the
    gallery or Recharts.
14. **Contrast test** uses an explicit pairing matrix over the three token
    blocks (light, system dark, explicit dark), 4.5:1 for text and 3:1 for
    series fills; the primary button uses the page ground as text so it reads
    in both themes (white on the dark accent was 2.7:1).
15. **States**: session not found links back to the scoped list; an empty
    later page says so; the receipt has loading and unavailable states.
16. **Acceptance** is typecheck, lint, vitest, production build; actual cost
    was about one day of UI work.
