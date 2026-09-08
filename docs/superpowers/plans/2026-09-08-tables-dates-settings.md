# Plan: Interactive tables, readable dates, settings page (issue #46)

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
format on `/settings` and watching the Imports ledger re-render without a
reload or a navigation; reloading and finding the choice still applied; and
hovering or activating any timestamp to get the byte-exact ISO string the API
returned.

## Current state

Verified in this worktree at `8aab14f`.

### Scope

- `web/src/scope.ts` is the whole scope mechanism: `SCOPE_KEYS = ['source',
  'agent']`, `readScope`, `scopeKey`, `scopeSearch`, and `useScope()` returning
  `{ scope, key, offset, set, clear, setOffset, link }`. `set(patch)` writes the
  keys into the URL and deletes `offset`; `clear()` deletes every scope key.
  There is no per-key remove, no toggle, and no helper that builds a `To` for a
  single scope change. Its docstring already reserves `model` and `period` for
  #11.
- `web/src/scopeDimensions.ts` derives Source/Agent suggestions from the loaded
  session rows (temporary until a facets endpoint).
- `web/src/components/bars.tsx` holds `ScopeBar` (typed inputs bound to the URL,
  Clear, receipt), `ScopeChip` (`label`, `value`, `onRemove`; renders
  `.chip` with an `x` button named `Remove {label} {value}`) and `FileBar`.
  `ScopeChip` is currently used by nothing but `web/src/pages/Gallery.tsx`.
- No table cell uses the scope. `web/src/pages/sessionsTable.tsx` renders
  `session.source` as bare text and `display(session.agent)`;
  `web/src/pages/Imports.tsx` renders `r.source` as bare text;
  `web/src/pages/Session.tsx` renders `session.source` / `display(session.agent)`
  in the Identity `dl.facts`.

### Timestamps

- The API returns UTC ISO-8601 strings ending in `Z`, with microseconds only
  when non-zero (verified: application DTOs are dataclasses serialised by
  FastAPI through Pydantic; `TypeAdapter(datetime).dump_json` on a UTC instant
  produces `"2026-06-04T12:34:56.123456Z"` and `"2026-06-04T12:34:56Z"`).
  `backend/.../db/models.py::UtcDateTime` guarantees every stored instant is
  UTC-aware, so a rendered value is never ambiguous.
- Every timestamp on screen today is the raw string:
  `web/src/pages/sessionsTable.tsx:16-17` (Observed start / end),
  `web/src/pages/Session.tsx:37-38,48-49` (model and tool call Started / Ended),
  `web/src/pages/Session.tsx:65-66` (Interval panel, four facts),
  `web/src/pages/Imports.tsx:39` (ledger Started), `:195` (file bar Started),
  `:216` (report Started / Finished), and
  `web/src/pages/Import.tsx:264` (`already_imported[].imported_at`).
- Durations: `web/src/pages/Imports.tsx:60` `seconds(report)` is a private
  `<1 s` / whole-second helper; `web/src/pages/Session.tsx:52` prints
  `wall_latency_ms` as a bare number under the header `Wall latency (ms)`. There
  is no session span anywhere, although `research/insights/MERGED.md` §1.6 makes
  "observed span in imported data" a named quantity with a fixed label and a
  fixed caveat, and §1.12 requires per-cell `Unavailable` with a reason.
- `web/src/format.ts` has `PAGE_SIZE`, `display`, `entityCounts` and
  `abbreviate`. No date helper. `display` and `abbreviate` hard-code
  `toLocaleString('en-US')`; 43 `toLocaleString` call sites exist across 13
  files under `web/src`.

### Per-browser settings

- `web/src/theme.ts` is the only one: key `agentscope-theme`, a module-level
  `listeners` set, a `chosen` in-memory fallback so a choice still applies when
  `localStorage` throws (private mode), `applyTheme` stamping `data-theme` on
  the root, and `useTheme()` built on `useSyncExternalStore`. The brief says to
  extend this pattern, not replace it.
- `web/src/AppShell.tsx` renders the three-way theme toggle in `.rail .end`
  beside the primary Import link. `THEMES` is `[light, system, dark]` with icons
  `sun`, `monitor`, `moon` and labels that are both `aria-label` and `data-tip`.
- `web/src/App.tsx` owns the route table and the `Bar` switch: `/overview` and
  `/sessions*` get the `ScopeBar`, everything else gets the `FileBar`. There is
  no `/settings` route. `web/src/main.tsx` renders `<App/>` inside the router.
- `web/src/shellContext.tsx` + `shellHooks.ts` let a page declare its bar. Note
  that `ShellProvider` passes `children` through, so a provider state change
  does **not** re-render the routed tree; only context consumers re-render. This
  is the fact that decides the settings propagation design below.

### Design of record and rules

- ADR-006 fixes the Console variant: one global scope, drilling appends a chip
  to that scope and there is no second drill mechanism (rule 1); `Unavailable`
  is a rendered state (rule 2); trust surfaces one step away in the same place
  every time (rule 3). Its 2026-09-08 amendment records that icon-only secondary
  actions keep an accessible name and a visible tooltip.
- `research/design/claude/3-console/README.md` fixes the visual system, the
  36 px row / 13 px table density, `tabular-nums` on every number, the 2 px
  focus ring, and the accessibility contract (captions, `th scope=col`,
  `aria-live` receipts). Its IA table has no `/settings` route, so adding one
  needs an ADR-006 amendment in the same style as #45's.
- `web/src/styles/base.css` already provides `.chip`, `.has-tip` tooltips
  (including the `table .has-tip::after { left:auto; right:0 }` rule that keeps
  a tooltip inside a table), `.field`, `.row`, `.panel`, `dl.facts`,
  `.visually-hidden`, `.theme-toggle` and the global reduced-motion rule.

### Tests and CI

- `web/src/App.test.tsx` mounts the real `<App/>` over a `fetch` mock and
  `web/src/test/fixtures.ts`; `web/src/components/components.test.tsx` covers
  the primitives including `ScopeBar`/`ScopeChip`; `web/src/api/index.test.ts`
  and `web/src/styles/tokens.test.ts` exist. There is no `format` test file and
  no settings module.
- `web/e2e/smoke.spec.ts` (project `chromium`) imports the fixture and is
  depended on by the `assistant` project. No spec asserts on a rendered
  timestamp, so no existing e2e assertion breaks. There is **no** Axe
  dependency anywhere in the repo (`@axe-core/playwright` is not installed).
- Commands: `pnpm --dir web test | lint | typecheck | build`, `pnpm --dir web e2e`.

### Parallel work

Issue #11 (dashboard KPIs, charts, drill-down, model and period filters) is
being planned in `/Users/sean/dev/AgentScope-wt/11`; no plan file exists there
yet. It shares `web/src/scope.ts`, `web/src/pages/sessionsTable.tsx`,
`web/src/pages/Overview.tsx`, `web/src/components/bars.tsx` and
`web/src/components/primitives.tsx` with this issue.

## Design

### 0. The contract shared with #11

Stated here so both plans can agree before either implements. **There is one
filter mechanism: the URL scope.** Nothing renders a chip by hand and nothing
holds drill state beside the scope; a drill-down is `set({ model: 'x' })` and
the chip appears because the URL changed. This is ADR-006 rule 1 taken
literally, and it is what keeps the two issues from growing two mechanisms.

| Item | File | Owner | Contract |
|---|---|---|---|
| `SCOPE_KEYS` | `scope.ts` | **#11** | Grows to `['source', 'agent', 'model', 'period']` when #11's endpoints accept them. #46 adds no key and reads the array generically, so model/period cells and chips work the day #11 lands. |
| `SCOPE_LABELS: Record<ScopeKey, string>` | `scope.ts` | **#46 creates, #11 extends** | `{ source: 'Source', agent: 'Agent' }` now; #11 adds `model: 'Model'`, `period: 'Period'` in the same commit that extends `SCOPE_KEYS`. Type-checked exhaustively, so a missing entry is a build error, not a blank chip. |
| `formatScopeValue(key, value): string` | `scope.ts` | **#46 creates, #11 extends** | Identity for `source`/`agent`/`model`; #11 supplies the readable rendering for `period` (`7d` → `last 7 days`). Chips and cell names both go through it. |
| `useScope().toggle(key, value)` and `.remove(key)` and `.scopeHref(key, value, pathname?)` | `scope.ts` | **#46** | #11 does not add its own; it calls `set()` for a drill and these for chips. |
| `<ScopeChips />` | `components/scopeLinks.tsx` (new) | **#46** | Reads `useScope()` itself and renders one `ScopeChip` per active key. #11 puts `<ScopeChips />` above its charts if it wants the readout there; it never renders `ScopeChip` directly. |
| `ScopeChip` | `components/bars.tsx` | unchanged | Existing signature `{ label, value, onRemove }` is kept exactly. No edit to `bars.tsx` is required by #46. |
| `<ScopeCell dimension value target? />` | `components/scopeLinks.tsx` (new) | **#46** | The only way a table cell becomes a filter. #11's Model column uses it with `dimension="model"` and needs no new code. |
| Period filter, chart drill-down, facets endpoint | — | **#11** | #46 touches none of them. |
| Table cells, chips above tables, dates, durations, settings | — | **#46** | #11 touches none of them. |

Merge surface: #46's edit to `scope.ts` is three added exports plus three added
functions inside `useScope()`; #11's is two array entries and two record
entries. Different regions of the file; a textual conflict is unlikely and
trivial if it happens.

### 1. `web/src/settings.ts` — the store

Same shape as `theme.ts` (a module store read through `useSyncExternalStore`),
one storage key, no server call, ever.

```ts
export type DateFormatId = 'iso' | 'dmy' | 'mdy'
export type ZonePreference = 'viewer' | string        // 'UTC' or an IANA name
export interface Settings {
  dateFormat: DateFormatId
  timeZone: ZonePreference
  relativeTimes: boolean
  numberLocale: string                                // a BCP-47 tag
}

export const DEFAULTS: Settings = { dateFormat: 'iso', timeZone: 'viewer', relativeTimes: true, numberLocale: 'en-US' }
export const STORAGE_KEY = 'agentscope-settings'
export const DATE_FORMATS: readonly { id: DateFormatId; label: string; example: string }[]
export const NUMBER_LOCALES: readonly { id: string; label: string }[]

export function readSettings(): Settings                 // getSnapshot; stable identity
export function setSettings(patch: Partial<Settings>): void
export function resetSettings(): void
export function subscribe(listener: () => void): () => void
export function resolveTimeZone(settings: Settings): string   // validated IANA name
export function resolveLocale(settings: Settings): string     // validated BCP-47 tag
export function timeZoneOptions(): string[]
```

Rules:

- **One JSON object** under `agentscope-settings`. Reading validates every field
  independently and silently substitutes the default for anything unknown,
  missing or malformed, so a corrupt or hand-edited value can never break a
  page. Unknown extra keys are dropped on the next write.
- **Stable snapshot identity.** `readSettings()` caches the parsed object and
  returns the same reference until a write or a `storage` event invalidates the
  cache. Without this, `useSyncExternalStore` re-renders forever; a unit test
  asserts identity is preserved across calls.
- **Private-mode fallback**, exactly as `theme.ts` does it: a module-level
  `chosen: Settings | undefined` holds the last choice made on this page and
  wins over storage; `localStorage.setItem` is wrapped in `try/catch` so a
  throwing storage still applies the choice for the session.
- **Cross-tab.** A `window` `storage` listener for our key invalidates the cache
  and notifies listeners, so a second tab follows. (Cheap, and it is the honest
  meaning of "per browser".)
- **`resolveTimeZone`** returns `Intl.DateTimeFormat().resolvedOptions().timeZone`
  for `'viewer'`, and otherwise validates the stored name with
  `new Intl.DateTimeFormat('en-US', { timeZone })` inside `try/catch`, falling
  back to the viewer's zone. `timeZoneOptions()` returns
  `Intl.supportedValuesOf('timeZone')` when available, else
  `['UTC', resolved viewer zone, the currently stored zone]` deduplicated.
- **`resolveLocale`** validates with `Intl.NumberFormat.supportedLocalesOf`,
  falling back to `en-US`.
- **`resetSettings()`** writes `DEFAULTS` *and* calls `setTheme('system')`,
  because theme is one of the choices the page shows. The page's confirmation
  copy says so.
- **Theme is not duplicated here.** `theme.ts` stays the store for theme (the
  brief: the pattern to extend, not replace); the Settings page renders a
  control bound to `useTheme()`, and the rail toggle stays as a shortcut. Two
  storage keys, one for theme and one for display settings, is the smallest
  change that keeps `applyTheme` running before React mounts.

### 2. `web/src/settingsContext.tsx` — the hook

```tsx
export function SettingsProvider({ children }: { children: ReactNode }): ReactElement
export function useSettings(): Settings
```

`SettingsProvider` subscribes once with `useSyncExternalStore(subscribe,
readSettings, () => DEFAULTS)` and publishes the value on a context.
`useSettings()` calls **both** `useContext(SettingsContext)` and the store hook
unconditionally and returns the context value when there is one — no
conditional hook, and components rendered without a provider (unit tests, the
dev gallery) still work. The provider wraps `<App/>` in `web/src/main.tsx`.

**How every page re-renders without a reload.** `App` itself calls
`useSettings()`. A settings change therefore re-renders `App`, which recreates
the whole element tree below it (`ShellProvider`, `AppShell`, `Routes` and the
active page), so every rendered number and date is recomputed. `DateText`,
`ScopeCell` and the Settings page also consume the context directly, so they
stay correct if a `memo` is introduced later. A unit test pins this: the
Imports ledger, already on screen, changes format when the store changes, with
no navigation and no remount.

`useNow()` (in `settingsContext.tsx`, 12 lines): one module-level interval that
ticks every 60 s while at least one subscriber is mounted, so relative labels
age instead of freezing. `DateText` subscribes unconditionally; the interval is
created on the first subscriber and cleared on the last.

### 3. `web/src/format.ts` — pure formatting

Everything here is pure and takes `settings` explicitly, so it is unit-testable
without React. `display` and `abbreviate` keep their current signatures and gain
an optional trailing `settings` argument that defaults to `readSettings()`, so
the 43 existing `toLocaleString('en-US')`-equivalent call sites keep working and
follow the number locale without a 13-file edit.

```ts
export interface FormattedDate {
  text: string          // what the cell prints
  absolute: string      // in the chosen format and zone, e.g. '2026-09-08 14:05'
  relative: string | null   // '3 h ago' when within 7 days and enabled, else null
  iso: string           // the API's string, verbatim, never re-serialised
  unavailable: boolean
}
export function formatDate(
  value: string | null | undefined,
  settings: Settings,
  options?: { prefer?: 'absolute' | 'relative'; offset?: boolean; now?: number },
): FormattedDate

export interface FormattedDuration {
  text: string          // '1 h 12 min'
  exact: string         // '4,320.500 s'
  unavailable: boolean
  reason?: string       // why, when unavailable
}
export function formatDuration(ms: number | null | undefined, settings: Settings): FormattedDuration
export function formatSpan(start: string | null | undefined, end: string | null | undefined, settings: Settings): FormattedDuration

export function formatNumber(value: number | null | undefined, settings: Settings): string
```

**`formatDate` rendering rules.**

- `null`, `undefined`, `''` or an unparsable string → `{ unavailable: true, text:
  'Unavailable' }`. Never throws, never invents "now", never prints
  `Invalid Date`. Parsing is `Date.parse` plus a `Number.isFinite` guard.
- `iso` is the input string **verbatim**. It is never rebuilt from the parsed
  `Date`, so microseconds and the exact spelling the server sent survive (the
  same rule that keeps `payload_text` verbatim in the source drawer).
- `absolute` is assembled from `Intl.DateTimeFormat(...).formatToParts` in the
  resolved zone, so the output is byte-identical across engines rather than
  whatever a locale's `dateStyle` happens to produce:

  | id | Label on the page | Output |
  |---|---|---|
  | `iso` (default) | ISO 8601 | `2026-09-08 14:05` |
  | `dmy` | Day month year | `08 Sep 2026 14:05` |
  | `mdy` | US | `09/08/2026 2:05 PM` |

  Seconds are not shown; they live in `iso`. The month name in `dmy` comes from
  the number locale (the only locale the app has), so `de-DE` yields `08 Sep.
  2026`; documented on the Settings page.
- `options.offset: true` appends ` (UTC+02:00)`, derived from the
  `timeZoneName: 'longOffset'` part with `GMT` replaced by `UTC`. Used on the
  session page's Interval panel, as the issue requires.
- `relative` is `null` when `settings.relativeTimes` is false or the instant is
  7 days or more away. Otherwise, with `d = now - t`:

  | condition | past | future |
  |---|---|---|
  | `|d| < 45 s` | `just now` | `just now` |
  | `< 90 min` | `N min ago` | `in N min` |
  | `< 36 h` | `N h ago` | `in N h` |
  | `< 7 d` | `N d ago` | `in N d` |

  Units are the English abbreviations the issue names (`3 h ago`), not
  `Intl.RelativeTimeFormat` (which yields `3 hr. ago` in `en-US` and would
  disagree with the duration units below). The number locale formats the digits
  only. A future instant is rendered as future, never clamped to "just now" —
  clock skew is data, not something to hide.
- `text` is `relative ?? absolute` when `prefer === 'relative'`, and `absolute`
  otherwise. Default `prefer` is `'absolute'`.

**Where each rendering is used.**

| Surface | `prefer` | Why |
|---|---|---|
| Sessions table Observed start / end | `absolute` | The column is a value being compared across rows. |
| Imports ledger Started | `relative` | The column is "when", and the ledger is read newest-first. |
| Import report Started / Finished, file bar Started | `absolute` | A receipt; the exact moment is the point. |
| Session Interval facts (observed and declared) | `absolute`, `offset: true` | §1.12: the reader must know the zone. |
| Model / tool call Started / Ended | `absolute` | Ordered rows compared against each other. |
| `already_imported[].imported_at` on `/import` | `relative` | "these bytes were imported 3 h ago". |

**`formatDuration` rules.** `null`, `NaN` or a negative input →
`Unavailable`. Otherwise:

| range | `text` |
|---|---|
| `< 1 s` | `340 ms` |
| `< 10 s` | `4.8 s` |
| `< 60 s` | `48 s` |
| `< 60 min` | `12 min 30 s` (the seconds part is dropped when 0) |
| `< 24 h` | `1 h 12 min` (the minutes part is dropped when 0) |
| `>= 24 h` | `15 d 3 h` |

`exact` is always the total in seconds with up to three decimals through the
number locale (`1,309,340.848 s`, the §1.6 maximum session span), and it is what
the `title` shows.

**`formatSpan(start, end)`** returns `Unavailable` with a `reason` when either
end is missing (`'no start timestamp'`) and — importantly — when `end` precedes
`start` (`'the end precedes the start'`). `research/insights/MERGED.md` §1.12
records 212 rows with timestamp inversions in the fixture, so a negative span is
a real case; it must never print as `-3 h` or as `0 s`. Equal instants are a
real `0 s`.

**`formatNumber`** is `value == null ? 'Unavailable' : value.toLocaleString(resolveLocale(settings))`.

### 4. `web/src/components/dates.tsx` — rendering

```tsx
export function DateText({ value, prefer, offset, copy = true }: { value: string | null | undefined; prefer?: 'absolute' | 'relative'; offset?: boolean; copy?: boolean }): ReactElement
export function SpanText({ start, end }: { start: string | null | undefined; end: string | null | undefined }): ReactElement
export function DurationText({ ms }: { ms: number | null | undefined }): ReactElement
```

`DateText` calls `useSettings()` and `useNow()`, then `formatDate`. Available
value, `copy` on:

```html
<button type="button" class="time has-tip" data-tip="2026-09-08T14:05:00.123456Z"
        title="2026-09-08T14:05:00.123456Z"
        aria-label="3 h ago, exactly 2026-09-08T14:05:00.123456Z. Activate to copy">
  <time datetime="2026-09-08T14:05:00.123456Z">3 h ago</time>
  <span class="visually-hidden" aria-live="polite"></span>
</button>
```

- The exact value is one hover away (`title` and the existing `.has-tip`
  tooltip, which the base stylesheet already positions correctly inside a table)
  and one click away (copy). Same control, same place, every time — ADR-006
  rule 3.
- Copy uses `navigator.clipboard.writeText`; on rejection or absence (jsdom,
  an insecure context) it does not fail silently: the tooltip becomes
  `Copy is unavailable — the exact time is in this tooltip` and the live span
  says so. On success the tooltip becomes `Copied` for 1.5 s and the live span
  announces `Copied`. The empty `aria-live` span costs nothing until used.
- Unavailable → `<span class="unavailable">Unavailable</span>`, no button, no
  title, no tooltip: there is nothing exact to reveal.
- `copy={false}` renders a plain `<time title=…>`; it exists for the file bar,
  where the bar scrolls horizontally and an extra tab stop is noise.

`SpanText` / `DurationText` render `<span class="has-tip" data-tip={exact}
title={exact}>1 h 12 min</span>`, or `Unavailable` with the reason as the
tooltip. They are not buttons: a duration is derived, so there is no exact
source string to copy.

**Tab-stop budget.** A 50-row sessions page gains two focusable timestamps per
row. That is deliberate (uniformity beats a special case) and each is a single
stop in a cell that had no control. If review judges it too heavy, the fallback
is `copy={false}` in dense tables and copy kept on the session and report pages
— a one-word change per call site, and the hover path is unaffected.

### 5. `web/src/components/scopeLinks.tsx` — cells and chips

```tsx
export function ScopeCell({ dimension, value, target }: { dimension: ScopeKey; value: string | null | undefined; target?: string }): ReactElement
export function ScopeChips({ keys, label }: { keys?: readonly ScopeKey[]; label?: string }): ReactElement | null
```

`ScopeCell` renders a **link, not a button**, so middle-click and
`ctrl`/`cmd`-click open a scoped view in a new tab, as the issue requires.

- `value == null` → `Unavailable`. You cannot filter by an unknown value; the
  cell stays text.
- Not the active value → `<Link to={scopeHref(dimension, value, target)}
  aria-label={`Filter by ${label} ${value}`} data-tip=… class="scope-cell">`.
  Accessible name: `Filter by source swe-chat`, exactly as the issue writes it.
- The active value → the same link with `aria-current="true"`, class
  `scope-cell active` (a `--accent-soft` background and a `--accent-line`
  underline, so the marked cell is visible without colour alone), href built
  with the key removed, and the name `Clear the source filter swe-chat`.
  Clicking the active value clears that key, as the issue requires.
- `target` overrides the destination pathname. On `/overview` and `/sessions`
  it is omitted and the current path is patched. On `/imports` and
  `/imports/:id` the scope has no effect on the ledger, so the Source cell
  passes `target="/sessions"` and the name becomes `Show sessions from source
  tracelab` — honest about what the click does, and still one URL scope.
- Ids, external ids, hashes, locators and paths stay copyable monospace text.
  Only the two (soon four) scope dimensions become links.

`ScopeChips` reads `useScope()`, renders nothing when no key in `keys` (default
`SCOPE_KEYS`) is set, and otherwise:

```html
<div class="chips row" role="group" aria-label="Active filters">
  <ScopeChip label="Agent" value="codex" onRemove={() => remove('agent')} />
  <button class="btn quiet small">Clear all</button>   <!-- only when 2+ are active -->
</div>
```

Values pass through `formatScopeValue` so #11's `period` reads as a period. Each
chip's remove button is a real `<button>` with the existing
`Remove Agent codex` name — keyboard reachable, focus ring from the global rule.

**Why chips as well as the scope bar.** The bar's typed inputs are how an
arbitrary value is *entered*; the chips above a table are the *readout* of what
this table is narrowed by, with one-click removal, and they are the same object
a chart drill produces in #11. They render only when scope is active, so the
default view is unchanged. Placed above the Sessions table (`Sessions.tsx`) and
the Overview sessions panel (`Overview.tsx`) — not above the Imports ledger,
which is unscoped.

### 6. `/settings` — a Console page

Route `<Route path="/settings" element={<SettingsPage />} />` in `App.tsx`. It
is not a data route, so the existing `Bar` switch already gives it the
`FileBar`; the page calls `useFileBar('Settings', [])` so the bar names itself
and keeps the frame height. Reached from `.rail .end` with an icon-only
`<Link className="btn small icon-only has-tip" to="/settings" aria-label="Settings" data-tip="Settings">`
carrying a new `settings` (gear) icon — icons over labels, with an accessible
name and a visible tooltip, per the owner's rule and ADR-006's amendment. The
link is unscoped (like `/imports`), so it does not carry `?source=` into a page
where scope has no meaning.

Structure — a designed page, not a modal:

- `h1 Settings`, sub `stored in this browser only, never on the server`.
- Panel **Dates and times**
  - `fieldset` / `legend` **Date format**: three radios, each labelled with its
    name and a live sample rendered by `formatDate` from the fixed instant
    `2026-09-08T14:05:00Z` in the chosen zone, so the reader sees the effect
    before choosing.
  - **Time zone**: a labelled `<select>` whose first two options are
    `Viewer's zone (Europe/Paris)` and `UTC`, then every
    `Intl.supportedValuesOf('timeZone')` entry. A stored zone the engine does
    not know shows a `Notice kind="warn"` saying the zone is unknown and the
    viewer's zone is being used.
  - **Relative times**: a labelled checkbox, with the sentence "Times under 7
    days old read as `3 h ago`; the exact time stays in the tooltip."
- Panel **Numbers**
  - **Number locale**: a labelled `<select>` over `NUMBER_LOCALES`
    (`en-US`, `en-GB`, `de-DE`, `fr-FR`, `es-ES`, `ja-JP`) with the live sample
    `formatNumber(1234567.89)`.
- Panel **Theme**: the same three-way `role="radiogroup"` control the rail
  carries, bound to `useTheme()`, with the sentence "The toggle in the top bar
  is a shortcut to this choice."
- Panel **Defaults**: `Reset to defaults`, and a `role="status"` line
  confirming what was reset (including the theme). A `visually-hidden`
  `aria-live="polite"` region announces every change, so a screen-reader user
  who cannot see the samples still hears that the choice took effect.

Every control writes immediately; there is no Save button and no dirty state,
matching `theme.ts` and making "every page reflects a change without reload"
true by construction.

### 7. Styles

Added to `web/src/styles/base.css`, using existing tokens only, no new tokens:

- `.time` — an unstyled button: `border:0; background:transparent; padding:0;
  color:inherit; font:inherit; cursor:pointer;` and `text-decoration: underline
  dotted var(--line-strong); text-underline-offset: 0.2em` so the affordance is
  visible without colour. `table.data td .time` keeps `tabular-nums`.
- `.scope-cell` — inherits the link colour; `.scope-cell.active` gets
  `background: var(--accent-soft); box-shadow: inset 0 -1px 0 var(--accent-line);
  border-radius: var(--r-1); padding: 0 4px`.
- `.chips` — `display:flex; gap: var(--sp-2); align-items:center;
  margin-bottom: var(--sp-3); flex-wrap: wrap`.
- `.settings-form` — `display:grid; gap: var(--sp-4)`; `.settings-form fieldset
  { border:0; margin:0; padding:0 }`; `.settings-form legend { font-size:
  var(--fs-1); color: var(--ink-3); padding:0 }`; `.settings-form .sample {
  color: var(--ink-3); font-family: var(--mono); font-size: var(--fs-1) }`.
- `.unavailable` — `color: var(--ink-4)` (matching `.kpi .value.unavailable`).

## Files touched

New:

| File | Contents |
|---|---|
| `web/src/settings.ts` | The store: types, `DEFAULTS`, `readSettings`, `setSettings`, `resetSettings`, `subscribe`, `resolveTimeZone`, `resolveLocale`, `timeZoneOptions`, `DATE_FORMATS`, `NUMBER_LOCALES`. |
| `web/src/settings.test.ts` | Store unit tests. |
| `web/src/settingsContext.tsx` | `SettingsProvider`, `useSettings`, `useNow`. |
| `web/src/format.test.ts` | `formatDate`, `formatDuration`, `formatSpan`, `formatNumber` unit tests. |
| `web/src/components/dates.tsx` | `DateText`, `SpanText`, `DurationText`. |
| `web/src/components/scopeLinks.tsx` | `ScopeCell`, `ScopeChips`. |
| `web/src/pages/Settings.tsx` | The `/settings` page. |
| `web/e2e/settings.spec.ts` | The issue's Playwright acceptance path, the Axe sweep and the PR screenshots. |
| `docs/superpowers/plans/2026-09-08-tables-dates-settings.md` | This plan. |

Edited:

| File | Change |
|---|---|
| `web/src/scope.ts` | Add `SCOPE_LABELS`, `formatScopeValue`, and `toggle` / `remove` / `scopeHref` inside `useScope()`. No change to `SCOPE_KEYS` (#11 owns it). |
| `web/src/format.ts` | Add the four formatters; give `display` and `abbreviate` an optional `settings` argument defaulting to `readSettings()`. |
| `web/src/components/index.ts` | Re-export `DateText`, `SpanText`, `DurationText`, `ScopeCell`, `ScopeChips`. |
| `web/src/components/icons.tsx` | Add the `settings` gear path. |
| `web/src/components/components.test.tsx` | New `describe` blocks for `DateText`, `DurationText`, `ScopeCell`, `ScopeChips`. |
| `web/src/main.tsx` | Wrap `<App/>` in `<SettingsProvider>`. |
| `web/src/App.tsx` | Add the `/settings` route; call `useSettings()` in `App` so the routed tree re-renders on a change. |
| `web/src/AppShell.tsx` | Add the icon-only Settings link in `.rail .end`. |
| `web/src/App.test.tsx` | New integration tests (cell click → chip → removal; format change re-renders the ledger; persistence across a remount). |
| `web/src/pages/sessionsTable.tsx` | Source and Agent → `ScopeCell`; Observed start / end → `DateText`; counts → `formatNumber` through `display`. |
| `web/src/pages/Sessions.tsx` | `<ScopeChips />` above the table. |
| `web/src/pages/Overview.tsx` | `<ScopeChips />` above the sessions panel. |
| `web/src/pages/Session.tsx` | Identity Source / Agent → `ScopeCell target="/sessions"`; Interval facts → `DateText offset`; add Observed span and Declared span rows via `SpanText`; call tables' Started / Ended → `DateText`; `Wall latency (ms)` → `Wall latency` with `DurationText`. |
| `web/src/pages/Imports.tsx` | Ledger Source → `ScopeCell target="/sessions"`; ledger Started → `DateText prefer="relative"`; file-bar Started → `DateText copy={false}`; report Started / Finished → `DateText`; replace the private `seconds()` with `formatSpan`. |
| `web/src/pages/Import.tsx` | One line: `already_imported[].imported_at` → `<DateText prefer="relative" />`. The only edit to the guided import route; the route's structure is untouched. |
| `web/src/pages/Gallery.tsx` | Add a row showing `DateText` (available, unavailable, relative, copied), `DurationText`, `ScopeCell` (plain / active / unavailable) and `ScopeChips`, so a reviewer sees every state without data. |
| `web/src/styles/base.css` | `.time`, `.scope-cell`, `.chips`, `.settings-form`, `.unavailable`. |
| `web/playwright.config.ts` | A `settings` project, `dependencies: ['chromium']`, so the fixture is already imported. |
| `web/package.json`, `pnpm-lock.yaml` | `@axe-core/playwright` as a devDependency. |
| `docs/adr/ADR-006-ui-design-direction.md` | A short amendment recording the `/settings` route, the rail entry point, and that display settings are per-browser and never server-side. |
| `docs/architecture/import-pipeline.md` | Line 18: add `settings` to the page list. |

Not touched, deliberately: `web/src/components/bars.tsx`, `primitives.tsx`,
`charts.tsx`, `scopeDimensions.ts`, `shellContext.tsx`, `shellHooks.ts`, the
assistant (`web/src/assist/**`, `pages/Assist.tsx`), the guided import runtime
(`web/src/import/**`), everything under `backend/`, and every API contract.

## Tests

### `web/src/format.test.ts`

- `formatDate` returns Unavailable for null, undefined, the empty string,
  `'not a date'` and `'2026-13-45'`, and never throws.
- `formatDate` keeps the API's string verbatim in `iso`, microseconds included.
- `formatDate` renders each of the three formats from one instant in a fixed
  zone: `2026-09-08 14:05`, `08 Sep 2026 14:05`, `09/08/2026 2:05 PM`.
- `formatDate` renders the same instant differently in `UTC`, in
  `Australia/Sydney` and in the viewer's zone.
- `formatDate` with `offset: true` appends `(UTC+00:00)` / `(UTC+10:00)`.
- `formatDate` relative thresholds at 30 s, 2 min, 89 min, 3 h, 35 h, 6 d and
  8 d, with an injected `now`; a future instant reads `in 3 h`.
- `formatDate` returns `relative: null` and an absolute `text` when
  `relativeTimes` is false.
- `formatDuration`: 340 ms, 4.8 s, 48 s, `12 min 30 s`, `1 h 12 min`,
  `15 d 3 h`; the zero-remainder cases drop the smaller unit; `exact` carries
  the locale-grouped seconds; null and negative are Unavailable.
- `formatSpan`: a normal interval; equal instants give `0 s`; a reversed
  interval is Unavailable with the reason `the end precedes the start`; a
  missing end is Unavailable with its own reason.
- `formatNumber` groups by locale (`1,234,567.89` for `en-US`,
  `1.234.567,89` for `de-DE`) and returns Unavailable for null.
- `abbreviate` keeps its existing behaviour with default settings and follows a
  non-default locale when one is passed.

### `web/src/settings.test.ts`

- Defaults when storage is empty.
- A patch persists to `agentscope-settings`, notifies subscribers, and survives
  a fresh read.
- Corrupt JSON, a non-object, an unknown `dateFormat`, a non-string
  `numberLocale` and an unknown IANA zone each fall back to their default
  without throwing.
- A `localStorage` that throws on `getItem` and `setItem` (private mode) still
  applies the in-memory choice, exactly as `theme.ts` does.
- `readSettings()` returns the identical object reference across calls until a
  write — the `useSyncExternalStore` loop guard.
- A `storage` event from another tab updates the snapshot and notifies.
- `resetSettings()` restores every default and sets the theme to `system`.
- `resolveTimeZone` and `resolveLocale` validate and fall back.

### `web/src/components/components.test.tsx` (additions)

- `DateText` prints the absolute rendering, exposes the verbatim ISO in `title`
  and in the accessible name, and wraps it in a `<time datetime>`.
- `DateText prefer="relative"` prints `3 h ago` with fake timers, and ages to
  `4 h ago` after the 60 s tick.
- Activating `DateText` copies the exact ISO (a stubbed
  `navigator.clipboard.writeText`) and announces `Copied`.
- A rejecting clipboard announces that copy is unavailable and never throws.
- `DateText` with a null value renders `Unavailable`, no button, no title.
- `DurationText` prints `1 h 12 min` with the exact seconds in the title, and
  `Unavailable` with the reason for a reversed span.
- `ScopeCell` inactive: an anchor named `Filter by agent codex` whose href adds
  `agent=codex` and drops `offset`.
- `ScopeCell` active: `aria-current="true"`, named `Clear the agent filter
  codex`, href without the key.
- `ScopeCell` with a null value: plain `Unavailable`, no link.
- `ScopeCell target="/sessions"` from an unscoped route points at `/sessions`.
- `ScopeChips` renders nothing when the scope is empty; renders one named chip
  per active key; removing one chip clears exactly that key and leaves the
  other; `Clear all` appears only with two or more and clears both.

### `web/src/App.test.tsx` (additions)

- From `/sessions`, clicking the Agent cell navigates to `?agent=codex`, the
  chip appears, the sessions request carries `agent=codex`, and removing the
  chip returns to the unscoped list — the issue's acceptance path at unit level.
- Clicking the already-active agent value clears the key.
- On `/imports`, changing `dateFormat` through `setSettings` re-renders the
  visible ledger in the new format with no navigation and no remount.
- `/settings` renders every control with a label; choosing a format writes
  storage; `Reset to defaults` restores the defaults and the `system` theme.
- A settings value written before mount is applied on first render
  (persistence).
- The rail's Settings link exists with the accessible name `Settings`.

### `web/e2e/settings.spec.ts`

Runs after the `chromium` project, so the fixture is imported.

1. `/sessions` → click `codex` in the Agent column → URL is
   `/sessions?agent=codex`, the row count drops to the fixture's 40, the chip
   `Agent codex` is visible → remove the chip → the URL loses the key and the
   list is restored. Screenshots before and after.
2. `/settings` → choose `08 Sep 2026 14:05` → open `/imports` in the **same**
   page without reloading (client-side navigation) → the Started column matches
   `/\d{2} \w{3} \d{4} \d{2}:\d{2}/` → `page.reload()` → still matches.
   A second tab confirms the value is per browser, not per tab, only if the
   context is shared; otherwise the reload assertion carries persistence.
3. Change the time zone to `UTC` and assert a session page timestamp shows
   `(UTC+00:00)`.
4. Hover a timestamp and assert the `title` equals the API's ISO string fetched
   through `page.request.get('/api/sessions')`.
5. Axe (`@axe-core/playwright`, tags `wcag2a`, `wcag2aa`) on `/overview`,
   `/sessions`, `/sessions/:id`, `/imports` and `/settings`, asserting no
   violations; the settings form's labels and the chip and cell names are
   asserted by role queries in the same spec.
6. Screenshots to `test-results/tables-dates-settings/` (`1-sessions-scoped.png`,
   `2-chip-removed.png`, `3-settings.png`, `4-imports-reformatted.png`,
   `5-session-dates.png`) for the PR. Nothing is committed.

### Full verification command set

```
pnpm --dir web lint && pnpm --dir web typecheck && pnpm --dir web test && pnpm --dir web build && pnpm --dir web e2e
uv --directory backend run pytest -q     # unchanged; proves no backend drift
```

## Acceptance checks mapped to the issue's tasks

| Issue task | Verifiable acceptance check |
|---|---|
| Plan reviewed: settings module and hook, `formatDate`, scope links in `DataTable` cells, chips shared with #11 | This document gives the store API, the hook and its propagation proof, the four formatter signatures with their rendering tables, the `ScopeCell` / `ScopeChips` signatures, and §0's explicit ownership contract with #11 covering `SCOPE_KEYS`, `SCOPE_LABELS`, `formatScopeValue`, the chip component and the `toggle`/`remove`/`scopeHref` additions. |
| `settings.ts` + `useSettings()` + `/settings` page in the Console shell | `settings.test.ts` covers defaults, persistence, corruption, private mode, snapshot identity and cross-tab; `App.test.tsx` proves the page renders labelled controls in the shell, that a change re-renders a visible page without reload, and that a stored value applies on mount; Playwright reaches `/settings` from the rail icon and Axe finds no violation on it. |
| `formatDate` / `formatDuration` with tests; replace every raw timestamp rendering | `format.test.ts` covers thresholds, all three formats, zones, the offset, the Unavailable path and non-throwing invalid input; `grep -rn "_at\b" web/src --include=*.tsx` after the change returns no bare timestamp render outside `dates.tsx` — the eight sites listed in *Current state* are converted. |
| Source / agent cells as scope links; chips above tables | Component tests assert the accessible names `Filter by source swe-chat` and `Clear the agent filter codex`, that cells are anchors (so a new tab works), that the active value is marked with `aria-current`, and that a null value stays text; Playwright performs the issue's click → narrow → chip → remove → restore round trip against the real fixture. |
| Playwright and Axe coverage; screenshots in the PR | `web/e2e/settings.spec.ts` runs the two acceptance scenarios, the tooltip-equals-API-ISO check, an Axe sweep of five routes with no violations, and writes five screenshots into ignored `test-results/`, handed to the coordinator rather than committed. |
| Choices persist per browser, never on the server | The diff contains no `backend/` change and no new API call; `settings.ts` touches only `localStorage`; the reload step in Playwright and the mount step in `App.test.tsx` prove persistence. |
| "Unavailable" stays the designed value; never a fabricated "now" | Unit tests assert Unavailable for null, invalid input, a missing span end and a reversed interval, and that no code path substitutes the current time for a missing one. |

## Risks

- **`scope.ts` is edited by two issues at once.** Mitigated by §0: #11 owns
  `SCOPE_KEYS` and the two label/format entries, #46 owns the three new
  `useScope()` functions, and neither writes the other's lines. If #11 lands
  first, this issue rebases onto it and gains model chips for free; if #46 lands
  first, #11's two-line extension is mechanical.
- **A chip row above a table can read as redundant with the scope bar.** The
  chips render only when scope is active and are the readout, not a second
  control; the bar keeps the typed inputs. If the owner disagrees on review, the
  chips move into the bar's slot — `ScopeChips` is already self-contained and
  reads the URL, so it is one line moved.
- **Two focusable timestamps per row lengthen keyboard traversal.** Deliberate
  and uniform; the documented fallback is `copy={false}` in dense tables, with
  the hover path unchanged.
- **`useSyncExternalStore` loops if the snapshot identity is unstable.** The
  store caches the parsed object and a unit test pins reference identity.
- **Ambient number formatting depends on `App` re-rendering.** `display` and
  `abbreviate` read the store rather than taking settings at 43 call sites, so
  they are only correct because `App` consumes the context and recreates the
  tree. `DateText`, `ScopeCell` and the Settings page consume the context
  directly and are correct regardless; a unit test pins the ambient path so a
  future `memo` cannot break it silently.
- **`Intl.supportedValuesOf` is not universal.** Guarded with a fallback list;
  an unknown stored zone shows a warning notice and uses the viewer's zone
  rather than crashing `Intl.DateTimeFormat`.
- **Engine-dependent date output.** Avoided by assembling every absolute
  rendering from `formatToParts` instead of a locale's `dateStyle`, so the unit
  tests assert exact strings that hold on Node and in Chromium alike.
- **`@axe-core/playwright` is a new dependency and there is no violation
  baseline.** The first run may surface pre-existing violations on
  `/overview`, `/sessions`, `/sessions/:id` or `/imports`. If any is not caused
  by this issue's code, it is recorded in this plan's revision section with the
  rule id and either fixed (if one line) or excluded by rule with a written
  reason — never by silently loosening the assertion.
- **Relative labels go stale on a page left open.** One 60 s module interval
  refreshes them; it is created only while a `DateText` is mounted, and the
  global reduced-motion rule is irrelevant to it (no animation).
- **Editing `web/src/pages/Import.tsx` at all.** Limited to one expression on
  line 264. If the coordinator prefers the guided import route untouched, that
  single line is dropped and the plan's date coverage is otherwise unchanged.
- **`/settings` is not in the Console IA table.** Addressed by an ADR-006
  amendment in the same form as #45's, so the design of record and the shipped
  routes do not diverge.

## Cost estimate

About one day after plan review: 2 h for `settings.ts`, the context, the hook
and their tests; 2.5 h for the four formatters, `dates.tsx` and their tests;
2 h for `ScopeCell`, `ScopeChips`, the `scope.ts` additions and converting the
five pages; 1.5 h for the Settings page and its styles; 2 h for the Playwright
spec, the Axe wiring, the screenshots and the full CI sweep; 0.5 h for the
ADR-006 amendment and review fixes. No backend, API-contract or dependency work
beyond `@axe-core/playwright`.
