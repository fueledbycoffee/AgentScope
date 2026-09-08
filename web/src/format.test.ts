import { describe, expect, it } from 'vitest'
import { abbreviate, decimal, display, formatDate, formatDuration, formatExactText, formatSpan, num, parseInstant } from './format'
import { DEFAULTS } from './settings'
import type { Settings } from './settings'

const at = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULTS, timeZone: 'UTC', ...patch })
const INSTANT = '2026-09-08T14:05:00Z'
const NOW = Date.parse('2026-09-08T14:05:00Z')

/* ----------------------------------------------------------------- numbers */

describe('numbers follow the chosen locale', () => {
  it('groups per locale and keeps Unavailable for a missing value', () => {
    expect(num(1234567.89, at())).toBe('1,234,567.89')
    expect(num(1234567.89, at({ numberLocale: 'de-DE' }))).toBe('1.234.567,89')
    expect(num(null, at())).toBe('Unavailable')
    expect(num(undefined, at())).toBe('Unavailable')
    expect(num(Number.NaN, at())).toBe('Unavailable')
    expect(num(0, at())).toBe('0')
  })

  it('keeps display for strings and routes numbers through the locale', () => {
    expect(display('swe-chat', at())).toBe('swe-chat')
    expect(display(null, at())).toBe('Unavailable')
    expect(display(1234, at({ numberLocale: 'de-DE' }))).toBe('1.234')
  })

  it('abbreviates only above 99,999, in the chosen locale', () => {
    expect(abbreviate(99_999, at())).toBe('99,999')
    expect(abbreviate(100_000, at())).toBe('100k')
    expect(abbreviate(1_204_331, at())).toBe('1.2M')
    expect(abbreviate(1_204_331, at({ numberLocale: 'de-DE' }))).toBe('1,2M')
    // The exact companion uses the same locale, so a German abbreviation never
    // sits beside an English exact value.
    expect(num(1_204_331, at({ numberLocale: 'de-DE' }))).toBe('1.204.331')
    expect(decimal(1.25, 1, at({ numberLocale: 'de-DE' }))).toBe('1,3')
  })
})

describe('formatExactText groups authoritative text without parsing it', () => {
  it('keeps every digit above Number.MAX_SAFE_INTEGER', () => {
    const text = '9007199254740993' // 2^53 + 1: Number() would return ...992
    expect(formatExactText(text, at())).toBe('9,007,199,254,740,993')
    expect(formatExactText(text, at({ numberLocale: 'de-DE' }))).toBe('9.007.199.254.740.993')
    expect(Number(text).toString()).not.toBe(text) // the reason this function exists
  })

  it('formats fractions, signs and short values', () => {
    expect(formatExactText('1234567.891', at())).toBe('1,234,567.891')
    expect(formatExactText('1234567.891', at({ numberLocale: 'de-DE' }))).toBe('1.234.567,891')
    expect(formatExactText('-1234.5', at())).toBe('-1,234.5')
    expect(formatExactText('42', at())).toBe('42')
    expect(formatExactText('0.5', at())).toBe('0.5')
  })

  it.each(['en-US', 'es-ES', 'fr-FR', 'de-DE', 'ja-JP'])('groups exactly as num() does in %s', locale => {
    const settings = at({ numberLocale: locale })
    // Spanish groups only from five digits, so an inferred "every three" rule
    // makes an exact value disagree with the ordinary one beside it.
    expect(formatExactText('1234.5', settings)).toBe(num(1234.5, settings))
    expect(formatExactText('1234567.5', settings)).toBe(num(1234567.5, settings))
    expect(formatExactText('12345', settings)).toBe(num(12345, settings))
    expect(formatExactText('999', settings)).toBe(num(999, settings))
    expect(formatExactText('-1234.5', settings)).toBe(num(-1234.5, settings))
  })

  it('returns anything that is not a plain decimal unchanged, and null as Unavailable', () => {
    expect(formatExactText('1e21', at())).toBe('1e21')
    expect(formatExactText('Unavailable', at())).toBe('Unavailable')
    expect(formatExactText(null, at())).toBe('Unavailable')
  })
})

/* ---------------------------------------------------------------- instants */

describe('the accepted timestamp grammar is the API\'s and nothing else', () => {
  it('accepts the shapes the API emits', () => {
    expect(parseInstant('2026-09-08T14:05:00Z')).toBeDefined()
    expect(parseInstant('2026-09-08T14:05:00.123456Z')).toBeDefined()
    expect(parseInstant('2026-09-08T14:05:00.1Z')).toBeDefined()
    expect(parseInstant('2026-09-08T16:05:00+02:00')).toBe(parseInstant('2026-09-08T14:05:00Z'))
    expect(parseInstant('2028-02-29T00:00:00Z')).toBeDefined() // a real leap day
  })

  it.each([
    ['an impossible calendar date Date.parse would shift', '2026-02-30T12:00:00Z'],
    ['a non-leap 29 February', '2026-02-29T12:00:00Z'],
    ['a bare zero Date.parse accepts', '0'],
    ['an offset-free instant read in the machine zone', '2026-09-08T14:05:00'],
    ['surrounding whitespace', ' 2026-09-08T14:05:00Z'],
    ['seven fraction digits the API cannot emit', '2026-09-08T14:05:00.1234567Z'],
    ['a bare date', '2026-09-08'],
    ['prose', 'not a date'],
    ['an empty string', ''],
  ])('rejects %s', (_label, value) => {
    expect(parseInstant(value)).toBeUndefined()
    const formatted = formatDate(value, at())
    expect(formatted.unavailable).toBe(true)
    expect(formatted.text).toBe('Unavailable')
    expect(formatted.absolute).toBe('Unavailable')
    expect(formatted.relative).toBeNull()
    expect(formatted.iso).toBe('')
  })

  it.each([[null], [undefined], [42], [{}]])('rejects %s without throwing', value => {
    expect(() => formatDate(value as never, at())).not.toThrow()
    expect(formatDate(value as never, at()).unavailable).toBe(true)
  })

  it.each([
    ['an out-of-range offset', '2026-09-08T14:05:00+99:99'],
    ['a 24-hour offset', '2026-09-08T14:05:00+24:00'],
    ['out-of-range offset minutes', '2026-09-08T14:05:00+02:60'],
    ['a negative out-of-range offset', '2026-09-08T14:05:00-24:00'],
  ])('refuses %s rather than inferring an instant', (_label, value) => {
    expect(parseInstant(value)).toBeUndefined()
    expect(formatDate(value, at()).unavailable).toBe(true)
  })

  it('accepts the extremes RFC 3339 allows', () => {
    expect(parseInstant('2026-09-08T14:05:00+23:59')).toBeDefined()
    expect(parseInstant('2026-09-08T14:05:00-23:59')).toBeDefined()
    expect(parseInstant('2026-09-08T14:05:00+05:45')).toBe(parseInstant('2026-09-08T08:20:00Z'))
  })

  it('accepts the early years the backend can serialise', () => {
    // Date.UTC maps years 0-99 to 1900-1999, which would reject a valid instant
    // and take its exact value away with it.
    for (const value of ['0001-01-01T00:00:00Z', '0099-12-31T23:59:59Z', '0100-01-01T00:00:00Z']) {
      expect(parseInstant(value), value).toBeDefined()
      const formatted = formatDate(value, at())
      expect(formatted.unavailable, value).toBe(false)
      expect(formatted.iso).toBe(value)
    }
    expect(formatDate('0001-01-01T00:00:00Z', at()).absolute).toBe('0001-01-01 00:00')
    expect(formatDate('0099-12-31T23:59:59Z', at()).absolute).toBe('0099-12-31 23:59')
    expect(formatDate('0100-01-01T00:00:00Z', at()).absolute).toBe('0100-01-01 00:00')
  })

  it('keeps an instant before the epoch inside its own millisecond', () => {
    // BigInt division truncates toward zero, which would round a negative
    // instant up into the next day.
    expect(formatDate('1969-12-31T23:59:59.999999Z', at()).absolute).toBe('1969-12-31 23:59')
    expect(formatDate('1969-12-31T23:59:59.999999Z', at({ dateFormat: 'dmy' })).absolute).toBe('31 Dec 1969 23:59')
    expect(formatDate('1970-01-01T00:00:00.000001Z', at()).absolute).toBe('1970-01-01 00:00')
    expect(formatDate('1969-07-20T20:17:40.500000Z', at()).absolute).toBe('1969-07-20 20:17')
  })

  it('proves the reason for the seven-digit rule: microseconds are the arithmetic', () => {
    const a = parseInstant('2026-09-08T14:05:00.123456Z')!
    const b = parseInstant('2026-09-08T14:05:00.123455Z')!
    expect(a - b).toBe(1n) // one microsecond, which Date.parse would render as 0 ms
  })
})

/* ------------------------------------------------------------------- dates */

describe('absolute rendering', () => {
  it('renders each format from one instant', () => {
    expect(formatDate(INSTANT, at({ dateFormat: 'iso' })).absolute).toBe('2026-09-08 14:05')
    expect(formatDate(INSTANT, at({ dateFormat: 'dmy' })).absolute).toBe('08 Sep 2026 14:05')
    expect(formatDate(INSTANT, at({ dateFormat: 'mdy' })).absolute).toBe('09/08/2026 2:05 PM')
  })

  it('renders midnight and noon unambiguously', () => {
    expect(formatDate('2026-09-08T00:00:00Z', at({ dateFormat: 'iso' })).absolute).toBe('2026-09-08 00:00')
    expect(formatDate('2026-09-08T00:00:00Z', at({ dateFormat: 'mdy' })).absolute).toBe('09/08/2026 12:00 AM')
    expect(formatDate('2026-09-08T12:00:00Z', at({ dateFormat: 'mdy' })).absolute).toBe('09/08/2026 12:00 PM')
  })

  it('renders the same instant in three zones', () => {
    expect(formatDate(INSTANT, at({ timeZone: 'UTC' })).absolute).toBe('2026-09-08 14:05')
    expect(formatDate(INSTANT, at({ timeZone: 'Europe/Paris' })).absolute).toBe('2026-09-08 16:05')
    expect(formatDate(INSTANT, at({ timeZone: 'Asia/Katmandu' })).absolute).toBe('2026-09-08 19:50')
  })

  it('keeps the API string verbatim, microseconds included', () => {
    const value = '2026-09-08T14:05:00.123456Z'
    expect(formatDate(value, at()).iso).toBe(value)
  })

  it('does not throw on a settings object the validator would have rejected', () => {
    const broken = { ...DEFAULTS, timeZone: 'Mars/Olympus', numberLocale: '!!' } as Settings
    expect(() => formatDate(INSTANT, broken)).not.toThrow()
    expect(formatDate(INSTANT, broken).unavailable).toBe(false)
  })
})

describe('offsets are computed at the instant', () => {
  it('normalises the bare GMT the engine returns at zero offset', () => {
    expect(formatDate(INSTANT, at({ timeZone: 'UTC' }), { offset: true }).absolute).toBe('2026-09-08 14:05 (UTC+00:00)')
  })

  it('renders a fractional-hour offset', () => {
    expect(formatDate(INSTANT, at({ timeZone: 'Asia/Katmandu' }), { offset: true }).absolute)
      .toBe('2026-09-08 19:50 (UTC+05:45)')
  })

  it('distinguishes the two Paris fall-back instants that both read 02:30', () => {
    const settings = at({ timeZone: 'Europe/Paris' })
    const before = formatDate('2026-10-25T00:30:00Z', settings, { offset: true }).absolute
    const after = formatDate('2026-10-25T01:30:00Z', settings, { offset: true }).absolute
    expect(before).toBe('2026-10-25 02:30 (UTC+02:00)')
    expect(after).toBe('2026-10-25 02:30 (UTC+01:00)')
    expect(before).not.toBe(after)
  })

  it('renders the spring-forward jump', () => {
    const settings = at({ timeZone: 'Europe/Paris' })
    expect(formatDate('2026-03-29T00:30:00Z', settings, { offset: true }).absolute).toBe('2026-03-29 01:30 (UTC+01:00)')
    expect(formatDate('2026-03-29T01:30:00Z', settings, { offset: true }).absolute).toBe('2026-03-29 03:30 (UTC+02:00)')
  })
})

describe('relative rendering', () => {
  const ago = (ms: number, settings = at()) =>
    formatDate(new Date(NOW - ms).toISOString().replace(/(\.\d{3})\d*Z$/, '$1Z'), settings, { prefer: 'relative', now: NOW })

  it('walks the bands below, at and above each boundary', () => {
    expect(ago(30_000).relative).toBe('just now')
    expect(ago(44_000).relative).toBe('just now')
    // The promotion rule applies at this boundary too: 44.6 s rounds to 45 s,
    // which reaches the next band, so it is a minute rather than "just now".
    expect(ago(44_400).relative).toBe('just now')
    expect(ago(44_600).relative).toBe('1 min ago')
    expect(ago(45_000).relative).toBe('1 min ago') // never "0 min ago"
    expect(ago(2 * 60_000).relative).toBe('2 min ago')
    expect(ago(89 * 60_000).relative).toBe('89 min ago')
    expect(ago(90 * 60_000).relative).toBe('2 h ago') // never "90 min ago"
    expect(ago(3 * 3_600_000).relative).toBe('3 h ago')
    expect(ago(35 * 3_600_000).relative).toBe('35 h ago')
    expect(ago(36 * 3_600_000).relative).toBe('2 d ago')
    expect(ago(6 * 86_400_000).relative).toBe('6 d ago')
  })

  it('promotes rather than printing a count that reaches the next band', () => {
    expect(ago(89.9 * 60_000).relative).not.toBe('90 min ago')
    expect(ago(89.9 * 60_000).relative).toBe('1 h ago')
  })

  it('falls back to the absolute rendering at seven days', () => {
    expect(ago(7 * 86_400_000).relative).toBeNull()
    expect(ago(7 * 86_400_000).text).toBe(ago(7 * 86_400_000).absolute)
    expect(ago(8 * 86_400_000).relative).toBeNull()
  })

  it('renders a future instant as future rather than clamping it', () => {
    expect(ago(-3 * 3_600_000).relative).toBe('in 3 h')
    expect(ago(-2 * 60_000).relative).toBe('in 2 min')
    expect(ago(-30_000).relative).toBe('just now')
    expect(ago(-44_400).relative).toBe('just now')
    expect(ago(-44_600).relative).toBe('in 1 min') // the same boundary, ahead of now
  })

  it('gives no relative rendering when the viewer turned them off', () => {
    const off = ago(3 * 3_600_000, at({ relativeTimes: false }))
    expect(off.relative).toBeNull()
    expect(off.text).toBe(off.absolute)
  })

  it('gives the absolute rendering when the reference time is not a number', () => {
    const formatted = formatDate(INSTANT, at(), { prefer: 'relative', now: Number.NaN })
    expect(formatted.relative).toBeNull()
    expect(formatted.text).toBe(formatted.absolute)
  })

  it('prefers absolute by default', () => {
    expect(formatDate(INSTANT, at(), { now: NOW }).text).toBe('2026-09-08 14:05')
  })
})

/* --------------------------------------------------------------- durations */

describe('durations read as a person expects, with the exact value beside them', () => {
  it.each([
    [340, '340 ms'],
    [4_800, '4.8 s'],
    [48_000, '48 s'],
    [750_000, '12 min 30 s'],
    [720_000, '12 min'],
    [4_320_000, '1 h 12 min'],
    [3_600_000, '1 h'],
    [1_306_800_000, '15 d 3 h'],
    [86_400_000, '1 d'],
  ])('formats %i ms as %s', (ms, text) => {
    expect(formatDuration(ms, at()).text).toBe(text)
  })

  it('carries a rounded smaller unit into the larger one', () => {
    expect(formatDuration(59_600, at()).text).toBe('1 min') // not "0 min 60 s"
    expect(formatDuration(3_599_600, at()).text).toBe('1 h') // not "59 min 60 s"
    expect(formatDuration(86_399_600, at()).text).toBe('1 d') // not "23 h 60 min"
  })

  it('keeps a large latency exact, without rounding through a float', () => {
    // 123456789012345 * 1000 exceeds Number.MAX_SAFE_INTEGER.
    expect(formatDuration(123_456_789_012_345, at()).exact).toBe('123,456,789,012.345 s')
  })

  it('prints the exact seconds in the chosen locale', () => {
    expect(formatDuration(1_309_340_848, at()).exact).toBe('1,309,340.848 s')
    expect(formatDuration(1_309_340_848, at({ numberLocale: 'de-DE' })).exact).toBe('1.309.340,848 s')
  })

  it.each([
    [null, 'no duration recorded'],
    [undefined, 'no duration recorded'],
    [Number.NaN, 'the duration is not a number'],
    [Number.POSITIVE_INFINITY, 'the duration is not a number'],
    [Number.NEGATIVE_INFINITY, 'the duration is not a number'],
    [-1, 'the duration is negative'],
  ])('refuses %s with a reason', (ms, reason) => {
    const formatted = formatDuration(ms as number, at())
    expect(formatted.unavailable).toBe(true)
    expect(formatted.text).toBe('Unavailable')
    expect(formatted.reason).toBe(reason)
  })
})

describe('spans are compared at the precision the API supplies', () => {
  it('formats an ordinary interval', () => {
    expect(formatSpan('2026-09-08T14:05:00Z', '2026-09-08T15:17:00Z', at()).text).toBe('1 h 12 min')
  })

  it('calls two equal instants a real zero, not "0 ms"', () => {
    const span = formatSpan(INSTANT, INSTANT, at())
    expect(span.unavailable).toBe(false)
    expect(span.text).toBe('0 s')
    expect(span.exact).toBe('0 s')
  })

  it('keeps a sub-millisecond span exact', () => {
    const span = formatSpan('2026-09-08T14:05:00.123455Z', '2026-09-08T14:05:00.123456Z', at())
    expect(span.unavailable).toBe(false)
    expect(span.exact).toBe('0.000001 s')
  })

  it('refuses a sub-millisecond reversal that Date.parse would hide as a real zero', () => {
    const start = '2026-09-08T14:05:00.123456Z'
    const end = '2026-09-08T14:05:00.123455Z'
    expect(Date.parse(end) - Date.parse(start)).toBe(0) // the bug this guards against
    const span = formatSpan(start, end, at())
    expect(span.unavailable).toBe(true)
    expect(span.reason).toBe('the end precedes the start')
    expect(span.text).toBe('Unavailable')
  })

  it.each([
    [null, INSTANT, 'no start timestamp'],
    [INSTANT, null, 'no end timestamp'],
    ['not a date', INSTANT, 'unreadable start timestamp'],
    [INSTANT, 'not a date', 'unreadable end timestamp'],
    ['2026-09-08T15:00:00Z', '2026-09-08T14:00:00Z', 'the end precedes the start'],
  ])('refuses (%s, %s) with its own reason', (start, end, reason) => {
    const span = formatSpan(start, end, at())
    expect(span.unavailable).toBe(true)
    expect(span.reason).toBe(reason)
  })

  it('never fabricates a now for a missing endpoint', () => {
    expect(formatSpan('2026-09-08T14:05:00Z', null, at()).text).toBe('Unavailable')
  })
})
