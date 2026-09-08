# D2-04b Interactive tables, readable dates, settings page (#46)

Tables act as filters, every timestamp reads the way a person expects with the
exact API value one hover or keypress away, and `/settings` holds the display
choices that belong to the viewer rather than to the data — stored in the
browser, never on the server, and applied to every page without a reload.

Plan: `docs/superpowers/plans/2026-09-08-tables-dates-settings.md` (three
Codex review rounds folded in; the joint contract with #11 is §0).

## What changed

**A settings store shaped like `theme.ts`, one size up.** `web/src/settings.ts`
keeps date format, time zone, relative times and number locale under one key,
validates every field on its own so a corrupt entry degrades one choice rather
than a page, and records what it discarded so the page can say *why* it is not
using a stored zone. Zones and locales are canonicalised on the way in and the
option list is canonicalised with them — this ICU resolves `Asia/Kathmandu` to
`Asia/Katmandu` and omits `US/Eastern` from `supportedValuesOf`, so a select
whose values were not the names we store would show nothing selected.
Precedence is one rule: *a choice that reached storage is the stored choice; a
choice this tab could not persist is this tab's until reload*, which preserves
the private-mode behaviour `theme.ts` already has a test for.

**One formatting path.** `web/src/format.ts` now owns every number and every
date. `parseInstant` accepts the API's grammar and nothing else and returns
microseconds as a `bigint`, because `Date.parse` accepts `2026-02-30T12:00:00Z`
(silently moving it to 2 March), a bare `'0'` and offset-free strings read in
the machine's zone, and because at millisecond resolution a reversed interval a
microsecond wide subtracts to zero and would print as a real `0 s`. Both facts
are pinned as tests. Absolute renderings are assembled from `formatToParts`
with an explicit calendar, numbering system and hour cycle, month names come
from a fixed table (engines disagree between `Sep` and `Sept`), and the offset
is read at the instant with the bare `GMT` the engine returns at zero offset
normalised — which is what keeps the two Paris fall-back instants, both reading
`02:30`, distinguishable. Relative labels and duration labels share one rule:
a count that rounds up to the next band's threshold is promoted, so `44.6 s` is
`1 min ago` and never `0 min ago`, `89.9 min` is never `90 min ago`, and
`59.6 s` is `1 min` and never `60 s`.

**Tables that filter.** Source and agent cells are anchors into the same URL
scope the bar writes, so a middle-click opens a scoped view in a new tab. The
active value is marked with `aria-current` and clears on the next click, and
its accessible name says so — even on a cell that targets another route. All
scope edits go through one `patchScope`, so encoding, trimming, the `offset`
reset and preservation cannot drift between the bar, a cell and a chip; a cell
that targets `/sessions` carries #11's `drill` envelope with it, because a
Session cell must not silently drop a tool or accounting drill. Chips remove
exactly one key and move focus to the next chip, then `Clear all`, then a live
region that says `Filters cleared` — after the removal has landed, not on the
next frame, which can run first.

**A designed settings page**, not a modal, with a live sample beside every
choice, a warning when a stored zone is unknown, and a reset that names what it
restored. The theme control is one `ThemeToggle` shared by the rail and the
page, keeping the named `aria-pressed` group the shell already had rather than
becoming a half-implemented radiogroup, and `.theme-toggle` no longer clips its
own tooltip and focus ring.

## How each acceptance criterion is met

| Criterion | Evidence |
|---|---|
| Clicking a source or agent cell scopes the app, with a removable chip and one click back | `settings.spec.ts` clicks the agent cell, asserts `?agent=codex` and the fixture's **40 rows** (unscoped shows `PAGE_SIZE` 50), the chip, the marked active cell, then removal and the restored list. Unit tests cover the names, the anchors, the encoding of `trace & lab` and a model containing `+ & = # /`, drill preservation and post-removal focus. |
| The same URL scope the filter bar uses | Cells and chips compose `useScope()`'s URL through `patchScope`; nothing holds filter state of its own. |
| Rendered as links, so they open in a new tab | A modifier-click in `settings.spec.ts` opens a second tab on the scoped URL and asserts the original tab did not move. |
| Every timestamp reads relative and absolute, in the viewer's zone | `format.test.ts` covers three formats across three zones, midnight and noon, DST in both directions, `+05:45`, and every relative boundary in both directions. |
| The exact ISO one hover or click away | The tooltip, the `title` and the accessible name all carry the API string; Enter copies it. `settings.spec.ts` compares a rendered `title` against `observed_start_at` for a **named** session fetched from the API. |
| Durations as `1 h 12 min`, exact seconds in the title | Six bands with carry, tested; the exact value is locale-grouped seconds. |
| "Unavailable" stays the designed value, never a fabricated "now" | Tested for null, ambiguous, impossible and over-precise input, missing and unreadable endpoints, and reversed spans — each with its own reason, reachable by hover **and** by keyboard focus. |
| `/settings` holds the five choices, theme moved with the toggle kept as a shortcut | The page renders all five; the rail keeps the same shared control. |
| Choices persist per browser, never on the server | No backend change and no new API call; persistence proved by re-importing the module under `vi.resetModules()` and by a browser reload. |
| Every page reflects a change without reload | Three ways: the page's own samples change in place; a mounted `/imports` re-renders under `setSettings` with no navigation or remount; and the ambient test proves a KPI-style consumer with **no subscription** regroups, with DOM node identity asserted so a remount cannot pass as an update. |
| Unit tests for `formatDate` and the settings module | 64 formatter tests, 22 store tests, 13 date-component tests, 18 scope-link tests, 11 page tests. |
| Axe: no new violations; chips and cell links have names; the form has labels and a visible focus ring | The sweep covers 7 route states × 2 themes, comparing `(route, theme, rule, target)` against a baseline captured from a clean `origin/main` build on the same engine. Keyboard operation is asserted in the browser, not inferred from roles. |

## The Axe baseline

Two entries, both pre-existing: `link-in-text-block` on the import report, in
light and dark. No rule is ever disabled — doing that to excuse one old
instance would exempt every new control from the same rule — so a new target
under an existing rule fails. Routes this branch adds have no baseline entry
and must therefore be clean. Findings are keyed by the route's stable **name**,
never its path, because session and report ids differ between runs, and the
helper asserts a non-empty `passes` array so a silently failed injection cannot
look like success. Re-record it with the recipe in `e2e/axe-capture.spec.ts`.

## Cut to #46b, and why none of it breaks an acceptance criterion

| Cut | Why it is safe |
|---|---|
| Exhaustive Gallery expansion | The gallery is development-only and excluded from the production bundle (`App.tsx:16`). No acceptance criterion, Playwright path or Axe route touches it; the new components are covered by unit tests and by the real pages. |
| A lint ban on `toLocaleString` outside `format.ts` | It could not catch a raw `{count}` interpolation, which is where half the real omissions were. The migration instead covers both classes by hand — the 41 `toLocaleString` sites **and** the raw JSX numbers at `bars.tsx:51`, `primitives.tsx:57,129`, `Session.tsx:70,72,79,81`, `sessionsTable.tsx:22`, `Import.tsx:128`, `Imports.tsx:191,209`, `ActionBar.tsx:69`. The rendered-output sweep that would guard it mechanically lands with the ban. |
| Automatic minute-by-minute relative aging | Labels are computed at render, and every navigation, scope change, settings change and refetch re-renders. Nothing in the issue asks a label to age with no interaction, and the exact value is always one hover or keypress away. |
| Cross-tab synchronisation and its browser matrix | The acceptance is "persist per browser" and "reflects a change without reload"; both are proved same-tab and by reload. The precedence rule that makes cross-tab correct is already implemented, so the follow-up adds a `storage` listener and nothing else. |

Nothing mandatory was cut: every timestamp (including the already-imported
receipt on `/import`), every locale consumer outside #11's files, all the
accessibility work and the full #11 contract are in this branch.

## Pending the rebase after #11 merges

Under the coordinator's boundary #11 owns `components/{primitives,charts,bars}.tsx`,
`scope.ts`, `shellContext.tsx` and `pages/Overview.tsx`; this branch never
touches them and compiles against main's `scope.ts`.

- **A visible, temporary inconsistency:** `/overview`'s KPI values, coverage
  fractions and the scope receipt still format as `en-US` while the rest of the
  app follows the chosen locale, because those three files are #11's. The six
  remaining `toLocaleString` calls (`bars.tsx` ×1, `charts.tsx` ×4,
  `primitives.tsx` ×6) are migrated in the rebase. This is agreed, not a bug.
- `formatExactText` ships here with its tests and a Settings-page sample; wiring
  it into #11's exact KPI, coverage, receipt, tooltip, focus-hint and accessible
  table surfaces happens in the rebase, with the joint test on a value above
  `Number.MAX_SAFE_INTEGER`.
- `<ScopeChips />` is above the Sessions table; adding it above the Overview
  sessions panel is a rebase item.
- `ScopeCell dimension="model"` on `Session.tsx:36` renders as text today and
  becomes a link the moment #11 adds `model` to `SCOPE_KEYS` — **no edit here
  when it lands**. `SCOPE_PARAMS` replaces the locally named `drill` constant in
  `components/scope/scopeUrl.ts` at the same time.
- The `.has-tip`/`data-tip` upgrade to `ScopeChip`'s remove button is #11's to
  make in `bars.tsx`; this branch's own chips already carry it.

## How to verify

```
pnpm --dir web lint && pnpm --dir web typecheck && pnpm --dir web test && pnpm --dir web build
E2E_PORT=8796 pnpm --dir web exec playwright test
uv --directory backend run pytest -q     # unchanged: no backend edit in this branch
```

300 unit tests (128 new) and 11 browser tests pass; lint, typecheck and build
are clean. Five screenshots are written to the ignored
`web/test-results/tables-dates-settings/` and attached rather than committed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_014DtPBVHFozpxZEh1F61h56
