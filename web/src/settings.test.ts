import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULTS, STORAGE_KEY, canonicalLocale, canonicalZone, invalidateSettings, localeOptions, readDiagnostics,
  readSettings, resetSettings, resolveLocale, resolveTimeZone, setSettings, subscribe, timeZoneOptions, viewerZone,
} from './settings'
import { setTheme } from './theme'

const seed = (value: unknown) => localStorage.setItem(STORAGE_KEY, typeof value === 'string' ? value : JSON.stringify(value))

/** A clean module: no in-memory choice, no cached snapshot, no stored value. */
function reset() {
  resetSettings() // clears the in-memory choice and the "could not persist" flag
  localStorage.clear()
  invalidateSettings()
}

beforeEach(reset)
afterEach(() => {
  reset()
  setTheme('system')
  // One test re-imports the module to stand in for a page load; leave the
  // registry in a defined state so nothing after it inherits a half-reset one.
  vi.resetModules()
})

describe('defaults and persistence', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(readSettings()).toEqual(DEFAULTS)
  })

  it('persists a patch and notifies subscribers', () => {
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)
    setSettings({ dateFormat: 'dmy' })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({ dateFormat: 'dmy' })
    unsubscribe()
  })

  it('survives a reload: a freshly initialised module reads the stored choice', async () => {
    setSettings({ dateFormat: 'mdy', numberLocale: 'de-DE' })
    vi.resetModules() // a new module registry is the honest stand-in for a page load
    const fresh = await import('./settings')
    expect(fresh.readSettings()).toMatchObject({ dateFormat: 'mdy', numberLocale: 'de-DE' })
  })

  it('keeps one snapshot identity until a write, so useSyncExternalStore cannot loop', () => {
    const first = readSettings()
    expect(readSettings()).toBe(first)
    setSettings({ relativeTimes: false })
    expect(readSettings()).not.toBe(first)
    expect(readSettings()).toBe(readSettings())
  })

  it('resets every choice and the theme', () => {
    setSettings({ dateFormat: 'mdy', numberLocale: 'de-DE', relativeTimes: false })
    setTheme('dark')
    resetSettings()
    expect(readSettings()).toEqual(DEFAULTS)
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})

describe('validation degrades one field, never a page', () => {
  it.each([
    ['corrupt JSON', 'not json at all'],
    ['a non-object', JSON.stringify([1, 2])],
    ['null', JSON.stringify(null)],
  ])('falls back to the defaults for %s', (_label, stored) => {
    seed(stored)
    expect(readSettings()).toEqual(DEFAULTS)
  })

  it('keeps the valid fields and defaults the unknown ones', () => {
    seed({ dateFormat: 'klingon', relativeTimes: 'yes', numberLocale: 42, timeZone: 'UTC' })
    expect(readSettings()).toEqual({ ...DEFAULTS, timeZone: 'UTC' })
  })

  it('records an unknown zone instead of swallowing it', () => {
    seed({ timeZone: 'Mars/Olympus' })
    expect(readSettings().timeZone).toBe(DEFAULTS.timeZone)
    expect(readDiagnostics().timeZone).toEqual({ stored: 'Mars/Olympus', reason: 'unknown-zone' })
  })

  it('records an unsupported locale instead of swallowing it', () => {
    seed({ numberLocale: 'not a locale' })
    expect(readSettings().numberLocale).toBe(DEFAULTS.numberLocale)
    expect(readDiagnostics().numberLocale).toEqual({ stored: 'not a locale', reason: 'unsupported-locale' })
  })

  it('reports no diagnostics for a clean store', () => {
    seed({ dateFormat: 'dmy', timeZone: 'UTC' })
    expect(readDiagnostics()).toEqual({})
  })
})

describe('storage that refuses to store', () => {
  it('keeps the choice in memory over a stale saved value, like theme.ts', () => {
    const original = Storage.prototype.setItem
    try {
      seed({ dateFormat: 'iso' }) // saved earlier; can no longer be replaced
      Storage.prototype.setItem = () => { throw new Error('quota') }
      setSettings({ dateFormat: 'mdy' })
      expect(readSettings().dateFormat).toBe('mdy')
      invalidateSettings() // consult storage again: the unpersistable choice must still win
      expect(readSettings().dateFormat).toBe('mdy')
      expect(readDiagnostics().storage).toBe('unavailable')
    } finally {
      Storage.prototype.setItem = original
    }
  })

  it('falls back to the defaults when reading throws', () => {
    const original = Storage.prototype.getItem
    try {
      Storage.prototype.getItem = () => { throw new Error('blocked') }
      expect(readSettings()).toEqual(DEFAULTS)
      expect(readDiagnostics().storage).toBe('unavailable')
    } finally {
      Storage.prototype.getItem = original
    }
  })
})

describe('canonicalisation and options', () => {
  it('canonicalises a zone alias the option list does not contain', () => {
    expect(canonicalZone('US/Eastern')).toBe('America/New_York')
    seed({ timeZone: 'US/Eastern' })
    expect(readSettings().timeZone).toBe('America/New_York')
    expect(readDiagnostics().timeZone).toBeUndefined()
  })

  it('offers viewer and UTC first and always includes the effective zone', () => {
    const options = timeZoneOptions('Pacific/Chatham')
    expect(options.slice(0, 2)).toEqual(['viewer', 'UTC'])
    expect(options).toContain('Pacific/Chatham')
    expect(new Set(options).size).toBe(options.length)
  })

  it('includes a stored zone the engine accepts but does not list', () => {
    // The engine resolves this alias, so it is a legitimate stored value.
    expect(timeZoneOptions('America/New_York')).toContain('America/New_York')
  })

  it('accepts a supported locale outside the presets and offers it', () => {
    expect(canonicalLocale('fr-CA')).toBe('fr-CA')
    seed({ numberLocale: 'fr-CA' })
    expect(readSettings().numberLocale).toBe('fr-CA')
    expect(localeOptions('fr-CA').map(option => option.id)).toContain('fr-CA')
  })

  it('rejects a locale the engine cannot format with', () => {
    expect(canonicalLocale('!!')).toBeUndefined()
  })

  it('resolves the viewer zone when nothing was chosen, and the choice otherwise', () => {
    expect(resolveTimeZone(DEFAULTS)).toBe(viewerZone())
    // Not spelled literally: this ICU canonicalises Asia/Kathmandu to Asia/Katmandu.
    expect(resolveTimeZone({ ...DEFAULTS, timeZone: 'Asia/Kathmandu' })).toBe(canonicalZone('Asia/Kathmandu'))
    expect(resolveTimeZone({ ...DEFAULTS, timeZone: 'Mars/Olympus' })).toBe(viewerZone())
    expect(resolveLocale({ ...DEFAULTS, numberLocale: 'nonsense locale' })).toBe('en-US')
  })

  it('offers exactly the names it stores, so a chosen zone stays selected', () => {
    // The engine's own list may use an older spelling than the one a person types.
    const stored = canonicalZone('Asia/Kathmandu')!
    expect(timeZoneOptions(stored)).toContain(stored)
    const options = timeZoneOptions(stored)
    expect(options.every(zone => zone === 'viewer' || canonicalZone(zone) === zone)).toBe(true)
  })

  it('falls back to viewer and UTC when the engine has no zone list', () => {
    const original = Intl.supportedValuesOf
    try {
      // @ts-expect-error deliberately removing an optional API to exercise the fallback
      delete Intl.supportedValuesOf
      expect(timeZoneOptions('Europe/Paris')).toEqual(['viewer', 'UTC', 'Europe/Paris'])
    } finally {
      Intl.supportedValuesOf = original
    }
  })
})
