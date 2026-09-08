# Plan: Interactive tables, readable dates, settings page (issue #46)

Revision 3, 2026-09-08, after the Codex second-pass review
(`…-review-codex-2.md`, BLOCK). Review history and the answer to every finding
are in **§ Revision 2** (condensed) and **§ Revision 3** (full) at the end;
where they conflict, Revision 3 and the design body win.

This revision also **trims the v0.1.0 slice** on the reviewer's
recommendation. What ships now and what moves to the follow-up issue **#46b**
is stated in § Scope of this slice, before any design detail, so no reader has
to infer it.

## Goal

> Tables act as filters: clicking a source or an agent cell in any table scopes
> the app to it (the same URL scope the filter bar uses, `?source=&agent=`),
> with a removable chip and one click back. Every timestamp on screen reads as a
> person expects (relative and absolute, in the viewer's zone), with the exact
> ISO value one hover or click away. A Settings page (`/settings`) holds the
> display choices that are the viewer's, not the data's: date format, time zone,
> relative times on or off, theme (moved from the top bar toggle, which stays as
> a shortcut), number locale. Choices persist per browser, never on the server,
> and every page reflects a change without reload.

Verifiable by: clicking `codex` in the Sessions table's Agent column (the
fixture has 40 codex and 40 claude-code sessions), landing on
`/sessions?agent=codex` with 40 rows and a removable chip; changing the date
format on `/settings` and watching the page's own live samples change in place
while an already-mounted Imports ledger re-renders without navigation (unit)
and reads in the new format after a client-side navigation and after a reload
(browser); and hovering or focusing any timestamp to get the byte-exact ISO
string the API returned.

## Scope of this slice

**Ships in v0.1.0.**

1. Every browser display choice (date format, zone, relative on/off, theme,
   number locale), defaults and reset, the private-mode fallback, the
   accessible `/settings` page, the retained rail shortcut, and **same-tab live
   updates on every page**.
2. Every ordinary timestamp converted; viewer / UTC / named-zone rendering;
   relative on/off; offsets on every session timestamp; the exact ISO revealed
   and copyable; human durations; honest `Unavailable`. Source and editor
   payloads stay verbatim.
3. Source and Agent cells as anchors, active-value clearing, shared removable
   chips, Back; the existing Model cell converted now and activated by #11's
   key with no further #46 edit. Period controls and server drill semantics stay
   #11's.
4. Complete locale presentation — including the assistant and import counts and
   #11's lossless exact **text** — with the propagation test, the locale sweep,
   the required Playwright and Axe coverage and the PR screenshots.

**Cut to follow-up issue #46b**, each with the reason it breaks no acceptance
criterion:

| Cut | Reason it is safe |
|---|---|
| Exhaustive Gallery expansion (`pages/Gallery.tsx` untouched) | The Gallery is development-only and excluded from the production bundle (`App.tsx:16`: `import.meta.env.DEV ? lazy(...) : null`). No acceptance criterion, Playwright path or Axe route touches it. The new components are covered by unit tests and by the real pages. |
| The proactive `no-restricted-syntax` ban on `toLocaleString` | It is a regression guard, not behaviour, and the reviewer is right that it cannot catch a raw `{count}` interpolation. It is **replaced in-slice by a stronger guard**: the rendered-output locale sweep (§ Tests), which fails on any number rendered without the chosen locale's grouping. The ban returns in #46b as belt-and-braces. |
| Automatic minute-by-minute relative aging (`useNow`, its interval, StrictMode and timer-leak tests) | Relative labels are computed at render, and every navigation, scope change, settings change and data refetch re-renders. Nothing in the issue requires a label to age with no interaction, and the exact value is always one hover or focus away. Removes a timer, a fake-timer suite and a leak class from the slice. |
| Cross-tab synchronisation (the `storage` listener in `settings.ts` and `theme.ts`, the two-page Playwright scenario, the extra browser matrix) | The acceptance is "persist per browser" and "every page reflects a change without reload". Both are proven **same-tab**: the Settings page's own live samples change in place, an already-mounted `/imports` re-renders under `setSettings` with no navigation (unit), a client-side navigation shows the new format, and a reload proves persistence. The precedence rule that makes cross-tab correct is still designed and implemented for the local case (§1), so #46b is a pure addition, not a rewrite. |

**Not cut, and not cuttable:** any mandatory timestamp (including
`Import.tsx:264`), any locale consumer (including the assistant and import
surfaces), any accessibility work, or the #11 contract integration. The
Revision 2 sentence that offered the assistant/import number migration as a
schedule release valve is **deleted**; it contradicted this plan's own
acceptance row and the issue.

## Current state

Verified in this worktree at `8aab14f`; line references re-checked at `f93f27a`.

### Scope

- `web/src/scope.ts`: `SCOPE_KEYS = ['source', 'agent']` (`:11`), `readScope`
  (`:15`), `scopeKey` (`:24`), `scopeSearch` (`:32-36`, which serialises **only
  the base keys** — so carrying anything else across a route is new work),
  `useScope()` (`:38`) returning `{ scope, key, offset, set, clear, setOffset,
  link }`. `set` (`:42`) trims, deletes empties and drops `offset`; `clear`
  (`:52`) deletes every scope key. No per-key remove, no toggle, no link
  builder.
- `backend/src/agentscope_app/interfaces/api/routers.py:199-208` accepts
  `source` and `agent` only: today no other key can narrow the numbers.
- `web/src/components/bars.tsx`: `ScopeBar` (`:31`), `ScopeChip` (`:45`,
  `{ label, value, onRemove }`, an `x` button with `aria-label` and a native
  `title` but **no** `.has-tip` / `data-tip`), `FileBar` (`:60`). `ScopeChip` is
  used only by `Gallery.tsx`.
- No table cell uses the scope: `sessionsTable.tsx:15-16`, `Imports.tsx:34`,
  `Session.tsx:65`. `Session.tsx:36` renders `display(call.model)` — the only
  Model cell in the app; `sessionsTable.tsx` has **no** Model column.
- `sessionsTable.tsx:13` makes the session id an anchor carrying the scope.
  That is navigation, not a scope link, and it stays.

### Timestamps

- The API emits UTC ISO-8601 ending in `Z`, with **at most six** fraction
  digits: `UtcDateTime`
  (`backend/src/agentscope_app/infrastructure/db/models.py:41-55`) stores
  UTC-aware Python `datetime`, whose resolution is microseconds, and
  `domain/units.py:120-140` (`timestamp_notes`) records `precision_reduced`
  when a *source* value carries more. Verified serialisation:
  `TypeAdapter(datetime).dump_json` yields `"2026-06-04T12:34:56.123456Z"` and
  `"2026-06-04T12:34:56Z"`.
- Display timestamps rendered raw today: `sessionsTable.tsx:16-17`,
  `Session.tsx:37-38`, `:48-49`, `:65-66`, `Imports.tsx:39`, `:195`, `:216`,
  `Import.tsx:264`.
- Durations: `Imports.tsx:60` `seconds(report)` used in the Lead title at
  `:67`; `Session.tsx:50` prints `wall_latency_ms` raw under `Wall latency
  (ms)`. No session span exists, although `research/insights/MERGED.md` §1.6
  fixes the label "observed span in imported data" and its caveat, and §1.12
  requires per-cell `Unavailable` with a reason.
- `web/src/format.ts` has `PAGE_SIZE`, `display`, `entityCounts`, `abbreviate`;
  no date helper.

### Numbers — the semantic inventory

Two classes, both presentation, both in scope. **(a) Locale-formatted with the
wrong locale** — `toLocaleString('en-US')`, 4 sites in `format.ts` (`:5,14,17,19`)
and 37 elsewhere:

| File | Lines |
|---|---|
| `components/primitives.tsx` | 150 (×2), 158 (×2), 159, 160, 166 (×2), 183 |
| `components/charts.tsx` | 17, 23, 45, 68 |
| `components/bars.tsx` | 50 |
| `pages/Import.tsx` | 53, 125, 129, 137 (×3), 243, 255, 258, 278, 279, 297, 357, 403, 409, 410 (×5), 411, 417, 420, 422 |
| `pages/Imports.tsx` | 12 |
| `pages/Sessions.tsx` | 22 |
| `pages/Assist.tsx` | 95, 96 |
| `assist/ActionBar.tsx` | 78 |
| `assist/PayloadDrawer.tsx` | 15, 27 |
| `assist/EvidenceRail.tsx` | 6 |
| `assist/DocumentEditor.tsx` | 43 |
| `import/components.tsx` | 76 |

**(b) Not formatted at all** — a raw number interpolated into JSX, which no
`toLocaleString` search can find. Verified sites:

| File:line | Value |
|---|---|
| `components/bars.tsx:51` | `{imports}` in the scope receipt |
| `components/primitives.tsx:129` | `DataTable`'s `caption .count` |
| `components/primitives.tsx:57` | `Pagination`'s `Page {n}` |
| `pages/Session.tsx:70` | `{coverage.known} / {coverage.total} calls` |
| `pages/Session.tsx:72` | `${session.diagnostics.length} diagnostic…` |
| `pages/Session.tsx:79`, `:81` | `{session.model_calls.length}`, `{session.tool_calls.length}` |
| `pages/sessionsTable.tsx:22` | `${coverage.known} / ${coverage.total} calls` |
| `pages/Import.tsx:128` | `String(state.entries.length)` (file count) |
| `pages/Imports.tsx:191` (report `files.length` count badge), `:209` | panel counts |
| `assist/ActionBar.tsx:69` | `preview.rejects.length`, `preview.records.sampled` |

Class (b) is why the slice's guard is a **rendered-output sweep**, not a lint
rule: the sweep fails on any rendered number ≥ 1000 that lacks the chosen
locale's group separator, whatever produced it.

### Per-browser settings

- `web/src/theme.ts`: key `agentscope-theme`, a `listeners` set, a `chosen`
  in-memory fallback for a throwing `localStorage` (`:24-31`), `applyTheme`,
  `useTheme()` on `useSyncExternalStore`. `web/index.html:9-14` stamps the
  theme **before first paint**; `main.tsx:12` re-applies after module load.
  `components.test.tsx:123-139` pins the behaviour that must survive: stale
  storage plus a throwing `setItem`, in-memory wins.
- `AppShell.tsx:25-26` renders the theme control as a `role="group"` of
  `aria-pressed` buttons — **not** a radiogroup. `base.css:174-176` gives
  `.theme-toggle { overflow: hidden }`, which clips the below-control tooltip
  and can clip the outward focus ring.
- `App.tsx:31-37` is the `Bar` switch; `:41-56` the routes; no `/settings`.
  `App.tsx:16` makes the Gallery development-only.
- `shellContext.tsx:25-38`: `ShellProvider` passes `children` through, so a
  provider state change does **not** re-render the routed tree — the fact that
  decides §2.

### Design of record and process

- ADR-006: one global scope, a drill appends a chip to it, no second drill
  mechanism (rule 1); `Unavailable` is a rendered state and an abbreviation
  prints its exact value beside it (rule 2); trust surfaces one step away in
  the same place every time (rule 3); its 2026-09-08 amendment allows icon-only
  actions with an accessible name and a visible tooltip. The Console IA table
  has no `/settings`, so the route needs an amendment in #45's form.
- `docs/architecture/import-pipeline.md:3-6` describes the implementation
  **frozen at `2a351e9`** and must not gain a later route.
- `docs/planning/2026-09-07-consolidated-plan.md:118-122`: **feature freeze at
  the end of Day 3 (2026-09-10)**; Day 4 is verify, package, release (#19).
  This is why the schedule below targets an integrated green candidate at
  `2026-09-10T23:00Z`.

### Tests and CI

- `App.test.tsx`'s `/api/sessions` handler (`:24-26`) returns **one** session
  regardless of the query, so proving narrowing needs a scope-sensitive mock;
  `start()` (`:30-31`) mounts without a provider.
- `e2e/smoke.spec.ts` (`chromium`) imports the fixture and is a dependency of
  `assistant`, which imports a second source (`epoch-assist`, 30 records) into
  the same database. Unscoped `/sessions` shows at most `PAGE_SIZE = 50` rows.
- `e2e/assist.spec.ts:75` asserts `/2025-09-04T15:33:2\d/` — a rendered
  timestamp inside the verbatim emission JSON at `assist/ActionBar.tsx:73`
  (`JSON.stringify(first.fields)`). Source inspection, not a display timestamp:
  exempt, and the assertion stays.
- No Axe dependency (`web/package.json:26-39`). The lockfile is
  **`web/pnpm-lock.yaml`**; there is no root lockfile. No CSP is enforced
  anywhere, so Axe injection has no obstacle and no security setting changes.

### Parallel work

`/Users/sean/dev/AgentScope-wt/11/docs/superpowers/plans/2026-09-08-dashboard.md`
**now exists** and was read in full for this revision. §0 below is the joint
contract, with every disagreement the reviewer found named and resolved.
Issue **#39** (assistant field editor, numeric codec, report entry point)
overlaps `assist/DocumentEditor.tsx`, the assistant surfaces and
`pages/Imports.tsx`; the handoff is scheduled in § Cost estimate.

## Design

### 0. The joint contract with #11 — dated 2026-09-08

The Revision 2 claim that the sibling plan was absent is **withdrawn**: it
exists, and declaring an interface authoritative is not agreement. This
section is the joint contract, written against
`2026-09-08-dashboard.md` as read today. **Where it changes #46, the change is
made below. Where it requires a change in #11's plan, that is listed in
§0.6 as a handoff the coordinator must land before either implementation
starts.**

#### 0.1 Agreed already, kept verbatim

Both plans agree, and nothing here changes: the four base keys in order
(`source`, `agent`, `model`, `period`); `SCOPE_LABELS` and identity formatting
for Source/Agent/Model; `7d → last 7 days`; an absent `period` meaning
unrestricted; #46 owning the cell links (`11:537-539` states this explicitly);
#11 owning the period filter, facets and API integration; `ScopeChip` staying
the single shared leaf with unchanged **props**; `ScopeChips` being the sole
chip renderer. Model is not a new Sessions-table column: #46 converts the
existing call-table cell, and any future column uses the same component.

#### 0.2 The serialised scope is base keys **plus** the drill envelope (C1)

Revision 2 defined the carried scope as `SCOPE_KEYS`, so a Session Model link
targeting `/sessions` would have dropped #11's `drill` parameter and silently
lost a tool, quality, day or accounting drill. Corrected:

```ts
export const SCOPE_KEYS = ['source', 'agent', 'model', 'period'] as const   // base order, #11 extends
export const SCOPE_PARAMS = [...SCOPE_KEYS, 'drill'] as const               // the full serialised scope
```

- `patchScope(search, patch)` (§5) preserves **every** parameter on a same-route
  edit, as before.
- A **target-route** link (`scopeHref(key, value, '/sessions')`) carries
  `SCOPE_PARAMS`, not `SCOPE_KEYS` — the drill travels with the scope, so a
  Session Model or Source link returns to a drilled Sessions list intact.
- `scopeSearch` and `link` are re-expressed over `SCOPE_PARAMS` for the same
  reason. (`scope.ts:32-36` serialises base keys only today, so this is real
  work, listed in Files touched.)
- **Chip removal and Clear all reconcile the envelope.** Removing a base chip
  calls `remove(key)`, and the effective-scope resolver (#11's) must **delete**
  that dimension and its mutually exclusive unknown predicate from the
  envelope, never leave a removed filter silently active. `Clear all` removes
  base keys **and** `drill`. Removing the derived chip removes `drill` only.
- **Charts do not call `set()`.** Revision 2 said they would; corrected: a
  chart drill calls #11's `setDrill(envelope)` because the scope it applies is
  server-returned and cannot be reconstructed from four keys. `set()` remains
  the base-filter path.
- A Period change removes the envelope (`11:314-315`), because the server
  generated its date witnesses for the prior period.

#### 0.3 `ScopeChips` — the typed contract (C2)

Published here so #11 has one shape to consume:

```ts
export interface ScopeChipsProps {
  keys?: readonly ScopeKey[]        // default SCOPE_KEYS; base chips, in this order
  includeDrill?: boolean            // default true; appends #11's derived chip after the base chips
  label?: string                    // group label, default 'Active filters'
}
```

- **Placement is fixed, not optional:** above the Overview sessions panel and
  above the Sessions table, base chips first, the derived drill chip last.
  Revision 2's "#11 places it above its charts if it wants" is withdrawn — one
  placement, one mechanism.
- The derived chip is part of the empty check (nothing renders when there is no
  base key **and** no envelope), part of `Clear all`'s threshold (two or more
  chips of any kind), and part of the focus order.
- **Focus after removal** no longer assumes a table caption: `ScopeChips` keeps
  a `visually-hidden` `tabIndex={-1}` sentinel with `role="status"` mounted
  while it renders anything, and after a removal moves focus to the next
  remaining chip's remove button, else `Clear all`, else the sentinel, which
  announces `Filters cleared`. Self-contained, no assumption about the page.
- `ScopeChip`'s **props are unchanged**; its remove button gains `.has-tip` +
  `data-tip` so the icon-only control meets the shell's tooltip contract. The
  agreed wording is the reviewer's: *public leaf props unchanged; #46's
  `.has-tip`/`data-tip` upgrade preserved.*

#### 0.4 Period is UI-only, and the merge order is chosen (C3)

Revision 2 said the new keys "arrive when endpoints accept them", which is
wrong for `period`. Copied from `11:269-276` and adopted:

- Options `all` (omitted from the URL), `7d`, `30d`, `90d`; the control is
  labelled `Period (UTC)`; `resolvePeriod(period, now)` produces explicit UTC
  midnight bounds covering that many calendar days through today; **the literal
  `period` is never sent to the server**; a returned chart drill wins over the
  derived bounds.
- `period` therefore becomes active when #11's client date-bound resolution and
  the receiving endpoints exist — not when a router accepts a `period`
  parameter, which it never will.
- **One integration order, coordinator-owned: the two issues run in parallel,
  and #46 rebases after #11 merges.** #11 owns `web/src/scope.ts`
  (`SCOPE_KEYS` with `model` and `period`, `SCOPE_PARAMS` with `drill`,
  `setDrill`), `web/src/components/{primitives,charts,bars}.tsx`,
  `web/src/shellContext.tsx` and `web/src/pages/Overview.tsx`. #46 compiles
  against **main's** `scope.ts` until then, adds nothing to it, and composes
  `useScope()` from a module of its own. **#46's locale migration of
  `primitives.tsx`, `charts.tsx` and `bars.tsx`, and its consumption of the
  `ScopeChip` tooltip upgrade, happen in that rebase**, not in its main pass.
  Because #46 ships only the Source and Agent labels, #11 initialises all four
  labels and the period formatter itself; the Revision 2 claim that either
  order needs no adaptation is withdrawn.
- **Shared-file ownership corrected.** Revision 2 said "#11 does not touch
  `bars.tsx`". It does: `11:503-504` replaces `ScopeBar`'s filter controls and
  receipt, and under the coordinator boundary it owns the whole file. #46's
  number migration of `ScopeReceipt` (`:50,51`) is a rebase item, and the
  `.has-tip`/`data-tip` upgrade to `ScopeChip`'s remove button is **#11's to
  make**; #46 consumes it (see §0.6 item 3).

#### 0.5 Exact values are text, and text must be locale-formatted (C4)

`11:328-371,452-455,503-511` replaces KPI values, coverage, receipt figures,
chart tooltips, focus hints and the accessible table with **lossless transport
text** (`valueText`, `recordedSumText`, partition values) that may exceed
`Number.MAX_SAFE_INTEGER`. A mechanical `num(number)` substitution does not
survive that, and neither rendering the text raw (no grouping) nor passing it
through `Number` (lossy) is acceptable. #46 therefore ships the missing
primitive:

```ts
export function formatExactText(text: string | null | undefined, settings?: Settings): string
```

It groups an arbitrary-length decimal **string** without parsing it to a
number: split optional sign, integer digits and fraction; take the `group` and
`decimal` separators from `Intl.NumberFormat(locale).formatToParts(12345.6)`;
regroup the integer digits by the locale's primary grouping size; rejoin.
Non-numeric text is returned unchanged; `null` is `Unavailable`. The original
string is kept beside it for copy, transport and `title`, never replaced.
Revision 2's "#11 touches no number formatting" is withdrawn: #11 must call
`formatExactText` for every visible exact line, partition, receipt figure,
tooltip, focus hint and accessible table cell, and keep the raw text for API
and copy paths and approximate numbers for geometry only (§0.6).

#### 0.6 Handoff — changes #11's plan must make

These are #46's requirements on #11 and cannot be committed from this
worktree. The coordinator must land them in `2026-09-08-dashboard.md` before
implementation:

1. Route base-filter edits through `patchScope`, and specify **deletion** as
   well as override: `11:295-298` ("start from the envelope, then overlay base
   values") retains `scope.model` after `model` is removed from the URL. Delete
   the cleared dimension and its unknown predicate from the effective envelope,
   or invalidate the drill.
2. Resolve `11:564-565` ("changing a base filter removes stale witness state")
   against `11:312-315` (Source/Agent/Model preserve it). One rule.
3. **Own the `ScopeChip` tooltip upgrade.** `bars.tsx` is #11's file under the
   coordinator boundary, so the `.has-tip` + `data-tip` attributes on the
   remove button are #11's to add, keeping the public leaf props unchanged.
   #46 consumes the upgraded leaf and asserts the tooltip only after the
   rebase. #11 also adopts `ScopeChipsProps` and the fixed placement in §0.3.
4. State the reciprocal bootstrap: if #11 lands first it initialises all four
   labels and the period formatter; if #46 lands first it adds `model`,
   `period` and the period formatter. Adopt the single order in §0.4.
5. Require `formatExactText` for every visible exact value. **#46 ships the
   formatter, its tests and the Settings-page sample in its main pass; wiring
   it into #11's KPI, coverage, receipt, tooltip, focus-hint and accessible
   table surfaces is a rebase item, not part of #46's main pass.** The
   formatter regroups a decimal string losslessly and never parses it to a
   number. Joint test at the rebase: a locale change on the merged dashboard
   with a value above `Number.MAX_SAFE_INTEGER` and one with a fractional
   decimal.
6. Name the shared drill tests with #46: a tool or accounting drill carried
   through a Session cell targeting `/sessions`; Model removal; Period removal;
   `Clear all`; and Back — each asserting the effective API scope **and** the
   displayed chips together.

### 1. `web/src/settings.ts` — the store

```ts
export type DateFormatId = 'iso' | 'dmy' | 'mdy'
export interface Settings { dateFormat: DateFormatId; timeZone: string; relativeTimes: boolean; numberLocale: string }
export interface Diagnostics {
  timeZone?: { stored: string; reason: 'unknown-zone' }
  numberLocale?: { stored: string; reason: 'unsupported-locale' }
  storage?: 'unavailable'
}
export const DEFAULTS: Settings = { dateFormat: 'iso', timeZone: 'viewer', relativeTimes: true, numberLocale: 'en-US' }
export const STORAGE_KEY = 'agentscope-settings'
export function readSettings(): Settings          // getSnapshot; stable identity
export function readDiagnostics(): Diagnostics
export function setSettings(patch: Partial<Settings>): void
export function resetSettings(): void
export function subscribe(listener: () => void): () => void
export function resolveTimeZone(settings: Settings): string
export function resolveLocale(settings: Settings): string
export function timeZoneOptions(current: string): string[]
export function localeOptions(current: string): { id: string; label: string }[]
```

- **Validation per field**, with the discarded value recorded in `Diagnostics`
  so the Settings page can say *why* it is not using the stored zone, instead
  of the evidence being destroyed by the fallback.
- **Canonicalisation.** Zones go through
  `Intl.DateTimeFormat('en-US', { timeZone: v }).resolvedOptions().timeZone`
  (verified: it accepts the alias `US/Eastern` and returns
  `America/New_York`, which `Intl.supportedValuesOf('timeZone')` does **not**
  list); locales through `Intl.getCanonicalLocales` guarded by
  `Intl.NumberFormat.supportedLocalesOf` (verified: `fr-CA` is supported and is
  outside the preset list). The canonical form is written back, and
  `timeZoneOptions(current)` / `localeOptions(current)` **always include the
  effective value**, so a select can never disagree with what is in force.
- **Stable snapshot identity**: the validated object is cached and the same
  reference returned until a write, or `useSyncExternalStore` loops forever.
- **Precedence — one rule.** *A choice that reached storage is the stored
  choice; a choice this tab could not persist is this tab's until reload.*

  ```
  memory: Settings | undefined      persisted: boolean      cache: Settings | undefined

  setSettings(patch):
    next = validate({ ...readSettings(), ...patch })
    memory = next; cache = next
    try { localStorage.setItem(KEY, JSON.stringify(next)); persisted = true }
    catch { persisted = false }
    notify()

  readSettings():
    if (cache) return cache
    if (memory && !persisted) return (cache = memory)      // our write never landed
    try { raw = localStorage.getItem(KEY) } catch { return (cache = memory ?? DEFAULTS) }
    return (cache = validate(parse(raw)))
  ```

  This preserves the tested `theme.ts` case exactly (`components.test.tsx:123-139`):
  storage keeps returning a stale value while `setItem` throws, `persisted` is
  false, and the in-memory choice wins. A malformed stored value is degraded
  per field on read and never written back.
- **Cross-tab is #46b.** The `storage` listener that would let an external
  change win (guarded by `!persisted`, covering `event.key === null` from
  `clear()` and `newValue === null` from removal) is designed here and
  deferred; because the `persisted` flag already exists, #46b adds a listener
  and nothing else. `theme.ts` likewise keeps its current single-tab behaviour
  and its pre-paint bootstrap (`index.html:9-14`, `main.tsx:12`) untouched.
- **Theme** keeps its own module and key. `resetSettings()` writes `DEFAULTS`
  **and** calls `setTheme('system')`, and the page's confirmation says so.

### 2. `web/src/settingsContext.tsx` — the hook

```tsx
export function SettingsProvider({ children }: { children: ReactNode }): ReactElement
export function useSettings(): Settings
```

`SettingsProvider` subscribes once via `useSyncExternalStore(subscribe,
readSettings, () => DEFAULTS)` and publishes on a context. `useSettings()`
calls `useContext` **and** the store hook unconditionally and prefers the
context — no conditional hook, and components without a provider (unit tests)
still work. The provider wraps `<App/>` in `main.tsx`.

**Propagation.** `App` itself calls `useSettings()`, so a change re-renders
`App`, which recreates the whole element tree (`ShellProvider`, `AppShell`,
`Routes`, the page) — necessary because `shellContext.tsx:25-38` passes
`children` through. Ambient number readers therefore update with no
subscription of their own; `DateText`, `SpanText`, `DurationText`, `ScopeCell`
and the Settings page also subscribe directly, so they survive a future `memo`.
The propagation proof is a test on an **ambient** consumer (§ Tests).

`useNow` is **cut to #46b**: relative labels are computed at render, which
covers every navigation, scope change, settings change and refetch.

### 3. `web/src/format.ts` — one formatting path

```ts
// numbers
export function num(value: number | null | undefined, settings?: Settings): string
export function decimal(value: number, maxFractionDigits: number, settings?: Settings): string
export function abbreviate(value: number, settings?: Settings): string
export function display(value: string | number | boolean | null | undefined, settings?: Settings): string
export function formatExactText(text: string | null | undefined, settings?: Settings): string   // §0.5

// dates
export interface FormattedDate { text: string; absolute: string; relative: string | null; iso: string; unavailable: boolean }
export function formatDate(value: string | null | undefined, settings: Settings,
  options?: { prefer?: 'absolute' | 'relative'; offset?: boolean; now?: number }): FormattedDate

// durations
export interface FormattedDuration { text: string; exact: string; unavailable: boolean; reason?: string }
export function formatDuration(ms: number | null | undefined, settings: Settings): FormattedDuration
export function formatSpan(start: string | null | undefined, end: string | null | undefined, settings: Settings): FormattedDuration
```

`settings` is optional on the number helpers (defaulting to `readSettings()` —
the ambient path, correct because `App` re-renders the tree) and required on
the date helpers. `Intl` instances are memoised per `(locale, options)`.

**The exact-value rule survives the locale.** An abbreviation and its exact
companion are produced from the same locale, so a `de-DE` viewer sees `553,4M`
beside `exact 553.447.877`, never a German abbreviation next to an English
exact value. For #11's transport text the companion is `formatExactText`.

**Migration.** Both inventory classes in *Current state → Numbers* are
converted: class (a) to `num`/`decimal`/`display`, class (b) — the raw JSX
interpolations at `bars.tsx:51`, `primitives.tsx:57,129`, `Session.tsx:70,72,79,81`,
`sessionsTable.tsx:22`, `Import.tsx:128`, `Imports.tsx:191,209`,
`ActionBar.tsx:69` — likewise. Exempt, and written down rather than left to a
search: `payload_text` and `JsonText`, the emission `JSON.stringify` at
`ActionBar.tsx:73` (which is why `e2e/assist.spec.ts:75` stays), mapping
documents in `DocumentEditor.tsx`, ids, external ids, SHA-256, locators, paths.
The guard is the rendered-output **locale sweep** (§ Tests), which catches
class (b) as well as class (a); the lint ban is #46b.

**`formatDate` rules.**

- *Grammar.* Only the API's own shape:
  `YYYY-MM-DDTHH:MM:SS(.f{1,6})?(Z|±HH:MM)`, matched by regex, with the
  calendar components validated by round-trip (`Date.UTC(y, m-1, d)` must
  return the same y/m/d). **Fraction digits are capped at six**, matching what
  the backend can emit (`UtcDateTime`, microsecond `datetime`;
  `units.py:120-140` flags a source with more as `precision_reduced`), so the
  accepted precision equals the arithmetic precision (§ below) — no input can
  be accepted that the comparison cannot distinguish. Everything else is
  `Unavailable`: verified in Node, `Date.parse` would otherwise accept
  `'2026-02-30T12:00:00Z'` (silently → 2 March), `'0'`, and the offset-free
  `'2026-09-08T14:05:00'` (read in the *machine's* zone). Leap days are
  validated (`2028-02-29` accepted, `2026-02-29` not). No instant is ever
  inferred, and no "now" is ever fabricated.
- *Exact.* `iso` is the input string byte for byte, never rebuilt.
- *Absolute.* Assembled from `formatToParts` with `{ calendar: 'gregory',
  numberingSystem: 'latn', hourCycle: 'h23' | 'h12', timeZone }`; month
  **names** come from a fixed English three-letter table, because engines
  disagree (`Sep` vs `Sept`). The number locale governs digits only —
  documented on the Settings page.

  | id | Label | Output |
  |---|---|---|
  | `iso` (default) | ISO 8601 | `2026-09-08 14:05` |
  | `dmy` | Day month year | `08 Sep 2026 14:05` |
  | `mdy` | US | `09/08/2026 2:05 PM` |

- *Offset.* `options.offset: true` appends ` (UTC+02:00)` from the
  `timeZoneName: 'longOffset'` part **at the input instant**, normalised: a
  bare `GMT` — which is what the engine returns at zero offset, verified, it is
  *not* `GMT+00:00` — becomes `+00:00`; `GMT+2` pads to `+02:00`; `GMT+05:45`
  (Kathmandu, verified) passes through. Because it is per instant, the Paris
  fall-back pair `2026-10-25T00:30:00Z` and `01:30:00Z`, which both render
  `02:30` (verified), are distinguished as `(UTC+02:00)` and `(UTC+01:00)`.
  **Every session-page timestamp carries the offset** — Interval facts and both
  call tables.
- *Relative.* `null` when relative times are off or the elapsed duration is
  ≥ 7 days (elapsed duration, not calendar days). Otherwise count =
  `Math.round(|d| / unit)`, **promoted to the next band whenever the rounded
  count reaches that band's threshold**, so 44.6 s gives `1 min ago` (never
  `0 min ago`) and 89.9 min gives `2 h ago` (never `90 min ago`):

  | band | past | future |
  |---|---|---|
  | `|d| < 45 s` | `just now` | `just now` |
  | `< 90 min` | `N min ago` | `in N min` |
  | `< 36 h` | `N h ago` | `in N h` |
  | `< 7 d` | `N d ago` | `in N d` |

  A future instant renders as future — clock skew is data — and inside 45 s
  reads `just now` in both directions. Units are the English abbreviations the
  issue names, not `Intl.RelativeTimeFormat` (`3 hr. ago` in `en-US`, which
  would disagree with the duration units). A non-finite injected `now` yields
  the absolute rendering.
- *Never throws.* Every `Intl` construction is wrapped, falling back to UTC and
  `en-US`, so a malformed persisted setting degrades a rendering, not a page.

**Where each rendering is used** — this table, not a grep, is the maintained
inventory of display timestamps:

| Surface | `prefer` | `offset` |
|---|---|---|
| `sessionsTable.tsx:16-17` Observed start / end | absolute | no |
| `Imports.tsx:39` ledger Started | relative | no |
| `Imports.tsx:195` file-bar Started, `:216` report Started / Finished | absolute | no |
| `Session.tsx:65-66` Interval facts | absolute | **yes** |
| `Session.tsx:37-38,48-49` call tables | absolute | **yes** |
| `Import.tsx:264` `already_imported[].imported_at` | relative | no — **mandatory** |

**Instants and durations at the API's precision.** `Date.parse` is
millisecond-resolution: verified, `…00.123456Z` minus `…00.123455Z` is exactly
`0`, which would hide a reversed interval as a real zero. `parseInstant(iso)`
returns **microseconds since the epoch as a `bigint`**, assembled from the
validated components, and `formatSpan` subtracts bigints. Six accepted fraction
digits and microsecond arithmetic are the same precision, so no accepted input
is indistinguishable. `formatDuration(ms)` keeps milliseconds, the unit the API
gives for `wall_latency_ms`.

- *Rejections.* `null`, `undefined`, `NaN`, `±Infinity` and negatives are
  `Unavailable`. `formatSpan` distinguishes `no start timestamp`,
  `no end timestamp`, `unreadable start timestamp`, `unreadable end timestamp`
  and `the end precedes the start`.
- *Bands and carry.* The band is chosen from the exact value; the larger unit
  floors, the smaller rounds; if the rounded smaller unit reaches the band size
  it carries and the band is re-checked.

  | range | `text` |
  |---|---|
  | `< 1 s` | `340 ms` |
  | `< 10 s` | `4.8 s` |
  | `< 60 s` | `48 s` |
  | `< 60 min` | `12 min 30 s` (seconds dropped when 0) |
  | `< 24 h` | `1 h 12 min` (minutes dropped when 0) |
  | `>= 24 h` | `15 d 3 h` |

- *Exact.* The total in seconds through the number locale at the source's
  precision — six fraction digits from two ISO strings, three from a
  millisecond input, trailing zeros trimmed (`1,309,340.848 s`, the §1.6
  maximum span). This is the `title` and the copied value.
- A reversed interval is `Unavailable` with `the end precedes the start`; equal
  instants are a real `0 s`. `MERGED.md:443-445` records 212 rows with
  inversions inside the **source** `timing_events` and says bounds are taken
  with min/max: evidence that inverted source data exists and must be handled,
  not a claim about normalised intervals.

### 4. `web/src/components/dates.tsx`

```tsx
export function DateText({ value, prefer, offset }: { value: string | null | undefined; prefer?: 'absolute' | 'relative'; offset?: boolean }): ReactElement
export function SpanText({ start, end }: { start: string | null | undefined; end: string | null | undefined }): ReactElement
export function DurationText({ ms }: { ms: number | null | undefined }): ReactElement
```

One control for all three, so the exact value and any reason are reachable by
hover **and** keyboard everywhere, with no dense-table exception:

```html
<button type="button" class="time has-tip" data-tip="2026-09-08T14:05:00.123456Z"
        title="2026-09-08T14:05:00.123456Z"
        aria-label="3 h ago, exactly 2026-09-08T14:05:00.123456Z. Activate to copy">
  <time datetime="2026-09-08T14:05:00.123456Z">3 h ago</time>
  <span class="visually-hidden" aria-live="polite"></span>
</button>
```

`SpanText`/`DurationText` use the same button with the exact seconds as
tooltip, name and copied text; when unavailable the reason is the tooltip and
part of the accessible name (`Unavailable: the end precedes the start`), and
`.has-tip` already reveals it on `:focus-visible`. Copy uses
`navigator.clipboard.writeText`; on rejection or absence the tooltip becomes
`Copy is unavailable — the exact value is in this tooltip` and the live span
says so; on success it reads `Copied` for 1.5 s. An unavailable **date** is a
plain `<span class="unavailable">Unavailable</span>` — nothing exact to
reveal. Only `SpanText` has two endpoints, so reversal assertions live there.

### 5. `web/src/components/scopeLinks.tsx` and the scope helpers

**One pure URL operation**, shared by every entry point so encoding, trimming,
`offset` reset and preservation cannot diverge:

```ts
export function patchScope(search: URLSearchParams, patch: ScopeValues): URLSearchParams
```

It copies `search`, applies each entry with `set()`'s existing normalisation
(`trim()`; an empty result deletes the key), deletes `offset`, and leaves every
other parameter untouched — other base keys, `drill`, and non-scope
parameters. `set`, `toggle`, `remove`, `clear` and `scopeHref` are thin
wrappers. Encoding is `URLSearchParams`, so `trace & lab` round-trips. The app
uses `BrowserRouter`, so there is no fragment to preserve. Links push history,
so Back restores the previous scope.

```ts
toggle(key, value)                   // set when different, remove when equal (after trim)
remove(key)                          // patchScope(search, { [key]: '' })
clear()                              // every SCOPE_KEY and drill
scopeHref(key, value, target?): To   // { pathname: target ?? current, search }
```

On a target route only `SCOPE_PARAMS` travel (§0.2) — base keys **and**
`drill`; non-scope parameters belong to the page being left.

**`ScopeCell`** is a link, not a button, so middle-click and modifier-click open
a scoped view in a new tab.

- `value == null` → `Unavailable`; an unknown value cannot be filtered on.
- A dimension not in `SCOPE_KEYS` (today `model`, `period`) → **plain text**:
  the API would ignore the parameter and a link that narrows nothing is a lie.
  This is what makes `Session.tsx:36` convertible now and a link the moment #11
  lands, with no #46 edit.
- Inactive → `<Link to={scopeHref(...)} aria-label="Filter by source swe-chat">`.
- Active → the same link with `aria-current="true"`, class `scope-cell active`
  (accent fill plus an inset underline, not colour alone), an href with the key
  removed, and the name `Clear the source filter swe-chat`. **Active naming
  beats target-route naming**, so a matching source cell in the ledger
  announces clearing, not "show sessions from".
- `target` overrides the destination: omitted on `/overview` and `/sessions`;
  `/imports` and `/imports/:id` pass `target="/sessions"` because `listImports`
  takes no scope and the Console design exempts the ledger — the inactive name
  there is `Show sessions from source tracelab`. The report's provenance
  "Source" icon buttons are provenance actions and are untouched.
- Ids, external ids, hashes, locators and paths stay copyable text; the
  session-id anchor at `sessionsTable.tsx:13` is navigation and stays.

**`ScopeChips`** implements `ScopeChipsProps` (§0.3): nothing when no base key
and no envelope; base chips in `SCOPE_KEYS` order through `formatScopeValue`;
the derived drill chip last; `Clear all` at two or more chips; the focus
sentinel and the post-removal focus order.

### 6. `/settings` — a Console page

Route `<Route path="/settings" element={<SettingsPage />} />`. Not a data
route, so the existing `Bar` switch gives it the `FileBar`; the page calls
`useFileBar('Settings', [])`. Reached from `.rail .end` by an icon-only
`<Link className="btn small icon-only has-tip" to="/settings" aria-label="Settings" data-tip="Settings">`
with a new `settings` gear icon, unscoped like `/imports`.

- `h1 Settings`, sub `stored in this browser only, never on the server`.
- **Dates and times**: a `fieldset`/`legend` of three date-format radios, each
  labelled and followed by a live sample from the fixed instant
  `2026-09-08T14:05:00Z` **with the resolved zone named beside it**; a labelled
  zone `<select>` (`Viewer's zone (Europe/Paris)`, `UTC`, then every option,
  always including the effective value); a labelled relative-times checkbox. A
  `Notice kind="warn"` when `readDiagnostics().timeZone` reports a discarded
  zone.
- **Numbers**: a labelled locale `<select>` over `localeOptions(current)` with
  the live samples `num(1234567.89)` **and** `formatExactText('9007199254740993.5')`,
  so the lossless path is visible too; a note that month abbreviations are
  fixed English.
- **Theme**: a `ThemeToggle` **extracted from `AppShell.tsx:25-26` and shared
  with the rail**, so one implementation exists. It keeps the existing named
  `role="group"` + `aria-pressed` semantics rather than becoming a
  half-implemented radiogroup, and adds "The toggle in the top bar is a
  shortcut to this choice."
- **Defaults**: `Reset to defaults` with a `role="status"` line naming
  everything reset, theme included.

Every control writes immediately — no Save button, no dirty state — and the
page's own samples changing in place are the same-tab live-update evidence.
A `visually-hidden aria-live="polite"` region announces each change.

### 7. Styles

`.time` (an unstyled button with `text-decoration: underline dotted
var(--line-strong)`, `tabular-nums` inside tables); `.scope-cell` and
`.scope-cell.active` (`--accent-soft` plus an inset `--accent-line` underline);
`.chips`; `.settings-form` with borderless `fieldset`, small `legend`, `.sample`;
`.unavailable` (`--ink-4`); and the **fix** to `.theme-toggle` — drop
`overflow: hidden` (`base.css:174-176`), which clips the below-control tooltip
and the outward focus ring, and round the first and last child instead.
`.chip button` needs no new CSS: `data-tip` in `bars.tsx` reuses the existing
`.has-tip` rule.

## Files touched

New: `web/src/settings.ts`, `settings.test.ts`, `settingsContext.tsx`,
`format.test.ts`, `components/dates.tsx`, `components/scopeLinks.tsx`,
`components/ThemeToggle.tsx`, `pages/Settings.tsx`, `web/e2e/settings.spec.ts`,
`web/e2e/axe.ts`, `web/e2e/axe-baseline.json`, and this plan.

Edited:

| File | Change |
|---|---|
| `web/src/scope.ts` | `SCOPE_LABELS`, `SCOPE_VALUE_FORMATTERS`, `formatScopeValue`, `SCOPE_PARAMS`, `patchScope`; `set`/`clear` re-expressed on it; `scopeSearch` and `link` widened to `SCOPE_PARAMS`; `toggle`, `remove`, `scopeHref` added. |
| `web/src/format.ts` | `num`, `decimal`, `formatExactText`, locale-aware `display`/`abbreviate`, `parseInstant`, `formatDate`, `formatDuration`, `formatSpan`. |
| `web/src/components/bars.tsx` | `ScopeChip`'s remove button gains `data-tip`; `ScopeReceipt:50` → `num`, `:51` → `num`. (#11 owns `ScopeBar` in the same file.) |
| `web/src/components/primitives.tsx` | `KpiTile` `:150,158,159,160,166`, `QualityStrip` `:183` → `num`; `DataTable` caption count `:129` and `Pagination` `:57` → `num`. |
| `web/src/components/charts.tsx` | `:17,23,45,68` → `num`. |
| `web/src/components/index.ts` | Re-export the new components. |
| `web/src/components/icons.tsx` | The `settings` gear path. |
| `web/src/components/components.test.tsx` | New `describe` blocks (§ Tests). |
| `web/src/main.tsx` | Wrap `<App/>` in `<SettingsProvider>`. |
| `web/src/App.tsx` | The `/settings` route; `useSettings()` in `App`. |
| `web/src/AppShell.tsx` | The Settings link; the theme control becomes `<ThemeToggle/>`. |
| `web/src/App.test.tsx` | Scope-sensitive `/api/sessions` mock, a provider-wrapped `start()`, new tests. |
| `web/src/pages/sessionsTable.tsx` | Source/Agent → `ScopeCell`; `:16-17` → `DateText`; `:22` → `num`. |
| `web/src/pages/Sessions.tsx` | `<ScopeChips />`; `:22` → `num`. |
| `web/src/pages/Overview.tsx` | `<ScopeChips />` above the sessions panel. |
| `web/src/pages/Session.tsx` | Source/Agent/**Model (`:36`)** → `ScopeCell target="/sessions"`; `:37-38,48-49,65-66` → `DateText offset`; Observed and Declared span rows via `SpanText`; `:50` → `DurationText` under `Wall latency`; `:70,72,79,81` → `num`. |
| `web/src/pages/Imports.tsx` | Source → `ScopeCell target="/sessions"`; `:39` → `DateText prefer="relative"`; `:195,216` → `DateText`; `:12,191,209` → `num`; `seconds()` (`:60,67`) replaced by a `SpanText` line in the Lead's body, leaving the title sentence (and the existing e2e regex) intact. |
| `web/src/pages/Import.tsx` | `:264` → `<DateText prefer="relative" />` (mandatory); the 17 `toLocaleString` sites and `:128` → `num`. No structural change to the Passage route. |
| `web/src/pages/Assist.tsx`, `assist/ActionBar.tsx` (incl. `:69`), `assist/PayloadDrawer.tsx`, `assist/EvidenceRail.tsx`, `assist/DocumentEditor.tsx`, `import/components.tsx` | Number sites → `num`. Verbatim JSON untouched. |
| `web/src/styles/base.css` | `.time`, `.scope-cell`, `.chips`, `.settings-form`, `.unavailable`, the `.theme-toggle` clipping fix. |
| `web/playwright.config.ts` | A `settings` project (`dependencies: ['chromium']`, `timezoneId: 'Europe/Paris'`, `locale: 'en-US'`); `assistant` gains `'settings'` as a dependency, so ordering is chromium → settings → assistant and the two `epoch-assist` sessions cannot perturb the counts. |
| `web/package.json`, `web/pnpm-lock.yaml` | `@axe-core/playwright` as a devDependency. |
| `docs/adr/ADR-006-ui-design-direction.md` | An amendment recording `/settings`, the rail entry and per-browser-only persistence. |

Not touched: `pages/Gallery.tsx` (**cut**, #46b), any lint configuration
(**cut**, #46b), `docs/architecture/import-pipeline.md` (it describes the
implementation frozen at `2a351e9`), `scopeDimensions.ts`, `shellContext.tsx`,
`shellHooks.ts`, `import/importRuntime.ts`, everything under `backend/`, every
API contract.

## Tests

### `web/src/format.test.ts`

- *Grammar:* accepts `Z` and `±HH:MM` with 0–6 fraction digits; **rejects seven
  or more** (the precision the backend cannot emit and microsecond arithmetic
  cannot distinguish); rejects `2026-02-30T…`, `2026-02-29T…`, `'0'`, the
  offset-free form, leading/trailing whitespace, non-strings — each
  `Unavailable` with every field set, no throw. Accepts `2028-02-29T…`.
- *Verbatim:* `iso` equals the input byte for byte.
- *Formats:* three ids × `UTC`, `Europe/Paris`, `Asia/Kathmandu`, at midnight,
  noon and `14:05`.
- *Offset:* `(UTC+00:00)` in UTC (the bare-`GMT` normalisation), `(UTC+05:45)`,
  the two Paris fall-back instants as `+02:00` / `+01:00`, and spring-forward.
- *Relative:* just below, exactly at and just above 45 s, 90 min, 36 h, 7 d in
  both directions; 44.6 s → `1 min ago`; 89.9 min → `2 h ago`;
  `relativeTimes: false` → `relative === null`; non-finite `now` → absolute.
- *Durations:* the six bands, carry at 1 s, 10 s, 60 s, 60 min, 24 h;
  `undefined`, `NaN`, `±Infinity`, negatives → `Unavailable`; locale-grouped
  `exact`.
- *Spans:* normal; equal instants → `0 s`; a **sub-millisecond positive** span
  keeps its exact seconds; a **sub-millisecond reversed** span is `Unavailable`
  with `the end precedes the start`; missing/unreadable start and end each get
  their own reason.
- *Numbers:* `num` grouping per locale and `Unavailable` for null; `abbreviate`
  above 99,999 with a same-locale exact companion; **`formatExactText`** on
  `'9007199254740993'` (above `Number.MAX_SAFE_INTEGER`, must not lose the
  final digit), on `'1234567.891'`, on a negative, on a short value needing no
  grouping, and on non-numeric text (returned unchanged) — in `en-US` and
  `de-DE`, asserting the original string is preserved beside the formatted one.

### `web/src/settings.test.ts`

Defaults on empty storage; a patch persists, notifies and survives a reread;
corrupt JSON, a non-object, an unknown `dateFormat`, a non-string locale and an
unknown zone each fall back per field, record a diagnostic and never throw; the
`theme.ts` case preserved (stale storage + throwing `setItem` → in-memory
wins, so `components.test.tsx:123-139` keeps passing); persistence proved by
re-importing the module under `vi.resetModules()`, not a cached reread;
snapshot reference identity; `US/Eastern` canonicalised to `America/New_York`
and present in the options; an unsupported stored zone falls back **and**
surfaces a diagnostic; `fr-CA` accepted and offered; `supportedValuesOf`
missing takes the fallback list; `resetSettings()` restores defaults, sets the
theme to `system` and leaves every control consistent.

### `web/src/components/components.test.tsx` (additions)

`DateText` absolute (verbatim ISO in `title` and name, inside `<time
datetime>`); `DateText prefer="relative"`; copy success announces `Copied`; a
rejecting clipboard announces unavailability without throwing; an unavailable
date has no button; `SpanText` reversed → reason in tooltip **and** accessible
name, reachable by focus; `DurationText` formats and copies ms; `ScopeCell`
inactive/active/`null`/out-of-`SCOPE_KEYS` naming and hrefs, with active naming
beating target-route naming; `patchScope`/`scopeHref` over `trace & lab`, a
model with `+ & = # /` and Unicode, four-key removal and `Clear all`, `offset`
reset on add and clear, other base keys **and `drill`** preserved on a same
route, `drill` **carried** to a target route while non-scope params are
dropped; `ScopeChips` empty/one-per-key/derived-chip-last/`Clear all`, removal
clearing exactly one key, and the focus order next chip → `Clear all` →
sentinel; `ScopeChip`'s remove button carries `data-tip`.

### `web/src/App.test.tsx` (additions)

- A scope-sensitive `/api/sessions` mock (80 unscoped rows capped at
  `PAGE_SIZE`, 40 for `agent=codex`), so narrowing is proved by rendered rows,
  not only by the outgoing query.
- The scope round trip: click Agent → `?agent=codex`, request carries the key,
  rows drop, chip appears, removal restores URL **and** row count; clicking the
  active value clears it; the Imports **source** link targets `/sessions`.
- **The ambient propagation test:** under the production composition
  (`SettingsProvider > App > ShellProvider`) at `/overview`, change the number
  locale and assert a **KPI exact value, its coverage fraction and the scope
  receipt** — none of which subscribe — change grouping, with a DOM node
  identity check proving no remount and page-local state preserved. This fails
  if the `App` subscription is omitted, which a `DateText` test would not
  catch.
- **The mounted-ledger test:** with `/imports` on screen, `setSettings({
  dateFormat: 'dmy' })` re-renders it with no navigation and no remount, and
  `setSettings({ numberLocale: 'de-DE' })` regroups its **large** counts
  (fixtures use ≥ 4-digit records, sessions and model calls).
- **The assistant and import locale tests:** `/import` at a step showing a
  ≥ 4-digit record count, and the assistant action bar showing
  `recordCount` and `records.sampled`, both regroup under `de-DE` while the
  emission `JSON.stringify` line stays byte-identical.
- **The locale sweep** (the replacement for the lint ban): render `/overview`,
  `/sessions`, `/sessions/:id`, `/imports`, `/imports/:id`, `/import` and
  `/settings` under `de-DE` with fixtures whose every count is ≥ 1000, walk the
  text nodes, and fail on any number of four or more digits that lacks the
  locale's group separator, excluding elements marked as verbatim (`.json`,
  `.mono` ids/hashes/locators, `<time datetime>` and the emission list).
- `/settings`: every control labelled; choosing a format writes storage; reset
  restores defaults and the `system` theme; the diagnostics notice appears for
  a bad stored zone.
- The rail Settings link exists with the accessible name `Settings`.
- `afterEach` clears both storage keys and resets the module registry.

### `web/e2e/settings.spec.ts`

Project `settings`, after `chromium`, before `assistant`; `timezoneId:
'Europe/Paris'`, `locale: 'en-US'`.

1. **Scope round trip.** `/sessions` → click `codex` → `?agent=codex`, **40**
   data rows, chip `Agent codex` → remove → 50 rows (`PAGE_SIZE`), receipt and
   pagination restored. Screenshots either side.
2. **Same-tab live update.** On `/settings`, turn relative times off and choose
   `08 Sep 2026 14:05`; the page's own samples change **in place**, with no
   navigation and no reload. Then navigate client-side to `/imports` and assert
   the Started column matches `/^\d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}$/`;
   reload and assert again (persistence).
3. **Relative, separately.** Turn relative times on; the ledger row for the
   import this run created matches `/just now|\d+ min ago|\d+ h ago/`.
4. **Offset.** Zone `UTC`; on a session page the Interval facts **and** a
   model-call Started cell both end `(UTC+00:00)`.
5. **Exactness.** Fetch `/api/sessions?agent=codex`, take a **named** session's
   `observed_start_at`, find that session's row by external id, assert the
   cell's `title` equals that string exactly.
6. **Keyboard.** Tab to a timestamp: visible focus ring and tooltip; Enter
   copies. Tab to a chip's remove button: Enter removes it and focus lands per
   §0.3. Middle-click and modifier-click a scope cell: a new page opens on the
   scoped URL and the original page's URL is unchanged. Repeat the focus-ring
   and tooltip checks in the dark theme; check the last row and the horizontal
   scroll edge.
7. **Axe.** `web/e2e/axe.ts` runs `AxeBuilder` (`wcag2a`, `wcag2aa`) on
   `/overview`, `/sessions`, `/sessions?agent=codex` (an active chip),
   `/sessions/:id`, `/imports`, `/imports/:id` (the edited report and the
   already-imported notice) and `/settings`, in **both themes**, after data has
   loaded, asserting the `(ruleId, target)` set is a subset of
   `web/e2e/axe-baseline.json` — **no rule is ever globally disabled**, so a
   new target under an existing rule fails. The baseline is captured with the
   same helper against the pre-change revision and every entry carries a note.
   The helper asserts a non-empty `passes` array so a silent no-op cannot look
   like success.
8. **Screenshots** to `test-results/tables-dates-settings/`. Nothing committed.

### Full verification

```
pnpm --dir web lint && pnpm --dir web typecheck && pnpm --dir web test && pnpm --dir web build && pnpm --dir web e2e
uv --directory backend run pytest -q     # unchanged; proves no backend drift
```

## Acceptance checks mapped to the issue's tasks

| Issue task | Verifiable acceptance check |
|---|---|
| Plan reviewed | Revised twice against Codex; §0 is a joint contract written against the now-existing #11 plan with every disagreement named and either resolved here or listed as a §0.6 handoff. |
| `settings.ts` + `useSettings()` + `/settings` in the shell | `settings.test.ts` covers defaults, persistence across a module reset, per-field validation with diagnostics, the local precedence rule, canonicalisation and snapshot identity; `App.test.tsx` proves the labelled page and reset; Playwright reaches it from the rail icon and Axe scans it in both themes. |
| `formatDate` / `formatDuration` with tests; replace every raw timestamp | `format.test.ts` covers the 0–6-digit grammar (including the three inputs `Date.parse` would silently accept), three formats across three zones, DST and `+05:45`, the relative boundaries both ways, the duration bands with carry, and microsecond-exact spans. The *Where each rendering is used* table is the maintained inventory; all six rows convert, `Import.tsx:264` included, with the verbatim exemption written down. |
| Source / agent cells as scope links; chips above tables | Component tests assert `Filter by source swe-chat`, `Clear the agent filter codex`, anchors not buttons, the active marking, the text fallbacks, URL-encoding edges, drill preservation and post-removal focus; Playwright does click → 40 rows → chip → remove → 50 rows, plus keyboard and new-tab activation. |
| Playwright and Axe coverage; screenshots | `settings.spec.ts` runs eight scenarios including a baseline-compared Axe scan of seven route states in two themes, writing five screenshots to ignored output. |
| Persist per browser, never on the server | No `backend/` change, no new API call; `settings.ts` touches only `localStorage`; persistence proved by a module-reset reread and by a Playwright reload. |
| Every page reflects a change without reload | Same-tab evidence, three ways: the Settings page's own samples change in place; a mounted `/imports` re-renders under `setSettings` with no navigation or remount; the ambient test proves unsubscribed consumers update. |
| Grouping and decimals follow the preference on every page | Both inventory classes migrate; the locale sweep fails on any four-digit rendered number lacking the locale separator; named assertions cover a mounted ledger, the import page and the assistant; `formatExactText` carries #11's lossless text. |
| "Unavailable" is designed; never a fabricated "now" | Unit tests assert `Unavailable` for null, ambiguous, impossible and over-precise inputs, missing and unreadable endpoints and reversed spans, and that no path substitutes the current time. |

## Risks

- **The #11 handoff (§0.6) is not yet landed.** Six specific edits are required
  in `2026-09-08-dashboard.md`. Until they are, the drill-preservation and
  exact-text behaviours are agreed in one plan only. This is the single largest
  risk and it is a coordinator action, not an engineering one.
- **Shared files.** `scope.ts`, `bars.tsx`, `primitives.tsx`, `charts.tsx`,
  `Overview.tsx`, `sessionsTable.tsx`, `components/index.ts`, `App.test.tsx`,
  `components.test.tsx`, `base.css`. Mitigated by the single chosen order
  (#46 first, checkpoint 2026-09-09T18:00Z) and by #46's edits there being
  mechanical.
- **#39 overlaps** `assist/DocumentEditor.tsx`, the assistant surfaces and
  `pages/Imports.tsx`. #46's edits to those files are number substitutions
  only; the handoff is a checkpoint in the schedule, and whichever lands second
  rebases.
- **The number migration is wide** (two classes, 14 files). Mechanical, but it
  is the main merge friction, which is why it is scheduled first and guarded by
  the sweep rather than by a lint rule.
- **The ambient number path depends on `App` re-rendering**, pinned by a test
  on consumers that hold no subscription, so a future `memo` breaks the test
  rather than the product.
- **`Intl` varies by engine** — mitigated by `formatToParts` with explicit
  calendar, numbering system and hour cycle, a fixed English month table, and
  the bare-`GMT` normalisation.
- **`bigint` instant arithmetic is unusual here** — confined to
  `parseInstant`/`formatSpan`, and the only way to catch the sub-millisecond
  reversals `Date.parse` hides.
- **The Axe baseline may be large** — every entry recorded with rule, target
  and a note; one-line fixes are fixed rather than recorded.
- **Cross-tab is deferred**, so two open tabs can disagree until one reloads.
  Documented on the Settings page ("this choice applies to tabs you open or
  reload") and tracked as #46b.
- **The schedule is tight** — see the explicit decision point below.

## Cost estimate

Revision 2's 29 h was an effort figure, not a release-safe path. Re-costed for
the trimmed slice, with the cuts removed and this review's new work added:

| Work | Hours |
|---|---|
| `settings.ts` (validation, canonicalisation, diagnostics, local precedence) + tests | 3.5 |
| `parseInstant`, `formatDate`, `formatDuration`, `formatSpan` + tests | 5 |
| Number migration, both classes, 14 files; `formatExactText` + tests; the locale sweep; the ambient, ledger, import and assistant assertions | 6 |
| `patchScope` / `SCOPE_PARAMS` / drill carrying, `toggle`, `remove`, `scopeHref`, `ScopeCell`, `ScopeChips` with focus sentinel + tests | 4.5 |
| `dates.tsx`, `ThemeToggle` extraction, the Settings page, styles, the clipping fix | 3.5 |
| Axe baseline + `settings.spec.ts` incl. keyboard and screenshots | 4.5 |
| ADR amendment, #11 and #39 integration checkpoints, full CI, review fixes | 3 |
| **Subtotal** | **30** |
| Cuts removed (Gallery 1, lint rule 0.5, `useNow` + timer tests 1.5, cross-tab listener + two-tab and browser-matrix tests 3.5) | **−6.5** |
| **Trimmed slice** | **23.5** |
| Integration/review contingency (#11 rebase, #39 handoff, unknown Axe findings) | **+4** |
| **Provisional working budget** | **27.5** |

Dated critical path. The consolidated plan freezes features at the **end of
Day 3, 2026-09-10** (`docs/planning/2026-09-07-consolidated-plan.md:118-122`),
and Day 4 belongs to #19, so the target is an **integrated, green acceptance
candidate by `2026-09-10T23:00Z`** — not September 11.

- **Sep 8, remainder** — this revision; §0.6 handed to #11's reviewer; the
  settings store, the formatters and the Settings page, none of which depend
  on #11.
- **Sep 9** — dates everywhere, `ScopeCell`/`ScopeChips` composed over main's
  `scope.ts`, the Model cell, the locale migration of every file that is not
  #11's, and the e2e spec with its Axe baseline. **#11 runs in parallel
  throughout; #46 never edits #11's six files.**
- **Sep 10, to 18:00Z** — **rebase after #11 merges**: the locale migration of
  `primitives.tsx`, `charts.tsx` and `bars.tsx`, `formatExactText` wired into
  #11's exact surfaces, `ScopeChips` above the Overview sessions panel, and
  the chip-tooltip assertion once #11's leaf carries it. **Checkpoint 14:00Z:
  #39 handoff on the assistant and `Imports.tsx` files.**
- **Sep 10, to 23:00Z** — integrated #46/#11 acceptance green, keyboard and
  screenshot evidence. September 11 is left to #19.

**The honest arithmetic, and the decision it forces.** 27.5 h against roughly
20 available hours between now and 2026-09-10T23:00Z is a deficit, and #11
independently estimates 18–26 h plus 2–4 contingency (`11:675-681`) over the
same window. This plan does **not** close that gap by dropping mandatory
timestamps, locale consumers, accessibility work or contract integration. It
asks the coordinator to choose, at the **Sep 9 09:00Z checkpoint**, from a
pre-agreed contingency list that costs nothing in acceptance:

| Contingency cut | Saves | Why acceptance survives |
|---|---|---|
| Capture no pre-change Axe baseline; instead require **zero** violations on the routes #46 changes and record (not fix) any pre-existing violation on unchanged routes | 2 h | The issue asks for "no new violations"; a zero requirement on changed routes is stricter, and unchanged routes are unchanged. |
| Reduce the Playwright keyboard sweep to one timestamp, one chip and the focus order, moving the rest to unit tests | 1.5 h | The behaviours are still asserted, in jsdom rather than a browser; the visual focus ring and tooltip checks stay in the browser. |
| Defer `formatExactText`'s **integration** into #11's surfaces (the formatter, its tests and the Settings sample still ship) | 1 h | Nothing in #46's own surfaces renders transport text today; the integration lands with #11 rather than ahead of it. |
| **Floor** | **23 h** | |

If 23 h still does not fit, the correct action is to move #46 out of v0.1.0,
not to ship it with fabricated dates, an `en-US` island or an unproven
accessibility claim. Owner availability and the coordinator's ordering
decision are the two inputs this plan cannot supply.

---

## Revision 2 after the first Codex review (condensed)

The full detail now lives in the design sections; each finding is answered
there. In summary, all 16 were accepted, none contested: **1** one formatting
path with a full inventory and the exact-value rule preserved; **2** one
storage precedence rule replacing the `chosen`-wins wording; **3** the #11
interface written out with #46 owning every Model cell and `ScopeCell`
degrading to text for an unsupported dimension; **4** the Playwright date path
rebuilt (relative off, pinned zone, an already-mounted page); **5** the
propagation test moved to an ambient consumer; **6** the bare-`GMT`
normalisation and per-instant offsets on all session timestamps; **7** a
validated ISO grammar replacing `Date.parse`; **8** microsecond `bigint`
arithmetic, distinct reasons, defined carry; **9** a rounding policy with band
promotion and the near-future contradiction resolved; **10** canonicalised
zones and locales with diagnostics and always-present current options;
**11** one pure `patchScope` shared by every entry point; **12** the chip
tooltip upgrade, the shared `ThemeToggle` keeping its `aria-pressed`
semantics, the `.theme-toggle` clipping fix, keyboard-reachable duration
reasons and the withdrawal of the `copy={false}` escape hatch; **13** the
corrected `web/pnpm-lock.yaml` path and a subset-compared Axe baseline with no
rule ever disabled; **14** the corrected claim about `assist.spec.ts:75`,
mandatory `Import.tsx:264`, scope-sensitive fixtures and 40-vs-50 row counts;
**15** a rebuilt estimate; **16** the corrected inversion claim, refreshed line
references and `import-pipeline.md` left alone.

## Revision 3 after the Codex second-pass review

This section supersedes anything above it that conflicts. The review carries
**five P1-tagged findings** (original 1, 2 and 3, plus C1 and C4) and **four
P2** (C2, C3, the estimate, the precision), and a five-line scope
recommendation. All are accepted; none is contested. Every reproducible claim
was checked in this worktree before acceptance, and each check is recorded.

**P1 — original 1, application-wide number locale (was OPEN). Closed.**
Verified every named omission: `bars.tsx:51` renders `{imports}` raw,
`Session.tsx:70` renders `{coverage.known} / {coverage.total}` raw, `:72` the
diagnostics count, `:79` and `:81` the two call counts, and `Import.tsx:128`
`String(state.entries.length)`. The inventory is now **two classes** — (a) the
41 `toLocaleString('en-US')` sites and (b) the raw JSX interpolations, listed
with file and line, including three the review did not name
(`primitives.tsx:57,129`, `sessionsTable.tsx:22`, `Imports.tsx:191,209`) — and
the `Session.tsx`, `bars.tsx`, `primitives.tsx` and `Import.tsx` rows in Files
touched now assign those conversions explicitly. The review is right that a
`toLocaleString` ban cannot catch class (b); the ban is **cut to #46b** and
replaced by the **rendered-output locale sweep**, which fails on any rendered
four-digit number lacking the chosen locale's separator across seven routes.
Named assertions are added for a mounted Imports ledger with large counts, for
`/import`, and for the assistant action bar. The Revision 2 sentence offering
the assistant/import migration as a schedule valve is **deleted**; the
contingency list contains no such option.

**P1 — original 2, storage precedence (CLOSED, confirmed).** Nothing regressed:
§1 keeps the `persisted`-flag rule, the theme regression at
`components.test.tsx:123-139` and the pre-paint bootstrap. The cross-tab half
is now explicitly **deferred to #46b** per the scope recommendation; because
the flag already distinguishes a landed write from a failed one, #46b adds a
`storage` listener and nothing else, and §1 retains the full event policy
(`key === null`, `newValue === null`, malformed values) so the follow-up has
no design work left.

**P1 — original 3, #11 agreement (was OPEN; Model-cell ownership CLOSED).**
The absence claim is withdrawn: the sibling plan exists and was read in full.
§0 is now a **dated joint contract** (2026-09-08) written against it, quoting
its line ranges, and §0.6 lists the six changes #11's plan must make — which I
cannot commit from this worktree and which the coordinator must land before
either implementation starts. **The reviewer found real disagreements, not
agreement**: they are C1 (drill preservation), C2 (chip contract), C3 (period
semantics and merge order) and C4 (exact text), each resolved below. Model-cell
ownership stays closed: `Session.tsx:36` converts now, `routers.py:199-208`
confirms only Source and Agent narrow anything today, and `ScopeCell` renders
text for an unsupported dimension.

**P1 — C1, drill preservation and clearing. Closed.** Verified
`scope.ts:32-36`: `scopeSearch` serialises base keys only, so Revision 2's
target-route rule would have dropped `drill` and lost a tool, quality, day or
accounting drill on a Session Model or Source link. §0.2 introduces
`SCOPE_PARAMS = [...SCOPE_KEYS, 'drill']`, distinguishes base-key **order**
from the **full serialised scope**, carries `drill` across target-route links,
widens `scopeSearch` and `link`, and routes chip removal and `Clear all`
through the agreed reconciliation (a removed dimension and its unknown
predicate are deleted from the effective envelope, never left silently
active). "Charts call `set()`" is replaced by "charts call #11's
`setDrill(envelope)` for server-returned scopes". Shared tests are named for a
tool or accounting drill through a Session cell target, Model removal, Period
removal, `Clear all` and Back, asserting effective API scope and displayed
chips together. The reciprocal fixes — #11's overlay that retains
`scope.model` after removal (`11:295-298`) and the `11:564-565` vs
`11:312-315` contradiction — are handoff items 1 and 2.

**P1 — C4, exact text. Closed.** Verified `11:328-371,452-455,503-511`: #11
replaces KPI values, coverage, receipts, tooltips, focus hints and the
accessible table with lossless transport **text**, which a `num(number)`
substitution cannot survive, which renders ungrouped if passed through raw, and
which `Number` would corrupt. §0.5 and §3 add `formatExactText(text,
settings)` — a decimal-**string** grouper that takes the `group` and `decimal`
separators from `formatToParts` and never parses to a number, keeping the
original string beside it for copy and transport. `11:216`'s "#11 touches no
number formatting" is withdrawn: handoff item 5 requires #11 to call it for
every visible exact surface, and the joint test uses a value above
`Number.MAX_SAFE_INTEGER` and one with a fractional decimal — both also
asserted in `format.test.ts`, and the second is a visible sample on the
Settings page.

**P2 — C2, the chip contract. Closed.** §0.3 publishes typed `ScopeChipsProps`
(`keys`, `includeDrill`, `label`), **fixes the placement** (above the Overview
sessions panel and the Sessions table; base chips then the derived chip) and
withdraws the optional chart placement, folds the derived chip into the empty
check, the `Clear all` threshold and the focus order, and replaces the
caption-based focus fallback with a self-contained `role="status"` sentinel.
The agreed `ScopeChip` wording is the reviewer's: public leaf props unchanged,
#46's `.has-tip`/`data-tip` upgrade preserved (handoff item 3), and both plans
name the same post-removal keyboard test.

**P2 — C3, period and merge order. Closed.** The complete period contract is
copied from `11:269-276`: `all` omitted, `7d`/`30d`/`90d`, UTC midnight bounds
through today, the `Period (UTC)` label, `resolvePeriod(period, now)`, and
**never sending a literal `period`** — so Revision 2's "when endpoints accept
them" is corrected to "when client date-bound resolution and the receiving
endpoints exist". One coordinator-owned order is chosen — **#46 first,
checkpoint 2026-09-09T18:00Z** — replacing the claim that both orders need no
adaptation, with the reciprocal bootstrap stated (a #11-first landing must
initialise all four labels and the period formatter). The bars ownership claim
is corrected: `11:503-504` does replace `ScopeBar`'s controls and receipt;
#46's edits there are confined to `ScopeReceipt:50-51` and `ScopeChip:45-46`.

**P2 — the estimate. Closed.** Verified the freeze rule at
`docs/planning/2026-09-07-consolidated-plan.md:118-122` ("Feature freeze at end
of day" for Day 3, 2026-09-10) and #11's own 18–26 h plus 2–4 contingency
(`11:675-681`). The target moves to an integrated green candidate at
**2026-09-10T23:00Z**, leaving September 11 to #19. The trimmed slice is
**23.5 h** with a **+4 h** integration and review contingency (**27.5 h**
provisional), #11 and #39 checkpoints are dated, and the plan states plainly
that 27.5 h does not fit roughly 20 available hours. Rather than hide that, it
publishes a pre-agreed contingency list (Axe baseline, keyboard sweep,
`formatExactText` integration) reaching a **23 h floor**, none of which costs an
acceptance criterion, and says that if 23 h still does not fit the correct
action is to move #46 out of v0.1.0.

**P2 — timestamp precision. Closed, taking the smaller scope.** The review is
right that accepting nine fraction digits while comparing in microseconds
leaves `…123456789Z` and `…123456788Z` indistinguishable. The grammar is
constrained to the API's **0–6** digits and seven or more are rejected as
`Unavailable`, with a named test. Evidence for the six-digit contract:
`UtcDateTime` (`models.py:41-55`) stores a Python `datetime`, whose resolution
is microseconds, and `units.py:120-140` already records `precision_reduced`
when a source value carries more, so nothing above six digits can reach the
wire.

**Scope recommendation — adopted.** § Scope of this slice ships all five
recommended items and cuts four to **#46b**: the exhaustive Gallery expansion
(dev-only, `App.tsx:16`), the proactive formatter lint ban (replaced in-slice
by the stronger locale sweep), automatic minute-by-minute relative aging
(labels compute at render; nothing requires ageing without interaction), and
cross-tab synchronisation with its browser matrix (same-tab live update and
reload evidence replace it, and the precedence rule is already implemented so
#46b is a pure addition). Nothing mandatory is cut: every timestamp including
`Import.tsx:264`, every locale consumer including the assistant and import
surfaces, all accessibility work and the full contract integration stay in the
v0.1.0 slice.
