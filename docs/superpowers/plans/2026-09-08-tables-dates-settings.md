# Plan: Interactive tables, readable dates, settings page (issue #46)

Revised 2026-09-08 after the Codex review
(`2026-09-08-tables-dates-settings-review-codex.md`, BLOCK, 3 P1 / 12 P2 /
1 P3). The design sections below are the revised design; **§ Revision 2 after
Codex review** answers every finding by number and is the record of what
changed and why.

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
format in one page of a browser context and watching an already-open Imports
ledger in another page of the same context re-render without a reload;
reloading and finding the choice still applied; and hovering or focusing any
timestamp to get the byte-exact ISO string the API returned.

## Current state

Verified in this worktree at `8aab14f`; line references re-checked at `76c8930`.

### Scope

- `web/src/scope.ts` is the whole scope mechanism: `SCOPE_KEYS = ['source',
  'agent']` (`:11`), `readScope` (`:15`), `scopeKey` (`:24`), `scopeSearch`
  (`:31`), and `useScope()` (`:38`) returning `{ scope, key, offset, set,
  clear, setOffset, link }`. `set(patch)` (`:42`) trims, deletes empty values
  and drops `offset`; `clear()` (`:52`) deletes every scope key. There is no
  per-key remove, no toggle, and no helper that builds a `To` for a single
  scope change. The docstring already reserves `model` and `period` for #11.
- `web/src/scopeDimensions.ts` derives Source/Agent suggestions from the loaded
  session rows (temporary until a facets endpoint).
- `web/src/components/bars.tsx` holds `ScopeBar` (`:31`, typed inputs bound to
  the URL, Clear, receipt), `ScopeChip` (`:45`: `label`, `value`, `onRemove`;
  an `x` button with `aria-label` and a native `title` but **no** `.has-tip` /
  `data-tip` visible tooltip) and `FileBar` (`:60`). `ScopeChip` is used only
  by `web/src/pages/Gallery.tsx`.
- No table cell uses the scope. `web/src/pages/sessionsTable.tsx:15-16` renders
  `session.source` as bare text and `display(session.agent)`;
  `web/src/pages/Imports.tsx:34` renders `r.source` as bare text;
  `web/src/pages/Session.tsx:65` renders `session.source` and
  `display(session.agent)` in the Identity `dl.facts`.
- `web/src/pages/Session.tsx:36` renders `display(call.model)` — the only Model
  cell in the app today. `sessionsTable.tsx` has **no** Model column.
- `web/src/pages/sessionsTable.tsx:13` makes the session id a real anchor to
  `/sessions/:id` carrying the scope. That anchor is navigation, not a scope
  link, and it stays.

### Timestamps

- The API returns UTC ISO-8601 strings ending in `Z`, with microseconds only
  when non-zero (verified: application DTOs are dataclasses serialised through
  Pydantic; `TypeAdapter(datetime).dump_json` on a UTC instant yields
  `"2026-06-04T12:34:56.123456Z"` and `"2026-06-04T12:34:56Z"`).
  `backend/src/agentscope_app/infrastructure/db/models.py:41-55` (`UtcDateTime`)
  guarantees every stored instant is UTC-aware and rejects naive input, so the
  wire grammar is narrow and known.
- Every display timestamp is the raw string today:
  `web/src/pages/sessionsTable.tsx:16-17` (Observed start / end),
  `web/src/pages/Session.tsx:37-38` (model call Started / Ended), `:48-49`
  (tool call Started / Ended), `:65-66` (Interval panel, four facts),
  `web/src/pages/Imports.tsx:39` (ledger Started), `:195` (file bar Started),
  `:216` (report Started / Finished), and `web/src/pages/Import.tsx:264`
  (`already_imported[].imported_at`).
- Durations: `web/src/pages/Imports.tsx:60` `seconds(report)` is a private
  `<1 s` / whole-second helper used in the Lead's notice **title** at `:67`;
  `web/src/pages/Session.tsx:50` prints `wall_latency_ms` as a bare number
  under the header `Wall latency (ms)`. No session span exists, although
  `research/insights/MERGED.md` §1.6 makes "observed span in imported data" a
  named quantity with a fixed label and caveat, and §1.12 requires per-cell
  `Unavailable` with a reason.
- `web/src/format.ts` has `PAGE_SIZE`, `display`, `entityCounts`,
  `abbreviate`. No date helper.

### Numbers

`web/src/format.ts:5,14,17,19` hard-code `toLocaleString('en-US')`, and so do
**37 further presentation sites** outside it. The complete inventory, verified
by `grep -rn "toLocaleString\|Intl.NumberFormat" web/src` excluding tests:

| File | Lines |
|---|---|
| `format.ts` | 5, 14, 17, 19 |
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

Two further raw (ungrouped) presentation numbers exist at
`assist/ActionBar.tsx:69` (`preview.rejects.length`, `preview.records.sampled`).

### Per-browser settings

- `web/src/theme.ts` is the only one: key `agentscope-theme`, a module
  `listeners` set, a `chosen` in-memory fallback so a choice still applies when
  `localStorage` throws (`:24-31`), `applyTheme` stamping `data-theme`, and
  `useTheme()` on `useSyncExternalStore`. `web/index.html:9-14` stamps the
  theme **before first paint**; `web/src/main.tsx:12` re-applies it after
  module load. `theme.ts` has **no** `storage` listener, so a second tab's
  theme change does not reach this tab.
  `web/src/components/components.test.tsx:123-139` pins the exact behaviour
  that must survive: storage still returns a stale `light` while `setItem`
  throws, and the in-memory `dark` wins.
- `web/src/AppShell.tsx:25-26` renders the theme control in `.rail .end` as a
  `role="group"` of three `aria-pressed` buttons with `aria-label` and
  `data-tip` — **not** a radiogroup. `web/src/styles/base.css:174-176` gives
  `.theme-toggle { overflow: hidden }`, which clips the below-control
  pseudo-tooltip and can clip the outward 2 px focus ring.
- `web/src/App.tsx:31-37` is the `Bar` switch (`/overview` and `/sessions*` get
  the `ScopeBar`, everything else the `FileBar`); `:41-56` is the route table.
  There is no `/settings` route. `web/src/main.tsx` renders `<App/>` inside the
  router with no settings provider.
- `web/src/shellContext.tsx:25-38`: `ShellProvider` passes `children` through,
  so a provider state change does **not** re-render the routed tree; only
  context consumers re-render. This fact decides the propagation design below.

### Design of record and rules

- ADR-006: one global scope, a drill appends a chip to that scope and there is
  no second drill mechanism (rule 1); `Unavailable` is a rendered state, and an
  abbreviated number prints its exact value beside it (rule 2); trust surfaces
  one step away, in the same place every time (rule 3). Its 2026-09-08
  amendment records that icon-only secondary actions keep an accessible name
  and a visible tooltip.
- `research/design/claude/3-console/README.md` fixes the visual system, the
  36 px row / 13 px table density, `tabular-nums`, the 2 px focus ring, and the
  accessibility contract. Its IA table has no `/settings`, so the route needs
  an ADR-006 amendment in the form #45 used.
- `docs/architecture/import-pipeline.md:3-6` explicitly describes the
  implementation **frozen at commit `2a351e9`**, so it must not gain a page
  that did not exist at that commit.
- `web/src/styles/base.css` already provides `.chip`, `.has-tip` (including
  `table .has-tip::after { left:auto; right:0 }`), `.field`, `.row`, `.panel`,
  `dl.facts`, `.visually-hidden`, `.theme-toggle` and the reduced-motion rule.

### Tests and CI

- `web/src/App.test.tsx` mounts the real `<App/>` over a `fetch` mock; its
  `/api/sessions` handler (`:24-26`) returns **one** session regardless of the
  query, so proving that a scope click *narrows* needs a scope-sensitive mock.
  `start()` (`:30-31`) mounts without any settings provider.
- `web/src/components/components.test.tsx` covers the primitives including
  `ScopeBar`/`ScopeChip` and the theme fallback.
- `web/e2e/smoke.spec.ts` (project `chromium`) imports the fixture and is a
  dependency of the `assistant` project, which imports a **second** source
  (`epoch-assist`, 30 records) into the same database. Unscoped
  `/sessions` shows at most `PAGE_SIZE = 50` rows (`format.ts:3`,
  `Sessions.tsx:14`), not all 80.
- `web/e2e/assist.spec.ts:75` asserts `/2025-09-04T15:33:2\d/` — a rendered
  timestamp, inside the verbatim emission JSON at `assist/ActionBar.tsx:73`
  (`JSON.stringify(first.fields)`). It is source-data inspection, not a display
  timestamp; it is exempt from reformatting and the assertion stays.
- No Axe dependency exists (`web/package.json:26-39`). The lockfile is
  **`web/pnpm-lock.yaml`**; there is no root lockfile. No CSP is enforced
  anywhere (`web/index.html`, `vite.config.ts`, `playwright.config.ts`,
  `backend/.../interfaces/api/main.py`), so Axe injection has no policy
  obstacle and no application security setting needs weakening.
- Commands: `pnpm --dir web test | lint | typecheck | build | e2e`.

### Parallel work

Issue #11 (dashboard KPIs, charts, drill-down, model and period filters) is
being planned in `/Users/sean/dev/AgentScope-wt/11`.
`docs/superpowers/plans/2026-09-08-dashboard.md` **does not exist there** — the
directory holds only merged plans up to `2026-09-08-guided-import-route.md`
(re-checked while writing this revision). The interface in §0 is therefore
written as the authoritative contract this issue owns and implements; #11
consumes it.

## Design

### 0. The contract with #11 — authoritative, owned by #46

The issue's coordination clause offers two routes: run after #11, or agree the
contract first. #11's plan does not exist, so agreement cannot be reached by
reading it. This section is therefore **the interface #46 owns and ships**.
#11 consumes it as written or raises a conflict in its own review; it is not a
proposal awaiting a counter-proposal.

**The single rule: there is one filter mechanism, the URL scope.** Nothing
renders a chip by hand and nothing holds drill state beside the scope; a
drill-down is `set({ model: 'gpt-5.5' })` and the chip appears because the URL
changed. This is ADR-006 rule 1 taken literally.

| Item | File | Owner | Contract |
|---|---|---|---|
| `SCOPE_KEYS` | `scope.ts` | **#11 extends** | `['source', 'agent']` today; #11 appends `'model'` and `'period'` in the commit that makes the endpoints accept them. #46 adds no key. |
| `SCOPE_LABELS: Record<ScopeKey, string>` | `scope.ts` | **#46 creates, #11 extends** | Exhaustive by type, so appending a key without a label is a `pnpm --dir web typecheck` failure, not a blank chip. #46 ships `{ source: 'Source', agent: 'Agent' }`. |
| `SCOPE_VALUE_FORMATTERS: Partial<Record<ScopeKey, (raw: string) => string>>` and `formatScopeValue(key, raw): string` | `scope.ts` | **#46 creates, #11 fills** | Identity for `source`, `agent`, `model`. #11 registers the `period` renderer (`'7d'` → `last 7 days`). Chips, cell names and `aria-label`s all read through it, so a period chip is readable the day #11 lands. |
| `patchScope(search, patch): URLSearchParams` | `scope.ts` | **#46** | The one pure URL operation (§5). `set`, `toggle`, `remove` and `scopeHref` all call it, so encoding, trimming, `offset` reset and preservation of other keys are identical everywhere. |
| `useScope().toggle(key, value)`, `.remove(key)`, `.scopeHref(key, value, target?)` | `scope.ts` | **#46** | #11 adds none of its own; a chart drill calls the existing `set()`. |
| `<ScopeChips keys? label? />` | `components/scopeLinks.tsx` (new) | **#46** | Self-contained: reads `useScope()`, renders one `ScopeChip` per active key in `SCOPE_KEYS` order, handles removal focus. #11 places `<ScopeChips />` above its charts if it wants the readout there; it never renders `ScopeChip` directly. |
| `ScopeChip` | `components/bars.tsx` | **#46 edits, props unchanged** | Its remove button gains `.has-tip` + `data-tip` (§7). The `{ label, value, onRemove }` signature is unchanged, so #11 is unaffected; the file is nonetheless in #46's Files-touched list. |
| `<ScopeCell dimension value target? />` | `components/scopeLinks.tsx` (new) | **#46** | The only way a cell becomes a filter, for **all four** dimensions. |
| **Every Model cell** | `pages/Session.tsx:36`, any future column | **#46 owns the cell, #11 owns the key** | #46 converts `Session.tsx:36` to `<ScopeCell dimension="model" target="/sessions" />` in this issue. `ScopeCell` renders a **plain text value** for any dimension not currently in `SCOPE_KEYS`, so the cell is honest today (the API would ignore `model=`) and becomes a link with **zero further edits** the moment #11 appends the key. This is the mechanism that makes both merge orders work. |
| Period grammar, default, chart drill-down, facets endpoint, KPI/chart surfaces | — | **#11** | #46 touches none of them. `period` absent from the URL means "unrestricted"; there is no implicit default period, so a period chip appears only when a person chose one, and `remove('period')` returns to unrestricted. |
| Table cells, chips, dates, durations, number formatting, settings | — | **#46** | #11 touches none of them. |

**Both merge orders.**

- *#46 first:* #11 appends two entries to `SCOPE_KEYS`, two to `SCOPE_LABELS`
  (or the build fails), one entry to `SCOPE_VALUE_FORMATTERS`, and gets model
  cells, chips and removal for free. Its charts call `set()`.
- *#11 first:* #46 rebases; `SCOPE_KEYS` already has four keys, `ScopeCell`'s
  degradation path becomes dead for `model`, and the Session model cell is a
  link on first render. No #46 code changes.

**Shared files and their conflict surface**: `scope.ts` (#46 adds five
exports/functions, #11 appends to two literals), `components/bars.tsx` (#46
changes one button's attributes; #11 does not touch it), `pages/Overview.tsx`
(#46 adds one `<ScopeChips />` line at the top of the sessions panel; #11
rewrites the KPI/chart region above it), `pages/sessionsTable.tsx` (#46
rewrites the cell renderers; #11 may add a Model column, which must use
`ScopeCell`), `components/primitives.tsx` (#46 replaces nine `toLocaleString`
calls inside `KpiTile`/`QualityStrip`; #11 may restructure `KpiTile` — the two
must be sequenced, and #46 goes first because it is mechanical),
`components/charts.tsx` (#46 replaces four `toLocaleString` calls; #11 owns
everything else there), `playwright.config.ts` and `web/e2e/` (#46 adds one
project and one spec; see §11 for the ordering rule). The semantic dependency
is real and is reflected in the schedule in § Cost estimate, not waved away as
"two lines".

### 1. `web/src/settings.ts` — the store

Same shape as `theme.ts` (a module store read through `useSyncExternalStore`),
one storage key, no server call, ever.

```ts
export type DateFormatId = 'iso' | 'dmy' | 'mdy'
export interface Settings {
  dateFormat: DateFormatId
  timeZone: string            // 'viewer' or a canonical IANA name
  relativeTimes: boolean
  numberLocale: string        // a canonical BCP-47 tag
}
export interface Diagnostics {          // evidence the validator had to discard
  timeZone?: { stored: string; reason: 'unknown-zone' }
  numberLocale?: { stored: string; reason: 'unsupported-locale' }
  storage?: 'unavailable'
}

export const DEFAULTS: Settings = { dateFormat: 'iso', timeZone: 'viewer', relativeTimes: true, numberLocale: 'en-US' }
export const STORAGE_KEY = 'agentscope-settings'
export const DATE_FORMATS: readonly { id: DateFormatId; label: string }[]
export const NUMBER_LOCALES: readonly { id: string; label: string }[]

export function readSettings(): Settings              // getSnapshot; stable identity
export function readDiagnostics(): Diagnostics
export function setSettings(patch: Partial<Settings>): void
export function resetSettings(): void
export function subscribe(listener: () => void): () => void
export function resolveTimeZone(settings: Settings): string   // canonical IANA name
export function resolveLocale(settings: Settings): string     // canonical BCP-47 tag
export function timeZoneOptions(current: string): string[]
export function localeOptions(current: string): { id: string; label: string }[]
```

**Validation and canonicalisation.** Every field is validated independently;
an unknown value is replaced by its default *and recorded in `Diagnostics`*, so
the Settings page can say "the stored zone `Mars/Olympus` is unknown; the
viewer's zone is in use" instead of silently swallowing it. Zones are
canonicalised through `Intl.DateTimeFormat('en-US', { timeZone: v })
.resolvedOptions().timeZone`, which accepts the alias `US/Eastern` and returns
`America/New_York` (verified in Node); locales through
`Intl.getCanonicalLocales` guarded by `Intl.NumberFormat.supportedLocalesOf`.
The canonical form is what is written back, so the select can always show the
effective value. `timeZoneOptions(current)` = `['viewer', 'UTC', ...
Intl.supportedValuesOf('timeZone')]` (or `['viewer', 'UTC']` where that API is
missing) **with `current` appended when absent** — necessary because
`supportedValuesOf('timeZone')` does not contain `US/Eastern` even though the
engine accepts it (verified). `localeOptions(current)` does the same for a
supported locale outside the six presets, such as `fr-CA` (verified supported).

**Snapshot identity.** `readSettings()` caches the validated object and returns
the same reference until a write or an external event invalidates the cache.
Without this, `useSyncExternalStore` re-renders forever; a unit test pins
reference identity.

**Precedence — one rule, stated once.** *A choice that reached storage is
shared, so another tab's change wins. A choice this tab could not persist is
this tab's until reload, and no external event overwrites it.*

```
memory: Settings | undefined      // the last choice made on this page
persisted: boolean                // whether that choice reached storage
cache: Settings | undefined

setSettings(patch):
  next = validate({ ...readSettings(), ...patch })
  memory = next; cache = next
  try { localStorage.setItem(KEY, JSON.stringify(next)); persisted = true }
  catch { persisted = false }                    // private mode / quota
  notify()

readSettings():
  if (cache) return cache
  if (memory && !persisted) return (cache = memory)   // our write never landed
  try { raw = localStorage.getItem(KEY) } catch { return (cache = memory ?? DEFAULTS) }
  return (cache = validate(parse(raw)))               // storage is the truth

on window 'storage' (event.key === KEY || event.key === null /* clear() */):
  if (memory && !persisted) return               // never clobber an unpersistable choice
  memory = undefined; cache = undefined; notify()   // next read takes the external value
```

- A malformed external value is not written back; `validate` degrades it per
  field on read and records a diagnostic.
- `event.key === null` (another tab called `storage.clear()`) is treated as an
  external reset.
- Key removal (`event.newValue === null`) reads as "no stored settings" and
  therefore `DEFAULTS`.
- This preserves the tested `theme.ts` case exactly: storage keeps returning a
  stale value while `setItem` throws, `persisted` is false, and the in-memory
  choice wins (`components.test.tsx:123-139`).

**Theme** keeps its own module and key so the pre-paint bootstrap in
`web/index.html:9-14` is untouched. `theme.ts` gains the *same* storage
listener and the same `persisted` flag, so a cross-tab theme change re-stamps
`data-theme` and updates both toggles; nothing else in it changes.
`resetSettings()` writes `DEFAULTS` **and** calls `setTheme('system')`, and the
page's confirmation says so.

### 2. `web/src/settingsContext.tsx` — the hook

```tsx
export function SettingsProvider({ children }: { children: ReactNode }): ReactElement
export function useSettings(): Settings
export function useNow(): number
```

`SettingsProvider` subscribes once with `useSyncExternalStore(subscribe,
readSettings, () => DEFAULTS)` and publishes the value on a context.
`useSettings()` calls `useContext` **and** the store hook unconditionally and
prefers the context — no conditional hook, and components rendered without a
provider (unit tests, the dev gallery) still work. The provider wraps `<App/>`
in `web/src/main.tsx`.

**Propagation.** `App` itself calls `useSettings()`, so a change re-renders
`App`, which recreates the whole element tree below it (`ShellProvider`,
`AppShell`, `Routes`, the active page). Ambient number readers (§3) therefore
update even though they hold no subscription. `DateText`, `SpanText`,
`DurationText`, `ScopeCell` and the Settings page also subscribe directly, so
they stay correct behind any future `memo`. The propagation proof is a test on
an **ambient** consumer, not on a directly subscribed one (§10).

`useNow()` is one module-level 60 s interval, created on the first subscriber
and cleared on the last, so relative labels age instead of freezing. It is
StrictMode-safe (subscribe/unsubscribe are symmetric) and a test asserts no
timer survives unmount.

### 3. `web/src/format.ts` — one formatting path for the whole application

Every displayed number and date in `web/src` goes through this module. **After
this issue there is no `toLocaleString` call anywhere in `web/src` outside
`format.ts`**, and `pnpm --dir web lint` gets an `oxlint` `no-restricted-syntax`
rule forbidding `toLocaleString` and `new Intl.NumberFormat` outside
`format.ts` so the invariant cannot rot.

```ts
// numbers
export function num(value: number | null | undefined, settings?: Settings): string      // 'Unavailable' | grouped
export function decimal(value: number, maxFractionDigits: number, settings?: Settings): string
export function abbreviate(value: number, settings?: Settings): string
export function display(value: string | number | boolean | null | undefined, settings?: Settings): string

// dates
export interface FormattedDate {
  text: string; absolute: string; relative: string | null; iso: string; unavailable: boolean
}
export function formatDate(
  value: string | null | undefined,
  settings: Settings,
  options?: { prefer?: 'absolute' | 'relative'; offset?: boolean; now?: number },
): FormattedDate

// durations
export interface FormattedDuration {
  text: string; exact: string; unavailable: boolean; reason?: string
}
export function formatDuration(ms: number | null | undefined, settings: Settings): FormattedDuration
export function formatSpan(start: string | null | undefined, end: string | null | undefined, settings: Settings): FormattedDuration
```

The `settings` argument is optional on the number helpers and defaults to
`readSettings()` (the ambient path, correct because `App` re-renders the tree);
it is **required** on the date helpers, which are the ones the issue names and
the ones whose behaviour is intricate enough to deserve explicit tests.
`Intl.NumberFormat` instances are memoised per `(locale, options)` in a `Map`.

**The exact-value rule survives the locale change.** `abbreviate` and the
"exact" line in `KpiTile` must compare like with like: the exact string is
`num(value, settings)` and abbreviation still starts above 99,999, so a
`de-DE` viewer sees `553,4M` beside `exact 553.447.877` and never an English
exact value beside a German abbreviation.

**Migration inventory.** Every site in the *Current state → Numbers* table is
converted to `num` / `decimal` / `display`. Exempt, and stated so explicitly
rather than left to a grep: `payload_text` and `JsonText` (verbatim bytes),
`JSON.stringify(first.fields)` in `assist/ActionBar.tsx:73` (verbatim emission
inspection — this is why `web/e2e/assist.spec.ts:75`'s timestamp assertion
stays), mapping documents in `assist/DocumentEditor.tsx`, ids, external ids,
SHA-256 hashes, locators and paths. The two ungrouped counts at
`assist/ActionBar.tsx:69` are converted at the same time.

**`formatDate` rules.**

- *Accepted grammar.* Only the API's own shape is accepted:
  `YYYY-MM-DDTHH:MM:SS(.f{1,9})?(Z|±HH:MM)`, matched by a regex, with the
  calendar components validated by round-trip (`Date.UTC(y, m-1, d)` must give
  back the same y/m/d). Everything else — including `'2026-02-30T12:00:00Z'`
  (which `Date.parse` silently normalises to 2 March, verified), `'0'` (which
  `Date.parse` accepts, verified), an offset-free `'2026-09-08T14:05:00'`
  (which `Date.parse` reads in the *machine's* zone, verified), leading or
  trailing whitespace, and any non-string — is `Unavailable`. An instant is
  never inferred from an ambiguous string, and a fabricated "now" is never
  substituted. Leap days are validated, not assumed: `2028-02-29` is accepted,
  `2026-02-29` is not.
- *Exact value.* `iso` is the input string **verbatim**, never rebuilt from a
  `Date`, so microseconds and the exact spelling survive — the same rule that
  keeps `payload_text` verbatim in the source drawer.
- *Absolute.* Assembled from `Intl.DateTimeFormat(...).formatToParts` with
  `{ calendar: 'gregory', numberingSystem: 'latn', hourCycle: 'h23' | 'h12',
  timeZone }`, so the output does not depend on a locale's `dateStyle`. Month
  **names** come from a fixed English three-letter table, not from the locale,
  because engines disagree (`Sep` vs `Sept`); the number locale governs digits
  only, consistent with the relative units below. This is documented on the
  Settings page.

  | id | Label | Output |
  |---|---|---|
  | `iso` (default) | ISO 8601 | `2026-09-08 14:05` |
  | `dmy` | Day month year | `08 Sep 2026 14:05` |
  | `mdy` | US | `09/08/2026 2:05 PM` |

  Seconds are not shown; they live in `iso`.
- *Offset.* `options.offset: true` appends ` (UTC+02:00)`. The offset is read
  from the `timeZoneName: 'longOffset'` part **at the input instant**, and
  normalised: a bare `GMT` (which is what the engine returns at zero offset —
  verified, it is *not* `GMT+00:00`) becomes `+00:00`, `GMT+2` is padded to
  `+02:00`, and `GMT+05:45` (Kathmandu, verified) passes through. Because the
  offset is computed per instant, the two Paris fall-back instants
  `2026-10-25T00:30:00Z` and `2026-10-25T01:30:00Z` — which both render
  `02:30` (verified) — are distinguished as `(UTC+02:00)` and `(UTC+01:00)`.
  **Every timestamp on the session page carries the offset**, the Interval
  facts and both call tables alike, as the issue requires.
- *Relative.* `null` when `relativeTimes` is off or the elapsed duration is
  7 days or more (elapsed duration, not calendar days). Otherwise, with
  `d = now - t`, count = `Math.round(|d| / unit)`, **promoted to the next band
  whenever the rounded count reaches that band's threshold** (so 89.9 min
  rounds to 90 and is promoted to `2 h ago`, and 44.6 s is promoted to
  `1 min ago` rather than printing `0 min ago`):

  | band | past | future |
  |---|---|---|
  | `|d| < 45 s` | `just now` | `just now` |
  | `< 90 min` | `N min ago` | `in N min` |
  | `< 36 h` | `N h ago` | `in N h` |
  | `< 7 d` | `N d ago` | `in N d` |

  A future instant is rendered as future — clock skew is data — and within
  45 seconds it reads `just now` in both directions. Units are the English
  abbreviations the issue names (`3 h ago`), not `Intl.RelativeTimeFormat`
  (which yields `3 hr. ago` in `en-US` and would disagree with the duration
  units below). A non-finite injected `now` is treated as "no reference time":
  `relative` is `null` and the absolute rendering is used.
- *Never throws.* Every `Intl` construction is inside `try/catch`, falling back
  to UTC and `en-US`, so a malformed persisted setting degrades the rendering
  rather than blanking the page.
- `text` is `relative ?? absolute` when `prefer === 'relative'`, else
  `absolute`. Default `prefer` is `'absolute'`.

**Where each rendering is used** (this table, not a grep, is the maintained
inventory of display timestamps):

| Surface | `prefer` | `offset` | Why |
|---|---|---|---|
| `sessionsTable.tsx` Observed start / end | absolute | no | Values compared across rows. |
| `Imports.tsx:39` ledger Started | relative | no | The column is "when"; the ledger reads newest-first. |
| `Imports.tsx:195` file-bar Started | absolute | no | A receipt. |
| `Imports.tsx:216` report Started / Finished | absolute | no | A receipt. |
| `Session.tsx:65-66` Interval facts | absolute | **yes** | §1.12: the reader must know the zone. |
| `Session.tsx:37-38,48-49` call tables | absolute | **yes** | DST-ambiguous instants must stay distinguishable. |
| `Import.tsx:264` `already_imported[].imported_at` | relative | no | "these bytes were imported 3 h ago". Mandatory, not optional. |

**Instants and durations, at the API's precision.** `Date.parse` is
millisecond-resolution, so subtracting `…00.123456Z` from `…00.123455Z` gives
exactly `0` (verified) and would hide a reversed interval as a real zero.
`parseInstant(iso)` therefore returns **microseconds since the epoch as a
`bigint`**, assembled from the validated components (`BigInt(Date.UTC(...)) *
1000n + fractionMicros − offsetMicros`), and `formatSpan` subtracts bigints.
`formatDuration(ms)` keeps its millisecond input because that is the unit the
API gives for `wall_latency_ms`.

- *Rejections.* `null`, `undefined`, `NaN`, `±Infinity` and negative inputs are
  `Unavailable`. `formatSpan` distinguishes `no start timestamp`,
  `no end timestamp`, `unreadable start timestamp`, `unreadable end timestamp`
  and `the end precedes the start`.
- *Label bands and carry.* The band is chosen from the exact value; within it,
  the larger unit floors and the smaller rounds; if the rounded smaller unit
  reaches the band size it carries into the larger unit and the band is
  re-checked.

  | range | `text` |
  |---|---|
  | `< 1 s` | `340 ms` |
  | `< 10 s` | `4.8 s` |
  | `< 60 s` | `48 s` |
  | `< 60 min` | `12 min 30 s` (seconds dropped when 0) |
  | `< 24 h` | `1 h 12 min` (minutes dropped when 0) |
  | `>= 24 h` | `15 d 3 h` |

- *Exact.* Always the total in seconds through the number locale, at the
  precision the source carried: six fraction digits for a span parsed from two
  ISO strings, three for a millisecond input, trailing zeros trimmed —
  `1,309,340.848 s` (the §1.6 maximum session span). This is what the title
  and the copy action carry.
- `formatSpan` returns `Unavailable` with `the end precedes the start` for a
  reversed interval, and a real `0 s` for equal instants. Sub-millisecond
  reversals are detected because the arithmetic is in microseconds.
  `research/insights/MERGED.md:443-445` records 212 rows with inversions inside
  the source `timing_events` and says bounds are taken with min/max — that is
  evidence that inverted source data exists and must be handled defensively,
  **not** a claim that 212 normalised session intervals are reversed.

### 4. `web/src/components/dates.tsx` — rendering

```tsx
export function DateText({ value, prefer, offset }: { value: string | null | undefined; prefer?: 'absolute' | 'relative'; offset?: boolean }): ReactElement
export function SpanText({ start, end }: { start: string | null | undefined; end: string | null | undefined }): ReactElement
export function DurationText({ ms }: { ms: number | null | undefined }): ReactElement
```

All three render the **same** control, so the exact value and any reason are
always reachable by hover *and* by keyboard, everywhere, with no dense-table
exception:

```html
<button type="button" class="time has-tip" data-tip="2026-09-08T14:05:00.123456Z"
        title="2026-09-08T14:05:00.123456Z"
        aria-label="3 h ago, exactly 2026-09-08T14:05:00.123456Z. Activate to copy">
  <time datetime="2026-09-08T14:05:00.123456Z">3 h ago</time>
  <span class="visually-hidden" aria-live="polite"></span>
</button>
```

- `SpanText` / `DurationText` use the same button with the exact seconds as the
  tooltip, name and copied text; when unavailable, the reason is the tooltip
  and part of the accessible name (`Unavailable: the end precedes the start`),
  so a keyboard user gets what a hovering user gets. The `.has-tip` rule
  already reveals the tooltip on `:focus-visible`.
- Copy uses `navigator.clipboard.writeText`; on rejection or absence (jsdom, an
  insecure context) it does not fail silently — the tooltip becomes
  `Copy is unavailable — the exact value is in this tooltip` and the live span
  says so. On success the tooltip reads `Copied` for 1.5 s and the live span
  announces it.
- An unavailable **date** renders `<span class="unavailable">Unavailable</span>`
  with no button: there is no exact value to reveal or copy.
- `DurationText` never claims to know about reversal; only `SpanText` has two
  endpoints, so the reversal assertions live on `SpanText`.

### 5. `web/src/components/scopeLinks.tsx` and the scope helpers

**One pure URL operation.** All mutation goes through

```ts
export function patchScope(search: URLSearchParams, patch: ScopeValues): URLSearchParams
```

which copies `search`, applies each entry with the same normalisation `set()`
already uses (`value.trim()`; an empty result deletes the key), deletes
`offset`, and leaves every other parameter — scope keys not in the patch, and
non-scope parameters — untouched. `set`, `toggle`, `remove` and `scopeHref` are
all thin wrappers, so encoding (`URLSearchParams`, hence `trace+%26+lab`),
equality and `offset` behaviour cannot diverge between the bar, a cell and a
chip. Clearing `agent` in a URL that carries `model` and `period` keeps both.
The app uses `BrowserRouter` with no hash routing, so there is no fragment to
preserve. Links push history, so Back restores the previous scope.

```ts
toggle(key, value)                   // set when different, remove when equal (after trim)
remove(key)                          // patchScope(search, { [key]: '' })
scopeHref(key, value, target?): To   // { pathname: target ?? current, search: … }
```

When `target` differs from the current pathname, only scope keys are carried:
non-scope parameters belong to the page being left. Stated explicitly because
it is the one place `scopeHref` is not a pure patch.

**`ScopeCell`.** A link, not a button, so middle-click and modifier-click open
a scoped view in a new tab.

- `value == null` → `Unavailable`. An unknown value cannot be filtered on.
- `dimension` not in `SCOPE_KEYS` (today: `model`, `period`) → plain text. The
  API would ignore the parameter, and a link that narrows nothing is a lie.
- Not the active value → `<Link to={scopeHref(dimension, value, target)}
  aria-label={`Filter by ${SCOPE_LABELS[dimension].toLowerCase()} ${formatScopeValue(dimension, value)}`}>`
  — `Filter by source swe-chat`, exactly as the issue writes it.
- The active value → the same link with `aria-current="true"`, class
  `scope-cell active` (`--accent-soft` fill plus an inset `--accent-line`
  underline, so the marking is not colour alone), an href with the key removed,
  and the name `Clear the source filter swe-chat`. **The active-value naming
  wins over the target-route naming**: a source cell in the Imports ledger that
  matches the active scope announces clearing, not "show sessions from".
- `target` overrides the destination. `/overview` and `/sessions` omit it;
  `/imports` and `/imports/:id` pass `target="/sessions"`, because
  `listImports` takes no scope and the Console design exempts the ledger — the
  inactive name there is `Show sessions from source tracelab`. The report's
  provenance "Source" icon buttons are provenance actions, not source cells,
  and are untouched.
- Ids, external ids, hashes, locators and paths stay copyable text. The
  existing session-id anchor at `sessionsTable.tsx:13` is navigation and stays.

**`ScopeChips`.** Renders nothing when no key in `keys` (default `SCOPE_KEYS`)
is set; otherwise a `role="group" aria-label="Active filters"` row of
`ScopeChip`s in `SCOPE_KEYS` order, values through `formatScopeValue`, plus a
`Clear all` button when two or more are active. **Focus after removal** is
specified: the next remaining chip's remove button; if none remains, the
`Clear all` button; if neither, the table's `<caption>` given `tabIndex={-1}`,
so focus never falls to `<body>`.

Placed above the Sessions table (`Sessions.tsx`) and the Overview sessions
panel (`Overview.tsx`), not above the unscoped Imports ledger. The bar's typed
inputs remain how an arbitrary value is *entered*; the chips are the readout of
what this table is narrowed by, and the same object a #11 chart drill produces.

### 6. `/settings` — a Console page

Route `<Route path="/settings" element={<SettingsPage />} />`. It is not a data
route, so the existing `Bar` switch gives it the `FileBar`; the page calls
`useFileBar('Settings', [])`. Reached from `.rail .end` with an icon-only
`<Link className="btn small icon-only has-tip" to="/settings" aria-label="Settings" data-tip="Settings">`
carrying a new `settings` gear icon — icons over labels, accessible name plus
visible tooltip. The link is unscoped, like `/imports`.

- `h1 Settings`, sub `stored in this browser only, never on the server`.
- Panel **Dates and times**: a `fieldset`/`legend` of three date-format radios,
  each labelled with its name and a live sample rendered by `formatDate` from
  the fixed instant `2026-09-08T14:05:00Z` **with the resolved zone named
  beside it**, so the sample is not silently zone-dependent; a labelled time
  zone `<select>` (`Viewer's zone (Europe/Paris)`, `UTC`, then every option,
  always including the effective current value); a labelled relative-times
  checkbox. A `Notice kind="warn"` appears when `readDiagnostics().timeZone`
  says a stored zone was unknown.
- Panel **Numbers**: a labelled locale `<select>` over `localeOptions(current)`
  with the live sample `num(1234567.89)` and a note that month abbreviations
  are fixed English.
- Panel **Theme**: a `ThemeToggle` component **extracted from
  `AppShell.tsx:25-26` and shared with the rail**, so there is one
  implementation. It deliberately keeps the existing named
  `role="group"` + `aria-pressed` button semantics rather than becoming a
  half-implemented radiogroup; the page adds the sentence "The toggle in the
  top bar is a shortcut to this choice."
- Panel **Defaults**: `Reset to defaults` with a `role="status"` line naming
  everything reset, including the theme.

Every control writes immediately; no Save button, no dirty state. A
`visually-hidden aria-live="polite"` region announces each change.

### 7. Styles

Added to `web/src/styles/base.css`, existing tokens only:

- `.time` — an unstyled button (`border:0; background:transparent; padding:0;
  color:inherit; font:inherit; cursor:pointer`) with
  `text-decoration: underline dotted var(--line-strong); text-underline-offset:
  0.2em` so the affordance does not rely on colour; `table.data td .time`
  keeps `tabular-nums`.
- `.scope-cell` inherits the link colour; `.scope-cell.active` gets
  `background: var(--accent-soft); box-shadow: inset 0 -1px 0 var(--accent-line);
  border-radius: var(--r-1); padding: 0 4px`.
- `.chips { display:flex; gap:var(--sp-2); align-items:center; flex-wrap:wrap;
  margin-bottom:var(--sp-3) }`.
- `.settings-form { display:grid; gap:var(--sp-4) }`, `fieldset { border:0;
  margin:0; padding:0 }`, `legend { font-size:var(--fs-1); color:var(--ink-3);
  padding:0 }`, `.sample { color:var(--ink-3); font-family:var(--mono);
  font-size:var(--fs-1) }`.
- `.unavailable { color: var(--ink-4) }`.
- **Fix** `.theme-toggle`: drop `overflow: hidden` (which clips the
  below-control tooltip and the outward focus ring) and round the first and
  last child instead.
- `.chip button` gains the `.has-tip` treatment (a `data-tip` attribute in
  `bars.tsx`; no new CSS needed beyond the existing rule).

## Files touched

New:

| File | Contents |
|---|---|
| `web/src/settings.ts` | The store, validation, canonicalisation, diagnostics, precedence. |
| `web/src/settings.test.ts` | Store unit tests. |
| `web/src/settingsContext.tsx` | `SettingsProvider`, `useSettings`, `useNow`. |
| `web/src/format.test.ts` | `formatDate`, `formatDuration`, `formatSpan`, `num`/`decimal`/`abbreviate` tests. |
| `web/src/components/dates.tsx` | `DateText`, `SpanText`, `DurationText`. |
| `web/src/components/scopeLinks.tsx` | `ScopeCell`, `ScopeChips`. |
| `web/src/components/ThemeToggle.tsx` | Extracted from `AppShell`, used by the rail and the Settings page. |
| `web/src/pages/Settings.tsx` | The `/settings` page. |
| `web/e2e/settings.spec.ts` | Acceptance path, Axe sweep, keyboard checks, screenshots. |
| `web/e2e/axe.ts` | Shared Axe helper and the baseline comparison. |
| `docs/superpowers/plans/2026-09-08-tables-dates-settings.md` | This plan. |

Edited:

| File | Change |
|---|---|
| `web/src/scope.ts` | `SCOPE_LABELS`, `SCOPE_VALUE_FORMATTERS`, `formatScopeValue`, `patchScope`; `set` re-expressed on `patchScope`; `toggle`, `remove`, `scopeHref` added to `useScope()`. |
| `web/src/format.ts` | `num`, `decimal`, locale-aware `display`/`abbreviate`, `parseInstant`, `formatDate`, `formatDuration`, `formatSpan`. |
| `web/src/theme.ts` | A `storage` listener and the `persisted` flag, matching §1's precedence. The pre-paint bootstrap is untouched. |
| `web/src/components/bars.tsx` | `ScopeChip`'s remove button gains `data-tip`; `ScopeReceipt:50` → `num`. |
| `web/src/components/primitives.tsx` | `KpiTile` (`:150,158,159,160,166`) and `QualityStrip` (`:183`) → `num`. |
| `web/src/components/charts.tsx` | `:17,23,45,68` → `num`. |
| `web/src/components/index.ts` | Re-export the new components. |
| `web/src/components/icons.tsx` | The `settings` gear path. |
| `web/src/components/components.test.tsx` | New `describe` blocks (§ Tests). |
| `web/src/main.tsx` | Wrap `<App/>` in `<SettingsProvider>`. |
| `web/src/App.tsx` | The `/settings` route; `useSettings()` in `App`. |
| `web/src/AppShell.tsx` | The Settings link; the theme control becomes `<ThemeToggle/>`. |
| `web/src/App.test.tsx` | Scope-sensitive `/api/sessions` mock, a provider-wrapped `start()`, new integration tests. |
| `web/src/pages/sessionsTable.tsx` | Source/Agent → `ScopeCell`; dates → `DateText`; numbers → `num`. |
| `web/src/pages/Sessions.tsx` | `<ScopeChips />`; `:22` → `num`. |
| `web/src/pages/Overview.tsx` | `<ScopeChips />` above the sessions panel. |
| `web/src/pages/Session.tsx` | Source/Agent/**Model** (`:36`) → `ScopeCell target="/sessions"`; `:37-38,48-49,65-66` → `DateText offset`; Observed and Declared span rows via `SpanText`; `:50` → `DurationText` under the header `Wall latency`. |
| `web/src/pages/Imports.tsx` | Source → `ScopeCell target="/sessions"`; `:39` → `DateText prefer="relative"`; `:195,216` → `DateText`; `:12` → `num`; `seconds()` (`:60,67`) replaced by a `SpanText` line in the Lead's body. |
| `web/src/pages/Import.tsx` | `:264` → `<DateText prefer="relative" />` (**mandatory**); the 17 `toLocaleString` sites → `num`. No structural change to the Passage route. |
| `web/src/pages/Assist.tsx`, `assist/ActionBar.tsx`, `assist/PayloadDrawer.tsx`, `assist/EvidenceRail.tsx`, `assist/DocumentEditor.tsx`, `import/components.tsx` | `toLocaleString` → `num`; the two ungrouped counts at `ActionBar.tsx:69` → `num`. Verbatim JSON untouched. |
| `web/src/pages/Gallery.tsx` | Every new component in every state. |
| `web/src/styles/base.css` | `.time`, `.scope-cell`, `.chips`, `.settings-form`, `.unavailable`, the `.theme-toggle` clipping fix. |
| `web/.oxlintrc.json` (or `package.json` lint config) | `no-restricted-syntax` forbidding `toLocaleString` / `new Intl.NumberFormat` outside `format.ts`. |
| `web/playwright.config.ts` | A `settings` project (`dependencies: ['chromium']`, `timezoneId: 'Europe/Paris'`, `locale: 'en-US'`); `assistant` gains `'settings'` as a dependency so ordering is chromium → settings → assistant. |
| `web/package.json`, `web/pnpm-lock.yaml` | `@axe-core/playwright` as a devDependency. |
| `docs/adr/ADR-006-ui-design-direction.md` | An amendment recording `/settings`, the rail entry, and per-browser-only persistence. |

Not touched: `docs/architecture/import-pipeline.md` (it describes a frozen
commit and must stay accurate), `scopeDimensions.ts`, `shellContext.tsx`,
`shellHooks.ts`, `web/src/import/importRuntime.ts`, everything under
`backend/`, every API contract.

## Tests

### `web/src/format.test.ts`

- *Grammar:* accepts the API's `Z` and `±HH:MM` forms with 0–9 fraction digits;
  rejects `2026-02-30T12:00:00Z`, `2026-02-29T…`, `'0'`, `'2026-09-08T14:05:00'`
  (offset-free), `' 2026-09-08T14:05:00Z'`, `'not a date'`, a number, `null`,
  `undefined`, `''` — every one `Unavailable` with all fields set and no throw.
  Accepts `2028-02-29T…` (a real leap day).
- *Verbatim:* `iso` equals the input byte for byte, microseconds included.
- *Formats:* all three ids × `UTC`, `Europe/Paris`, `Asia/Kathmandu`, at
  midnight, noon and `14:05`.
- *Offset:* `(UTC+00:00)` in UTC (the bare-`GMT` normalisation),
  `(UTC+05:45)` in Kathmandu, `(UTC+02:00)`/`(UTC+01:00)` for the two Paris
  fall-back instants, and spring-forward.
- *Relative:* just below / exactly at / just above 45 s, 90 min, 36 h and 7 d,
  in both directions; the 45 s boundary yields `1 min ago`, never `0 min ago`;
  89.9 min promotes to `2 h ago`; `relativeTimes: false` gives
  `relative === null`; a non-finite `now` gives the absolute rendering.
- *Durations:* 340 ms, 4.8 s, 48 s, `12 min 30 s`, `1 h 12 min`, `15 d 3 h`;
  carry at 1 s, 10 s, 60 s, 60 min, 24 h; `undefined`, `NaN`, `Infinity`,
  `-Infinity` and negatives are `Unavailable`; `exact` carries locale grouping.
- *Spans:* a normal interval; equal instants → `0 s`; a **sub-millisecond**
  positive span keeps its exact seconds; a **sub-millisecond reversed** span is
  `Unavailable` with `the end precedes the start` (the case `Date.parse` would
  hide); missing start, missing end and unreadable endpoints each get their own
  reason.
- *Numbers:* `num` groups per locale (`1,234,567.89` / `1.234.567,89`),
  `Unavailable` for null; `abbreviate` still starts above 99,999 and its exact
  companion uses the same locale; malformed settings fall back without throwing.

### `web/src/settings.test.ts`

- Defaults on empty storage; a patch persists, notifies and survives a reread.
- Corrupt JSON, a non-object, an unknown `dateFormat`, a non-string locale and
  an unknown zone each fall back per field, record a diagnostic, and do not
  throw.
- *Precedence, both directions:* tab A and tab B both write; a persisted write
  in B reaches A; a write A **could not persist** is not clobbered by B's
  event; `event.key === null`, `newValue === null`, and a malformed external
  value each behave as specified.
- The `theme.ts` case is preserved verbatim: stale storage + throwing `setItem`
  → the in-memory choice wins (the existing test at
  `components.test.tsx:123-139` keeps passing) — plus the new cross-tab theme
  propagation and its own pre-paint bootstrap left intact.
- Persistence is proven by **re-importing the module with a reset registry**
  (`vi.resetModules()`), not by a cached reread.
- `readSettings()` reference identity across calls until a write.
- Zones: `US/Eastern` canonicalises to `America/New_York` and appears in the
  options; an unsupported stored zone falls back *and* surfaces a diagnostic;
  `supportedValuesOf` missing takes the fallback list.
- Locales: `fr-CA` is accepted and appears in the options although it is not a
  preset.
- `resetSettings()` restores every default, sets the theme to `system`, and
  leaves every displayed control consistent.

### `web/src/components/components.test.tsx` (additions)

- `DateText` absolute: verbatim ISO in `title` and in the accessible name,
  wrapped in `<time datetime>`.
- `DateText prefer="relative"` with fake timers: `3 h ago`, and after one
  `useNow` tick across a boundary the label changes; unmount leaves no timer;
  StrictMode double-mount does not double-subscribe.
- Copy success announces `Copied`; a rejecting clipboard announces
  unavailability and never throws.
- An unavailable date renders `Unavailable` with no button.
- `SpanText` reversed → `Unavailable`, reason in the tooltip **and** in the
  accessible name, reachable by focus. `DurationText` formats and copies ms.
- `ScopeCell`: inactive name and href; active `aria-current` and clearing name;
  active-beats-target naming on a `target="/sessions"` cell; a `null` value is
  text; a dimension outside `SCOPE_KEYS` is text.
- `patchScope` / `scopeHref`: `trace & lab`, a model containing `+ & = # /` and
  Unicode, four-key removal and clear-all, `offset` reset on both add and
  clear, other scope keys and non-scope params preserved on the same route,
  non-scope params dropped on a target route.
- `ScopeChips`: nothing when empty; one named chip per active key; removing one
  clears exactly that key; `Clear all` at two or more; **focus moves to the
  next chip, then `Clear all`, then the caption** after a removal.
- `ScopeChip`'s remove button carries `data-tip` (the visible-tooltip
  contract).

### `web/src/App.test.tsx` (additions)

- A scope-sensitive `/api/sessions` mock (80 unscoped rows capped at
  `PAGE_SIZE`, 40 for `agent=codex`) so narrowing is proven by rendered rows,
  not only by the outgoing query.
- From `/sessions`, clicking the Agent cell navigates to `?agent=codex`, the
  request carries the key, the rendered row count drops, the chip appears, and
  removing the chip restores both the URL and the row count.
- Clicking the already-active value clears the key.
- **The ambient propagation test:** with the production composition
  (`SettingsProvider > App > ShellProvider`) mounted at `/overview`, change the
  number locale and assert that a **KPI exact value and its coverage
  fraction** — components with no settings subscription of their own — change
  grouping, that the scope receipt changes with them, that no remount occurred
  (a DOM node identity check) and that page-local state survives. This fails if
  the `App` subscription is omitted, which the `DateText` test would not catch.
- The providerless fallback is covered separately (a bare `<DateText/>`).
- On `/imports`, `setSettings({ dateFormat: 'dmy' })` re-renders the visible
  ledger with no navigation and no remount.
- `/settings`: every control has a label; choosing a format writes storage;
  reset restores defaults and the `system` theme; the diagnostics notice
  appears for a bad stored zone.
- The rail Settings link exists with the accessible name `Settings`.
- `afterEach` clears both storage keys and resets the module registry so a
  non-default preference cannot contaminate existing assertions.

### `web/e2e/settings.spec.ts`

Project `settings`, `dependencies: ['chromium']`, `timezoneId:
'Europe/Paris'`, `locale: 'en-US'`; `assistant` depends on `settings`, so the
two extra `epoch-assist` sessions are imported after these assertions run.

1. **Scope round trip.** `/sessions` → click `codex` in the Agent column → URL
   `/sessions?agent=codex`, **40 data rows** (41 `tr` including the header),
   chip `Agent codex` visible → remove the chip → URL clean, 50 rows
   (`PAGE_SIZE`) and the receipt restored. Screenshots either side.
2. **Cross-page live update.** Page A shows `/imports`. Page B (same browser
   context) opens `/settings`, turns relative times **off** and selects
   `08 Sep 2026 14:05`. Without touching page A, its Started column matches
   `/^\d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}$/` — proving an already-mounted
   ledger updates with no reload, no navigation and no remount. Page A then
   reloads and still matches, proving persistence.
3. **Same-tab path.** In one page, change the format on `/settings`, navigate
   client-side to `/imports`, assert the format; reload and assert again.
4. **Relative path, separately.** Turn relative times on and assert the ledger
   row for the import this run created matches `/just now|\d+ min ago|\d+ h ago/`.
5. **Offset.** Set the zone to `UTC`; on a session page, the Interval facts
   **and** a model-call Started cell both end `(UTC+00:00)`.
6. **Exactness.** Fetch `/api/sessions?agent=codex`, take a **named** session's
   `observed_start_at`, locate that session's row by its external id, and
   assert the cell's `title` equals that string exactly.
7. **Keyboard.** Tab to a timestamp, assert a visible focus ring and tooltip;
   Enter copies (clipboard permission granted for the context); Tab to a chip's
   remove button, Enter removes it and focus lands where §5 says; middle-click
   and modifier-click a scope cell and assert a new page opens on the scoped
   URL while the original page's URL is unchanged; repeat the focus-ring and
   tooltip checks in the dark theme; check the last table row and the
   horizontal scroll edge.
8. **Axe.** `web/e2e/axe.ts` runs `AxeBuilder` (`wcag2a`, `wcag2aa`) on
   `/overview`, `/sessions`, `/sessions?agent=codex` (an active chip),
   `/sessions/:id`, `/imports`, `/imports/:id` (the edited report and the
   already-imported notice) and `/settings`, in **both themes**, after data has
   loaded. It asserts that the set of `(ruleId, target)` pairs is a subset of
   the checked-in baseline; **no rule is ever globally disabled**, so a new
   target under an existing rule still fails. The baseline is produced by
   running the same helper against the pre-change revision, on the same engine
   and route states, and is committed as `web/e2e/axe-baseline.json` with a
   comment for each entry. The helper asserts that injection and analysis
   actually completed (a non-empty `passes` array), so a silent no-op cannot
   look like success.
9. **Screenshots** to `test-results/tables-dates-settings/`
   (`1-sessions-scoped.png`, `2-chip-removed.png`, `3-settings.png`,
   `4-imports-reformatted.png`, `5-session-dates.png`) for the PR. Nothing is
   committed.

### Full verification command set

```
pnpm --dir web lint && pnpm --dir web typecheck && pnpm --dir web test && pnpm --dir web build && pnpm --dir web e2e
uv --directory backend run pytest -q     # unchanged; proves no backend drift
```

## Acceptance checks mapped to the issue's tasks

| Issue task | Verifiable acceptance check |
|---|---|
| Plan reviewed | This document, revised against every finding, gives the store API and its precedence rule, the propagation proof, the formatter signatures with grammar/offset/band tables, `ScopeCell`/`ScopeChips`, and §0 as the authoritative #11 interface covering all four keys, both merge orders and every Model cell. |
| `settings.ts` + `useSettings()` + `/settings` in the shell | `settings.test.ts` covers defaults, persistence across a module reset, per-field validation with diagnostics, the private-mode/cross-tab precedence in both directions, canonicalisation and snapshot identity; `App.test.tsx` proves the labelled page in the shell and reset; Playwright reaches it from the rail icon and Axe scans it in both themes. |
| `formatDate` / `formatDuration` with tests; replace every raw timestamp rendering | `format.test.ts` covers the grammar (including the three inputs `Date.parse` would silently accept), all three formats across three zones, DST and `+05:45` offsets, the relative boundaries in both directions, the duration bands with carry, and microsecond-exact spans. The *Where each rendering is used* table is the maintained inventory; each of its eight rows is converted, `Import.tsx:264` included, and the verbatim-JSON exemption is written down rather than assumed. |
| Source / agent cells as scope links; chips above tables | Component tests assert `Filter by source swe-chat`, `Clear the agent filter codex`, anchors (not buttons), the active marking, the text fallbacks, URL-encoding edge cases and post-removal focus; Playwright does the click → narrow to 40 rows → chip → remove → restore round trip plus keyboard and new-tab activation. |
| Playwright and Axe coverage; screenshots | `settings.spec.ts` runs the scope round trip, the cross-page live update, the same-tab path, the relative path, the offset and exactness checks, the keyboard sweep, and a baseline-compared Axe scan of seven route states in two themes, writing five screenshots to ignored output. |
| Choices persist per browser, never on the server | No `backend/` change and no new API call; `settings.ts` touches only `localStorage`; persistence proven by a module-reset reread, by a Playwright reload, and by the cross-page test. |
| Number grouping and decimals follow the preference on every page | The `toLocaleString` inventory is migrated in full, the exact-value rule is preserved, a lint rule forbids reintroduction, and the ambient propagation test asserts a KPI's exact value, its coverage fraction and the scope receipt all change together. |
| "Unavailable" is a designed value; never a fabricated "now" | Unit tests assert `Unavailable` for null, ambiguous and impossible inputs, missing endpoints, unreadable endpoints and reversed spans, and that no path substitutes the current time. |

## Risks

- **`scope.ts`, `primitives.tsx`, `charts.tsx` and `Overview.tsx` are edited by
  two issues at once.** §0 assigns every line, and the schedule sequences #46's
  mechanical number migration in `primitives.tsx`/`charts.tsx` **before** #11
  restructures them. If #11 is late, nothing in #46 blocks: `ScopeCell`
  degrades to text for `model`.
- **#11 may not adopt the contract.** It is written as the interface #46 ships,
  so a disagreement surfaces in #11's review as a conflict against shipped
  code, not as an unresolved negotiation.
- **The number migration is wide (42 sites, 13 files).** It is mechanical, and
  a lint rule plus the ambient propagation test keep it from regressing; but it
  is the single largest source of merge friction and is scheduled first.
- **The ambient number path depends on `App` re-rendering.** Pinned by a test
  on a KPI and the scope receipt — consumers with no subscription — under the
  production provider composition, so a future `memo` breaks the test rather
  than the product.
- **`Intl` behaviour varies by engine.** Mitigated by assembling from
  `formatToParts` with explicit calendar, numbering system and hour cycle,
  by a fixed English month table, and by normalising the bare `GMT` the engine
  returns at zero offset.
- **`bigint` instant arithmetic is unusual in this codebase.** It is confined to
  `parseInstant`/`formatSpan`, has no effect on rendered types, and is the only
  way to detect the sub-millisecond reversals `Date.parse` hides.
- **The Axe baseline may be large.** Every entry is recorded with its rule and
  target and a note; none is waived by disabling a rule. If the baseline shows
  a violation this issue can fix in one line, it is fixed instead of recorded.
- **Cross-tab tests are timing-sensitive.** They use Playwright's expect-poll
  against the rendered text, not a fixed wait.
- **Two focusable timestamps per row.** Deliberate and now without exception:
  the earlier `copy={false}` escape hatch is withdrawn, because it hid the
  exact value and any unavailability reason from keyboard users.
- **`Import.tsx` is edited.** One timestamp plus 17 mechanical number
  substitutions; no structural change to the Passage route. The timestamp is
  mandatory — dropping it would leave an ordinary receipt raw and fail the
  issue's "replace every raw timestamp rendering". If the coordinator forbids
  touching that file, the plan records it as a documented, visible exception,
  not a silent one.

## Cost estimate

The earlier "about one day" was wrong: its own itemisation summed to 10.5 h,
and it omitted the number migration, the #11 integration, the precision and
DST work, the Axe baseline and the keyboard evidence. Honest estimate:

| Work | Hours |
|---|---|
| `settings.ts` (validation, canonicalisation, diagnostics, precedence) + `theme.ts` listener + tests | 4 |
| `parseInstant`, `formatDate`, `formatDuration`, `formatSpan` + tests | 5 |
| Number migration across 13 files, the lint rule, the exact-value check, the ambient propagation test | 4 |
| `patchScope`/`toggle`/`remove`/`scopeHref`, `ScopeCell`, `ScopeChips`, focus management + tests | 4 |
| `dates.tsx`, `ThemeToggle` extraction, the Settings page, styles, the clipping fix | 4 |
| Axe baseline (pre-change run + recording) and the Playwright spec incl. keyboard and cross-page | 5 |
| ADR amendment, #11 integration, full CI, review fixes | 3 |
| **Total** | **29 h** |

Dated critical path against the v0.1.0 milestone (due `2026-09-11T23:00Z`,
`docs/planning/2026-09-07-consolidated-plan.md:140`):

- **Sep 8** — this revision published; §0 handed to #11 as the interface to
  consume; number migration in the shared components (`primitives.tsx`,
  `charts.tsx`, `bars.tsx`) landed first so #11 rebases onto it once.
- **Sep 9** — settings store, theme listener, formatters, their tests: work
  with no #11 dependency at all.
- **Sep 10** — cells, chips, Settings page, styles, integration tests; Axe
  baseline captured against the pre-change revision.
- **Sep 11** — Playwright, keyboard and screenshot evidence; combined #46/#11
  acceptance; review fixes. Reserved, not spent on new scope.

If #11 slips past Sep 11, #46 ships complete: model cells render as text and
become links with no #46 edit when the key lands. Schedule is **not** recovered
by dropping a timestamp, a locale consumer, or the new-violation detection; if
something must give, it is the assistant/import number migration, which would
be recorded in this section as a named exception with the remaining `en-US`
sites listed.

---

## Revision 2 after Codex review

This section supersedes conflicting details in earlier revisions and answers
every finding in `2026-09-08-tables-dates-settings-review-codex.md`. Every
reproducible claim was re-checked before acceptance; the verification is noted
where it changed the outcome. **All 16 findings are accepted; none is
contested.**

1. **P1 — accepted.** Adding a default argument to `display`/`abbreviate` would
   have left 37 direct `toLocaleString('en-US')` sites untouched, so a German
   viewer could have seen an abbreviated KPI beside an English exact value. The
   plan now carries the **complete inventory** (*Current state → Numbers*: 4
   sites in `format.ts` and 37 elsewhere across 12 files, plus two ungrouped
   counts at `assist/ActionBar.tsx:69`), migrates all of them to `num` /
   `decimal` / `display` in §3, adds an `oxlint no-restricted-syntax` rule
   forbidding `toLocaleString` outside `format.ts` so it cannot regress, and
   writes down the verbatim exemptions (`payload_text`, the emission
   `JSON.stringify`, mapping documents, ids and hashes). The exact-value rule is
   kept explicitly: the abbreviation and its exact companion are computed from
   the same locale. `bars.tsx`, `primitives.tsx`, `charts.tsx`,
   `Sessions.tsx:22` and `Imports.tsx:12` are now in Files touched, and the
   sequencing with #11 is in §0 and the schedule. A mounted-page locale test on
   a KPI's exact value and coverage, the scope receipt and the Imports counts is
   named in § Tests.

2. **P1 — accepted.** The old wording ("a choice made on this page wins") did
   defeat cross-tab sync: tab A's `chosen` would have survived tab B's event.
   §1 now states **one rule** — a choice that reached storage is shared and an
   external change wins; a choice this tab could not persist is this tab's until
   reload and is never clobbered — implemented by a `persisted` flag and given
   as pseudocode covering `event.key === null` (another tab's `clear()`),
   `newValue === null` (key removal), malformed external values and storage
   failure. `theme.ts` gains the same listener and flag while its pre-paint
   bootstrap (`web/index.html:9-14`, `main.tsx:12`) stays untouched, so a
   cross-tab theme change now reaches this tab. The existing test at
   `components.test.tsx:123-139` (stale storage + throwing `setItem` → in-memory
   wins) is preserved by construction and named as a must-keep. Persistence is
   proven by re-importing the module with `vi.resetModules()`, not by a cached
   reread, and two-way updates and reset propagation are tested.

3. **P1 — accepted.** Re-checked: `/Users/sean/dev/AgentScope-wt/11/docs/superpowers/plans/2026-09-08-dashboard.md`
   still does not exist. §0 is therefore rewritten as **the authoritative
   interface #46 owns and ships**, not a proposal: all four keys, the
   type-exhaustive `SCOPE_LABELS` (a missing label is a typecheck failure),
   `SCOPE_VALUE_FORMATTERS` with #11 owning the `period` renderer, period
   absence meaning "unrestricted" with no implicit default, the exact
   `ScopeChips` props and placement, `patchScope`'s return type, and both merge
   orders spelled out. The review is right that the Model cell had no owner and
   that `sessionsTable.tsx` has no Model column: the real cell is
   `Session.tsx:36`. **#46 now owns every Model cell**, converts `Session.tsx:36`
   in this issue with `target="/sessions"`, and `ScopeCell` renders plain text
   for any dimension not yet in `SCOPE_KEYS` — so the cell is honest while the
   API ignores `model=`, and becomes a link with zero further edits when #11
   appends the key. The "two-line extension" framing is withdrawn; the shared
   files and their semantic dependency are listed, and the schedule sequences
   them.

4. **P2 — accepted.** Correct: the smoke project creates imports during the run,
   so with `relativeTimes` defaulting to true the ledger would have read
   `just now` and never matched an absolute regex. The e2e is rebuilt: the
   absolute-format scenario turns relative times **off** through the real
   control, the project pins `timezoneId: 'Europe/Paris'` and `locale: 'en-US'`,
   and the relative behaviour is a separate scenario. The propagation scenario
   now keeps `/imports` open in page A while page B changes the setting in the
   same browser context, asserting the already-mounted ledger changes without
   reload, navigation or remount, then reloads for persistence; the same-tab
   navigation path is kept as a separate case. The ISO comparison locates a
   **named** session by external id and compares that session's
   `observed_start_at`, not an arbitrary cell against the first API row. The
   radio sample now names the resolved zone beside it, so it is not silently
   zone-dependent.

5. **P2 — accepted.** The old propagation test used `DateText`, which subscribes
   directly and would pass with the `App` subscription removed. § Tests now
   names an **ambient** test: under the production
   `SettingsProvider > App > ShellProvider` composition, changing the locale
   must change a KPI's exact value, its coverage fraction and the scope receipt
   — none of which subscribe — with a DOM-identity check proving no remount and
   page-local state preserved. The providerless fallback is covered separately,
   and `App.test.tsx`'s `start()` gains a provider-wrapped variant.

6. **P2 — accepted, with the reproduction confirmed.**
   `Intl.DateTimeFormat('en-US', { timeZone:'UTC', timeZoneName:'longOffset' })`
   yields `"GMT"`, not `"GMT+00:00"` (verified here; `Europe/Paris` gives
   `"GMT+02:00"`, `Asia/Kathmandu` `"GMT+05:45"`). §3 normalises a bare `GMT` to
   `+00:00` and pads short forms, and computes the offset **at the input
   instant**. Confirmed too that `2026-10-25T00:30:00Z` and `01:30:00Z` both
   render `2:30 AM` in Paris, so the offset is now applied to **all** session
   timestamps, model and tool call tables included, not only the Interval facts.
   Tests are named for spring-forward, fall-back, UTC, `Asia/Kathmandu`,
   midnight and noon across all three formats. Calendar, numbering system and
   hour cycle are specified, and month names come from a fixed English table
   because `formatToParts` alone does not make localized month names
   engine-independent.

7. **P2 — accepted, with the reproduction confirmed.** Verified here:
   `Date.parse('2026-02-30T12:00:00Z')` is finite and becomes `2026-03-02`;
   `Date.parse('0')` is finite; `'2026-09-08T14:05:00'` is read in the machine's
   zone. §3 replaces the `Date.parse` + finite guard with an explicit grammar
   (`YYYY-MM-DDTHH:MM:SS(.f{1,9})?(Z|±HH:MM)`) plus a calendar round-trip check,
   because the backend's `UtcDateTime` makes the wire format narrow and known.
   Impossible dates, offset-free strings, `'0'`, whitespace and non-strings are
   all `Unavailable`, never an inferred instant. Tests cover leap-day valid and
   invalid, offset-free, numeric-string, whitespace, malformed settings and a
   non-finite `now`, and assert every field of the unavailable result; all
   `Intl` construction is wrapped so an invalid zone or locale cannot escape as
   an exception.

8. **P2 — accepted, with the reproduction confirmed.** Verified here that
   subtracting `…00.123456Z` from `…00.123455Z` with `Date.parse` gives exactly
   `0`, which would have printed a reversed interval as a real `0 s`. §3 now
   parses instants to **microseconds as a `bigint`** and subtracts bigints, so
   sub-millisecond spans keep their exact seconds and sub-millisecond reversals
   are detected. Rejection covers `undefined` and `±Infinity` as well as null,
   `NaN` and negatives; the missing-start, missing-end, unreadable-endpoint and
   reversed reasons are distinct; the band/carry behaviour at 1 s, 10 s, 60 s,
   60 min and 24 h is specified and tested. Reversal assertions move to
   `SpanText`, since `DurationText({ms})` has one endpoint. `Imports.tsx:60,67`:
   the Lead keeps its title sentence and gains a body line
   `Started … · finished … · took <SpanText/>`, so the exact seconds are
   reachable — the existing e2e regex on the title is unaffected.

9. **P2 — accepted.** `N` now has a rounding policy: `Math.round` with
   **promotion to the next band whenever the rounded count reaches that band's
   threshold**, so 44.6 s gives `1 min ago` rather than `0 min ago` and 89.9 min
   gives `2 h ago` rather than `90 min ago`. The contradiction is resolved: a
   future instant is rendered as future, and within 45 s it reads `just now` in
   both directions — the "never clamped" sentence meant only that no value is
   fabricated, and it is rewritten. "Under 7 days" is defined as elapsed
   duration. Tests hit just below, exactly at and just above each of 45 s,
   90 min, 36 h and 7 d in both directions, plus relative-off, a controlled
   minute-tick crossing a boundary, and `useNow` subscribe/unsubscribe under
   mount, unmount and StrictMode with no leaked timer and module state restored.

10. **P2 — accepted, with the reproductions confirmed.** Verified here that
    `US/Eastern` is accepted and resolves to `America/New_York` while
    `Intl.supportedValuesOf('timeZone')` does **not** contain it, and that
    `fr-CA` is a supported locale outside the six presets. §1 now canonicalises
    validated zones and locales, writes back the canonical form, and
    `timeZoneOptions(current)` / `localeOptions(current)` **always include the
    effective current value**, so the select can never disagree with what is in
    force. Validation evidence is carried separately in `readDiagnostics()`, so
    the promised unknown-zone warning is reachable instead of being destroyed by
    the fallback. Tests cover an alias, an unsupported stored zone, a
    non-preset locale, a missing `supportedValuesOf`, and reset leaving every
    control consistent.

11. **P2 — accepted.** §5 introduces one pure `patchScope(search, patch)` that
    `set`, `toggle`, `remove` and `scopeHref` all use, so `URLSearchParams`
    encoding, trimming, empty-deletes, `offset` reset and preservation of other
    scope keys and non-scope parameters are identical everywhere; the
    target-route rule (only scope keys travel) is stated as the one deliberate
    exception, and the absence of hash routing and the push-history/Back
    behaviour are recorded. Precedence is fixed: the active-value naming beats
    the target-route naming. Tests add `trace & lab`, a model with `+ & = # /`
    and Unicode, four-key removal and clear-all, `offset` reset on add and on
    clear, and both keyboard Enter and middle/modifier-click opening the correct
    href without changing the original tab. The existing session-id anchor at
    `sessionsTable.tsx:13` is explicitly preserved: "ids stay text" refers to
    scope links, not to that navigation route.

12. **P2 — accepted.** `ScopeChip`'s remove button gains `.has-tip` +
    `data-tip` (props unchanged) and `bars.tsx` joins Files touched — the
    earlier claim that no edit was needed there is withdrawn, and §0 records it
    for #11. The theme control is **not** relabelled a radiogroup: the existing
    named `aria-pressed` group is kept and extracted into a shared
    `ThemeToggle` used by both the rail and the Settings page, so one complete
    implementation exists. `.theme-toggle { overflow: hidden }` is fixed so the
    tooltip and the outward focus ring are not clipped. Durations and
    unavailability reasons are now rendered by the same focusable button as
    dates, and the `copy={false}` dense-table fallback is **withdrawn** because
    it would have hidden the exact value from keyboard users. Focus after chip
    removal is specified (next chip → `Clear all` → the table caption). Browser
    tests are named for Tab/Enter, post-removal focus, the selected theme state,
    focus rings and tooltips in both themes, and the last row and scroll edge.

13. **P2 — accepted.** The lockfile path is corrected to
    **`web/pnpm-lock.yaml`** (there is no root lockfile). The Axe policy is
    tightened: a baseline is captured against the pre-change revision with the
    same engine and route states, committed as `web/e2e/axe-baseline.json`, and
    the assertion compares `(ruleId, target)` pairs as a subset — **no rule is
    ever globally disabled**, so a new target under an existing rule fails. The
    sweep waits for loaded data, includes a scoped state with an active chip,
    both themes, and the edited report and already-imported surfaces, and
    asserts that injection and analysis actually completed. Manual keyboard and
    focus checks are kept alongside. The review's CSP note is confirmed: no CSP
    is enforced anywhere in this repo, so nothing needs weakening; that is now
    recorded in *Current state* rather than speculated about.

14. **P2 — accepted.** The claim that no e2e asserts a rendered timestamp was
    false: `web/e2e/assist.spec.ts:75` asserts `/2025-09-04T15:33:2\d/` inside
    the verbatim emission JSON at `assist/ActionBar.tsx:73`. *Current state* now
    records this, §3 states the source/preview-JSON exemption explicitly, and
    the assertion stays. `Import.tsx:264` is **mandatory**, not droppable. The
    grep is demoted from proof to a search aid: the *Where each rendering is
    used* table is the maintained inventory and is checked by hand.
    `App.test.tsx` gains a scope-sensitive `/api/sessions` mock so narrowing is
    proven by rendered rows; the e2e expects **40 data rows** scoped and 50
    (`PAGE_SIZE`) unscoped rather than 80, asserts the receipt and pagination
    are restored, and project ordering is made deterministic
    (`assistant` now depends on `settings`) so the two `epoch-assist` sessions
    cannot perturb the counts. The missing source-link test is added, and both
    storage keys and the module registry are reset between tests.

15. **P2 — accepted.** The estimate is rebuilt from the real scope: **29 h**,
    itemised in § Cost estimate, including the number migration, the #11
    integration, the precision and DST work, the Axe baseline and the keyboard
    evidence. A dated critical path against the `2026-09-11T23:00Z` milestone is
    published (Sep 8 contract and shared-component migration, Sep 9 independent
    settings/date work, Sep 10 cells/chips/page/baseline, Sep 11 reserved for
    combined acceptance, accessibility evidence and review fixes), with the
    stated behaviour if #11 slips and an explicit refusal to recover schedule by
    dropping timestamps, locale consumers or new-violation detection.

16. **P3 — accepted.** The inversion claim is corrected: `MERGED.md:443-445`
    records 212 rows with inversions inside the **source** `timing_events` and
    says bounds are taken with min/max, so it is evidence that inverted source
    data exists and must be handled defensively, not proof of 212 reversed
    normalised intervals. Line references are re-verified at `76c8930` (wall
    latency is `Session.tsx:50`, the model cell `Session.tsx:36`, `ScopeChip`
    `bars.tsx:45`, the Lead's `seconds()` call `Imports.tsx:67`).
    `docs/architecture/import-pipeline.md` is **removed from Files touched**: it
    describes the implementation frozen at `2a351e9` (`:3-6`), so adding a route
    that did not exist then would make its snapshot inaccurate. The new route is
    recorded in the ADR-006 amendment only.
