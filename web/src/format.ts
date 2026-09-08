import type { EntityCounts } from './api'
import { DEFAULTS, readSettings, resolveLocale, resolveTimeZone } from './settings'
import type { Settings } from './settings'

/**
 * Every number and every date on screen is formatted here, so one choice on
 * /settings governs the whole application. Functions take the settings
 * explicitly where the behaviour is intricate enough to deserve direct tests;
 * the number helpers default to the current settings, which is correct because
 * `App` subscribes and so recreates the routed tree on a change.
 */

export const PAGE_SIZE = 50
export const UNAVAILABLE = 'Unavailable'

/* ----------------------------------------------------------------- numbers */

const numberFormats = new Map<string, Intl.NumberFormat>()
function numberFormat(locale: string, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${options ? JSON.stringify(options) : ''}`
  let format = numberFormats.get(key)
  if (!format) {
    try {
      format = new Intl.NumberFormat(locale, options)
    } catch {
      format = new Intl.NumberFormat(DEFAULTS.numberLocale, options)
    }
    numberFormats.set(key, format)
  }
  return format
}

/** A number for reading: grouped in the chosen locale, or the designed Unavailable. */
export function num(value: number | null | undefined, settings: Settings = readSettings()): string {
  if (value == null || !Number.isFinite(value)) return UNAVAILABLE
  return numberFormat(resolveLocale(settings)).format(value)
}

export function decimal(value: number, maxFractionDigits: number, settings: Settings = readSettings()): string {
  if (!Number.isFinite(value)) return UNAVAILABLE
  return numberFormat(resolveLocale(settings), { maximumFractionDigits: maxFractionDigits }).format(value)
}

export const display = (value: string | number | boolean | null | undefined, settings: Settings = readSettings()) =>
  value == null ? UNAVAILABLE : typeof value === 'number' ? num(value, settings) : String(value)

export const entityCounts = (counts: EntityCounts) => ({
  session: counts.session ?? 0,
  model_call: counts.model_call ?? 0,
  tool_call: counts.tool_call ?? 0,
})

/** Abbreviate only above 99,999 (ADR-006 rule 2); the exact value is printed beside it by the caller. */
export function abbreviate(value: number, settings: Settings = readSettings()): string {
  if (!Number.isFinite(value)) return UNAVAILABLE
  if (Math.abs(value) < 100_000) return num(value, settings)
  const units: [number, string][] = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k']]
  for (const [size, suffix] of units) {
    if (Math.abs(value) >= size) return `${decimal(value / size, 1, settings)}${suffix}`
  }
  return num(value, settings)
}

/* ------------------------------------------------- exact values as text --- */

const decimalSeparators = new Map<string, string>()

/** The locale's decimal separator, read from the engine rather than assumed. */
function decimalSeparator(locale: string): string {
  let found = decimalSeparators.get(locale)
  if (found === undefined) {
    found = numberFormat(locale).formatToParts(1.5).find(part => part.type === 'decimal')?.value ?? '.'
    decimalSeparators.set(locale, found)
  }
  return found
}

const DECIMAL_TEXT = /^([+-]?)(\d+)(?:\.(\d+))?$/

/**
 * Group an exact decimal *string* without ever parsing it to a number.
 *
 * The metric layer sends values that must round-trip losslessly as text, and
 * some exceed Number.MAX_SAFE_INTEGER; rendering them raw would ignore the
 * viewer's locale, and `Number(text)` would corrupt them. The original string
 * is not modified: callers keep it for copying and for transport.
 */
export function formatExactText(text: string | null | undefined, settings: Settings = readSettings()): string {
  if (text == null) return UNAVAILABLE
  const match = DECIMAL_TEXT.exec(text.trim())
  if (!match) return text // not a plain decimal: show exactly what we were given
  const [, sign, whole, fraction] = match
  const locale = resolveLocale(settings)
  // The integer part is grouped by Intl itself, on a bigint so no digit is
  // lost. Inferring "every three digits" from a sample would disagree with
  // `num` wherever a locale has a minimum grouping threshold: Spanish groups
  // only from five digits, so 1234,5 must not become 1.234,5.
  let grouped: string
  try {
    grouped = numberFormat(locale).format(BigInt(whole))
  } catch {
    grouped = whole
  }
  return `${sign}${grouped}${fraction ? decimalSeparator(locale) + fraction : ''}`
}

/* --------------------------------------------------------------- instants */

const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/

/**
 * Microseconds since the epoch, as a bigint.
 *
 * The grammar is the API's own and nothing else: `Date.parse` would accept
 * `2026-02-30T12:00:00Z` (silently moving it to 2 March), the bare `'0'`, and
 * an offset-free string read in the machine's zone. Fractions are capped at six
 * digits because that is all a UTC-aware Python datetime can carry, which keeps
 * the accepted precision equal to the arithmetic precision below: no accepted
 * pair of instants can be indistinguishable.
 */
export function parseInstant(value: unknown): bigint | undefined {
  if (typeof value !== 'string') return undefined
  const match = ISO.exec(value)
  if (!match) return undefined
  const [, year, month, day, hour, minute, second, fraction, zone] = match
  const y = Number(year), mo = Number(month), d = Number(day)
  const h = Number(hour), mi = Number(minute), s = Number(second)
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return undefined
  // Not Date.UTC: it maps years 0-99 to 1900-1999, which would reject an early
  // instant the backend can serialise and take its exact value away with it.
  const back = new Date(0)
  back.setUTCFullYear(y, mo - 1, d)
  back.setUTCHours(h, mi, s, 0)
  const utc = back.getTime()
  // A calendar round trip rejects 2026-02-30 and 2026-02-29 rather than shifting them.
  if (!Number.isFinite(utc)) return undefined
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return undefined
  const micros = BigInt(utc) * 1000n + BigInt((fraction ?? '').padEnd(6, '0') || '0')
  if (zone === 'Z') return micros
  const offsetHours = Number(zone.slice(1, 3))
  const offsetMinutes = Number(zone.slice(4, 6))
  // RFC 3339 allows -23:59 to +23:59. An unchecked offset would silently move
  // the instant instead of being refused: +99:99 is not four days earlier, it
  // is not a timestamp.
  if (offsetHours > 23 || offsetMinutes > 59) return undefined
  const sign = zone.startsWith('-') ? 1n : -1n
  const offset = BigInt(offsetHours * 60 + offsetMinutes) * 60_000_000n
  return micros + sign * offset
}

/* ------------------------------------------------------------------ dates */

export interface FormattedDate {
  /** What the surface prints. */
  text: string
  /** The absolute rendering, in the chosen format and zone. */
  absolute: string
  /** '3 h ago' when the instant is within seven days and relative times are on. */
  relative: string | null
  /** The API's string, verbatim: never rebuilt, so microseconds survive. */
  iso: string
  unavailable: boolean
}

/**
 * Floor division on bigints. `/` truncates toward zero, so a microsecond before
 * the epoch would round up into the next millisecond — and 1969-12-31T23:59:59.999999Z
 * would display as 1970-01-01.
 */
function floorDiv(value: bigint, by: bigint): bigint {
  const quotient = value / by
  return value % by !== 0n && (value < 0n) !== (by < 0n) ? quotient - 1n : quotient
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dateFormats = new Map<string, Intl.DateTimeFormat>()

function dateFormat(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`
  let format = dateFormats.get(key)
  if (!format) {
    const base: Intl.DateTimeFormatOptions = { timeZone, calendar: 'gregory', numberingSystem: 'latn', ...options }
    try {
      format = new Intl.DateTimeFormat('en-US', base)
    } catch {
      format = new Intl.DateTimeFormat('en-US', { ...base, timeZone: 'UTC' })
    }
    dateFormats.set(key, format)
  }
  return format
}

type Parts = Record<string, string>
const partsOf = (format: Intl.DateTimeFormat, at: Date): Parts =>
  Object.fromEntries(format.formatToParts(at).map(part => [part.type, part.value]))

/**
 * The offset at this instant, as `+02:00`. The engine returns a bare `GMT` at
 * zero offset rather than `GMT+00:00`, and a short `GMT+2` in some cases, so
 * both are normalised. Computing it per instant is what keeps the two Paris
 * fall-back instants — which both read 02:30 — distinguishable.
 */
function offsetAt(timeZone: string, at: Date): string {
  const raw = partsOf(dateFormat(timeZone, { timeZoneName: 'longOffset', hour: '2-digit' }), at).timeZoneName ?? ''
  const rest = raw.replace(/^(GMT|UTC)/, '')
  if (!rest) return '+00:00'
  const match = /^([+-])(\d{1,2})(?::(\d{2}))?$/.exec(rest)
  if (!match) return rest
  return `${match[1]}${match[2].padStart(2, '0')}:${match[3] ?? '00'}`
}

function absoluteText(settings: Settings, timeZone: string, at: Date): string {
  const h12 = settings.dateFormat === 'mdy'
  const parts = partsOf(dateFormat(timeZone, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hour12: h12, hourCycle: h12 ? 'h12' : 'h23',
  }), at)
  // Intl prints year 1 as "1"; every rendering here is a fixed-width date.
  const year = (parts.year ?? '').padStart(4, '0')
  const { month, day, hour, minute } = parts
  if (settings.dateFormat === 'iso') return `${year}-${month}-${day} ${hour}:${minute}`
  // Month names come from a fixed table: engines disagree ("Sep" against "Sept"),
  // and the number locale is a choice about digits, not about language.
  if (settings.dateFormat === 'dmy') return `${day} ${MONTHS[Number(month) - 1]} ${year} ${hour}:${minute}`
  const period = (parts.dayPeriod ?? '').replace(/ | /g, ' ').trim().toUpperCase()
  return `${month}/${day}/${year} ${Number(hour)}:${minute}${period ? ` ${period}` : ''}`
}

const SECOND = 1000, MINUTE = 60 * SECOND, HOUR = 60 * MINUTE, DAY = 24 * HOUR

/**
 * Bands with promotion: the count is rounded, and if it reaches the next band's
 * threshold the next band is used instead, so 44.6 s reads "1 min ago" rather
 * than "0 min ago" and 89.9 min reads "2 h ago" rather than "90 min ago".
 */
function relativeText(deltaMs: number, settings: Settings): string | null {
  const ahead = deltaMs < 0
  const magnitude = Math.abs(deltaMs)
  if (magnitude >= 7 * DAY) return null
  const say = (count: number, unit: string) =>
    ahead ? `in ${num(count, settings)} ${unit}` : `${num(count, settings)} ${unit} ago`
  // Promotion applies here too: 44.6 s rounds to 45 s, which reaches the next
  // band, so it reads as a minute rather than "just now".
  if (Math.round(magnitude / SECOND) < 45) return 'just now'
  const minutes = Math.round(magnitude / MINUTE)
  if (magnitude < 90 * MINUTE && minutes < 90) return say(Math.max(1, minutes), 'min')
  const hours = Math.round(magnitude / HOUR)
  if (magnitude < 36 * HOUR && hours < 36) return say(Math.max(1, hours), 'h')
  const days = Math.round(magnitude / DAY)
  if (days < 7) return say(Math.max(1, days), 'd')
  return null
}

const unavailableDate = (): FormattedDate =>
  ({ text: UNAVAILABLE, absolute: UNAVAILABLE, relative: null, iso: '', unavailable: true })

/**
 * One timestamp, in every rendering a surface may need. An unreadable or
 * missing value is Unavailable: an instant is never inferred from an ambiguous
 * string, and the current time is never substituted for a missing one.
 */
export function formatDate(
  value: string | null | undefined,
  settings: Settings,
  options: { prefer?: 'absolute' | 'relative'; offset?: boolean; now?: number } = {},
): FormattedDate {
  const micros = parseInstant(value)
  if (micros === undefined || typeof value !== 'string') return unavailableDate()
  const at = new Date(Number(floorDiv(micros, 1000n)))
  if (Number.isNaN(at.getTime())) return unavailableDate()
  const timeZone = resolveTimeZone(settings)
  let absolute = absoluteText(settings, timeZone, at)
  if (options.offset) absolute += ` (UTC${offsetAt(timeZone, at)})`
  const now = options.now ?? Date.now()
  const relative = settings.relativeTimes && Number.isFinite(now) ? relativeText(now - at.getTime(), settings) : null
  return {
    text: options.prefer === 'relative' ? relative ?? absolute : absolute,
    absolute,
    relative,
    iso: value,
    unavailable: false,
  }
}

/* -------------------------------------------------------------- durations */

export interface FormattedDuration {
  /** '1 h 12 min', for reading. */
  text: string
  /** The total in seconds at the source's precision, for the tooltip and the copy. */
  exact: string
  unavailable: boolean
  /** Why, when it is unavailable. */
  reason?: string
}

const unavailableDuration = (reason: string): FormattedDuration =>
  ({ text: UNAVAILABLE, exact: UNAVAILABLE, unavailable: true, reason })

/** The label for a non-negative duration given in microseconds. */
function durationText(micros: bigint, settings: Settings): string {
  const ms = Number(micros) / 1000
  if (micros === 0n) return `${num(0, settings)} s` // an instant interval is a real zero, not "0 ms"
  const milliseconds = Math.round(ms)
  if (ms < SECOND && milliseconds < 1000) return `${num(milliseconds, settings)} ms`
  if (ms < 10 * SECOND) return `${decimal(ms / SECOND, 1, settings)} s`
  // A count that rounds up to the next band's threshold is promoted rather than
  // printed: 59.6 s is "1 min", never "60 s", exactly as 89.9 min is never
  // "90 min ago".
  const seconds = Math.round(ms / SECOND)
  if (ms < 60 * SECOND && seconds < 60) return `${num(seconds, settings)} s`
  // Larger unit floors, smaller rounds, and a smaller unit that rounds up to a
  // full larger unit carries into it rather than printing "12 min 60 s".
  const carry = (whole: number, size: number, rest: number) => (rest === size ? [whole + 1, 0] : [whole, rest])
  if (ms < 60 * MINUTE) {
    const [minutes, seconds] = carry(Math.floor(ms / MINUTE), 60, Math.round((ms % MINUTE) / SECOND))
    if (minutes >= 60) return `${num(1, settings)} h`
    return seconds ? `${num(minutes, settings)} min ${num(seconds, settings)} s` : `${num(minutes, settings)} min`
  }
  if (ms < 24 * HOUR) {
    const [hours, minutes] = carry(Math.floor(ms / HOUR), 60, Math.round((ms % HOUR) / MINUTE))
    if (hours >= 24) return `${num(1, settings)} d`
    return minutes ? `${num(hours, settings)} h ${num(minutes, settings)} min` : `${num(hours, settings)} h`
  }
  const [days, hours] = carry(Math.floor(ms / DAY), 24, Math.round((ms % DAY) / HOUR))
  return hours ? `${num(days, settings)} d ${num(hours, settings)} h` : `${num(days, settings)} d`
}

/** Seconds as exact text, never through a float: microseconds are integers here. */
function exactSeconds(micros: bigint, settings: Settings): string {
  const negative = micros < 0n
  const absolute = negative ? -micros : micros
  const whole = absolute / 1_000_000n
  const fraction = (absolute % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  const text = `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
  return `${formatExactText(text, settings)} s`
}

/** A duration in milliseconds, as the API reports tool-call latency. */
export function formatDuration(ms: number | null | undefined, settings: Settings): FormattedDuration {
  if (ms == null) return unavailableDuration('no duration recorded')
  if (!Number.isFinite(ms)) return unavailableDuration('the duration is not a number')
  if (ms < 0) return unavailableDuration('the duration is negative')
  // Integer milliseconds become microseconds on the bigint side: 123456789012345
  // multiplied as a float loses its last digits before it can be converted.
  const whole = Math.trunc(ms)
  const micros = BigInt(whole) * 1000n + BigInt(Math.round((ms - whole) * 1000))
  return { text: durationText(micros, settings), exact: exactSeconds(micros, settings), unavailable: false }
}

/**
 * The interval between two API timestamps, at microsecond precision.
 *
 * `Date.parse` is millisecond-resolution, so a pair a microsecond apart
 * subtracts to exactly zero and a reversed interval would print as a real 0 s.
 * Inverted source timestamps are known to exist, so a reversed interval is a
 * designed Unavailable with its reason, never a negative span.
 */
export function formatSpan(
  start: string | null | undefined,
  end: string | null | undefined,
  settings: Settings,
): FormattedDuration {
  if (start == null) return unavailableDuration('no start timestamp')
  if (end == null) return unavailableDuration('no end timestamp')
  const from = parseInstant(start)
  if (from === undefined) return unavailableDuration('unreadable start timestamp')
  const to = parseInstant(end)
  if (to === undefined) return unavailableDuration('unreadable end timestamp')
  if (to < from) return unavailableDuration('the end precedes the start')
  const micros = to - from
  return { text: durationText(micros, settings), exact: exactSeconds(micros, settings), unavailable: false }
}
