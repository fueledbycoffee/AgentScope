import { setTheme } from './theme'

/**
 * The viewer's display choices: how a date, a time zone and a number should
 * read on this machine. They are never sent to the server and never describe
 * the data, only its presentation. The module is `theme.ts`'s pattern one size
 * up: one storage key, one in-memory fallback for a browser that refuses to
 * store, and a `useSyncExternalStore` snapshot with a stable identity.
 */

export type DateFormatId = 'iso' | 'dmy' | 'mdy'

export interface Settings {
  dateFormat: DateFormatId
  /** 'viewer' or a canonical IANA zone name. */
  timeZone: string
  relativeTimes: boolean
  /** A canonical BCP-47 tag. */
  numberLocale: string
}

/** What the validator had to discard, so the page can say why rather than hide it. */
export interface Diagnostics {
  timeZone?: { stored: string; reason: 'unknown-zone' }
  numberLocale?: { stored: string; reason: 'unsupported-locale' }
  storage?: 'unavailable'
}

export const DEFAULTS: Settings = { dateFormat: 'iso', timeZone: 'viewer', relativeTimes: true, numberLocale: 'en-US' }
export const STORAGE_KEY = 'agentscope-settings'
export const VIEWER_ZONE = 'viewer'

export const DATE_FORMATS: readonly { id: DateFormatId; label: string }[] = [
  { id: 'iso', label: 'ISO 8601' },
  { id: 'dmy', label: 'Day month year' },
  { id: 'mdy', label: 'US' },
]

/** Presets only: any locale the engine supports can already be stored, and is offered when it is. */
export const NUMBER_LOCALES: readonly { id: string; label: string }[] = [
  { id: 'en-US', label: 'English (United States) — 1,234,567.89' },
  { id: 'en-GB', label: 'English (United Kingdom) — 1,234,567.89' },
  { id: 'de-DE', label: 'German (Germany) — 1.234.567,89' },
  { id: 'fr-FR', label: 'French (France) — 1 234 567,89' },
  { id: 'es-ES', label: 'Spanish (Spain) — 1.234.567,89' },
  { id: 'ja-JP', label: 'Japanese (Japan) — 1,234,567.89' },
]

const listeners = new Set<() => void>()

// The precedence rule, in three variables:
//   a choice that reached storage is the stored choice;
//   a choice this tab could not persist is this tab's until reload.
let memory: Settings | undefined // the last choice made on this page
let persisted = true // whether that choice reached storage
let cache: Settings | undefined // the snapshot handed to useSyncExternalStore
let diagnostics: Diagnostics = {}

/* -------------------------------------------------------------- validation */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The zone as the engine names it, or undefined when it does not know it. `US/Eastern` canonicalises. */
export function canonicalZone(value: string): string | undefined {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone
  } catch { return undefined }
}

/** The locale as the engine names it, or undefined when it cannot format with it. */
export function canonicalLocale(value: string): string | undefined {
  try {
    const [supported] = Intl.NumberFormat.supportedLocalesOf([value])
    if (!supported) return undefined
    const [canonical] = Intl.getCanonicalLocales([supported])
    return canonical
  } catch { return undefined }
}

/**
 * Every field is validated on its own: an unknown value falls back to its
 * default and the discarded value is recorded, so a corrupt or hand-edited
 * entry degrades one choice instead of breaking a page.
 */
function validate(raw: unknown): { settings: Settings; diagnostics: Diagnostics } {
  const found: Diagnostics = {}
  if (!isRecord(raw)) return { settings: DEFAULTS, diagnostics: found }
  const settings: Settings = { ...DEFAULTS }
  if (DATE_FORMATS.some(format => format.id === raw.dateFormat)) settings.dateFormat = raw.dateFormat as DateFormatId
  if (typeof raw.relativeTimes === 'boolean') settings.relativeTimes = raw.relativeTimes
  if (typeof raw.timeZone === 'string' && raw.timeZone) {
    if (raw.timeZone === VIEWER_ZONE) settings.timeZone = VIEWER_ZONE
    else {
      const zone = canonicalZone(raw.timeZone)
      if (zone) settings.timeZone = zone
      else found.timeZone = { stored: raw.timeZone, reason: 'unknown-zone' }
    }
  }
  if (typeof raw.numberLocale === 'string' && raw.numberLocale) {
    const locale = canonicalLocale(raw.numberLocale)
    if (locale) settings.numberLocale = locale
    else found.numberLocale = { stored: raw.numberLocale, reason: 'unsupported-locale' }
  }
  return { settings, diagnostics: found }
}

/* ------------------------------------------------------------------ store */

function load(): Settings {
  let raw: string | null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    diagnostics = { storage: 'unavailable' }
    return memory ?? DEFAULTS
  }
  if (raw === null) {
    diagnostics = {}
    return DEFAULTS
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    diagnostics = {}
    return DEFAULTS
  }
  const result = validate(parsed)
  diagnostics = result.diagnostics
  return result.settings
}

/**
 * The snapshot. Its identity is stable until a write or `invalidateSettings`,
 * because `useSyncExternalStore` re-renders forever on a fresh object.
 */
export function readSettings(): Settings {
  if (cache) return cache
  if (memory && !persisted) return (cache = memory) // our write never reached storage
  return (cache = load())
}

export function readDiagnostics(): Diagnostics {
  readSettings() // diagnostics are produced by the same pass that validates
  return diagnostics
}

/**
 * Drop the cached snapshot so the next read consults storage again. A choice
 * this tab could not persist still wins, which is exactly what the cross-tab
 * listener in #46b needs; tests use it to observe a directly seeded value.
 */
export function invalidateSettings() {
  cache = undefined
}

function notify() {
  listeners.forEach(listener => listener())
}

export function setSettings(patch: Partial<Settings>) {
  const result = validate({ ...readSettings(), ...patch })
  const next = result.settings
  memory = next
  cache = next
  // Diagnostics describe what is stored. A write replaces the stored document
  // with validated values, so a warning about a corrected — or simply
  // superseded — value must go with it, and one about this patch must appear.
  diagnostics = result.diagnostics
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    persisted = true
  } catch {
    persisted = false // private mode: the in-memory choice still applies to this tab
    diagnostics = { ...diagnostics, storage: 'unavailable' }
  }
  notify()
}

/** Defaults for everything this page shows, the theme included. */
export function resetSettings() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch { /* the in-memory reset below still applies */ }
  memory = DEFAULTS
  cache = DEFAULTS
  persisted = true
  diagnostics = {}
  setTheme('system')
  notify()
}

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/* -------------------------------------------------------------- resolution */

/** The IANA zone to format in. Never throws: an unknown value already fell back in `validate`. */
export function resolveTimeZone(settings: Settings): string {
  if (settings.timeZone !== VIEWER_ZONE) {
    const zone = canonicalZone(settings.timeZone)
    if (zone) return zone
  }
  return viewerZone()
}

export function viewerZone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch { return 'UTC' }
}

export function resolveLocale(settings: Settings): string {
  return canonicalLocale(settings.numberLocale) ?? DEFAULTS.numberLocale
}

/**
 * Every zone the engine knows, with `viewer` and `UTC` first and the effective
 * choice always present: `supportedValuesOf` omits accepted aliases such as
 * `US/Eastern`, so a stored zone can be valid and still be missing from it.
 */
export function timeZoneOptions(current: string): string[] {
  let all: string[] = []
  try {
    all = Intl.supportedValuesOf?.('timeZone') ?? []
  } catch { all = [] }
  // Options are canonicalised and deduplicated for the same reason the stored
  // value is: engines disagree about spellings (`Asia/Kathmandu` resolves to
  // `Asia/Katmandu` on this ICU), and a select whose values are not the names
  // we store would show nothing selected.
  const seen = new Set<string>([VIEWER_ZONE, 'UTC'])
  const options = [VIEWER_ZONE, 'UTC']
  for (const zone of all) {
    const canonical = canonicalZone(zone) ?? zone
    if (seen.has(canonical)) continue
    seen.add(canonical)
    options.push(canonical)
  }
  if (current && !seen.has(current)) options.splice(2, 0, current)
  return options
}

export function localeOptions(current: string): { id: string; label: string }[] {
  const options = NUMBER_LOCALES.map(option => ({ ...option }))
  if (current && !options.some(option => option.id === current)) options.unshift({ id: current, label: current })
  return options
}
