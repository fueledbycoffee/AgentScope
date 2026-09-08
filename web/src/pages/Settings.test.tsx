import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { SettingsProvider } from '../settingsContext'
import { DEFAULTS, STORAGE_KEY, invalidateSettings, resetSettings, setSettings } from '../settings'
import { setTheme } from '../theme'
import { metrics, session } from '../test/fixtures'

/**
 * The settings page and, more importantly, the claim it exists to support:
 * a change reaches a page that is already on screen, with no reload, no
 * navigation and no remount — including a page whose numbers are rendered by
 * a component that holds no subscription of its own.
 */

const fetchMock = vi.fn<typeof fetch>()
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

// Values large enough for grouping to be visible: 1 and 2 look the same in every locale.
const bigMetrics = { ...metrics, sessions: { ...metrics.sessions, value: 4770 } }

function respond(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input), 'http://localhost')
  if (url.pathname === '/api/metrics/summary') return Promise.resolve(json(bigMetrics))
  if (url.pathname === '/api/sessions') return Promise.resolve(json([session]))
  return Promise.resolve(json([]))
}

const start = (route = '/settings') =>
  render(<SettingsProvider><MemoryRouter initialEntries={[route]}><App /></MemoryRouter></SettingsProvider>)

/** The page's own theme control; the rail carries an identically named shortcut. */
const themePanel = () => within(screen.getByRole('region', { name: 'Theme' }))
/** A fixed zone, so a sample describes the format rather than the machine's zone. */
const inUtc = () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULTS, timeZone: 'UTC' }))
  invalidateSettings()
}

function clean() {
  resetSettings()
  localStorage.clear()
  invalidateSettings()
}

beforeEach(() => {
  clean()
  fetchMock.mockImplementation(respond)
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  clean()
  setTheme('system')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

describe('the settings page', () => {
  it('is reachable from the rail by a named, tooltipped icon', () => {
    start('/settings')
    const link = screen.getByRole('link', { name: 'Settings' })
    expect(link).toHaveAttribute('href', '/settings')
    expect(link).toHaveAttribute('data-tip', 'Settings')
  })

  it('gives every control a label', () => {
    start()
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /ISO 8601/ })).toBeChecked()
    expect(screen.getByLabelText('Time zone')).toBeInTheDocument()
    expect(screen.getByLabelText('Number locale')).toBeInTheDocument()
    expect(screen.getByLabelText('Relative times')).toBeChecked()
    expect(themePanel().getByRole('group', { name: 'Theme' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeInTheDocument()
  })

  it('says it never leaves the browser', () => {
    start()
    expect(screen.getByText('stored in this browser only, never on the server')).toBeInTheDocument()
  })

  it('changes its own samples in place: no navigation, no remount', () => {
    inUtc()
    start()
    const panel = screen.getByRole('region', { name: 'Dates and times' })
    expect(within(panel).getByText('2026-09-08 14:05')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /US/ }))
    // The same DOM node now shows the new rendering: the page was not replaced.
    expect(screen.getByRole('region', { name: 'Dates and times' })).toBe(panel)
    expect(within(panel).getByText('09/08/2026 2:05 PM')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /US/ })).toBeChecked()
  })

  it('writes the choice to this browser', () => {
    inUtc()
    start()
    fireEvent.click(screen.getByRole('radio', { name: /Day month year/ }))
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({ dateFormat: 'dmy' })
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'UTC' } })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({ timeZone: 'UTC' })
    fireEvent.click(screen.getByLabelText('Relative times'))
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({ relativeTimes: false })
  })

  it('applies a choice stored before it mounted', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULTS, dateFormat: 'dmy', timeZone: 'UTC' }))
    invalidateSettings()
    start()
    expect(screen.getByRole('radio', { name: /Day month year/ })).toBeChecked()
    expect(screen.getByText('08 Sep 2026 14:05')).toBeInTheDocument()
  })

  it('regroups its number samples with the locale, exact text included', () => {
    start()
    const panel = screen.getByRole('region', { name: 'Numbers' })
    expect(within(panel).getByText('1,234,567.89')).toBeInTheDocument()
    expect(within(panel).getByText('9,007,199,254,740,993')).toBeInTheDocument() // above MAX_SAFE_INTEGER
    fireEvent.change(screen.getByLabelText('Number locale'), { target: { value: 'de-DE' } })
    expect(within(panel).getByText('1.234.567,89')).toBeInTheDocument()
    expect(within(panel).getByText('9.007.199.254.740.993')).toBeInTheDocument()
  })

  it('warns about a stored zone this browser does not know, and keeps working', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ timeZone: 'Mars/Olympus' }))
    invalidateSettings()
    start()
    expect(screen.getByText(/The saved time zone Mars\/Olympus is not one this browser knows/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /ISO 8601/ })).toBeChecked()
  })

  it('takes the warning down as soon as the zone is corrected, without a reload', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ timeZone: 'Mars/Olympus' }))
    invalidateSettings()
    start()
    expect(screen.getByText(/The saved time zone Mars\/Olympus is not one this browser knows/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'Europe/Paris' } })
    expect(screen.queryByText(/is not one this browser knows/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Time zone')).toHaveValue('Europe/Paris')
  })

  it('resets every displayed choice, the theme included', () => {
    start()
    fireEvent.click(screen.getByRole('radio', { name: /US/ }))
    fireEvent.click(themePanel().getByRole('button', { name: 'Dark theme' }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))
    expect(screen.getByRole('radio', { name: /ISO 8601/ })).toBeChecked()
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(screen.getByRole('status')).toHaveTextContent('reset to its default')
  })

  it('keeps the rail toggle as a shortcut to the same choice', () => {
    start()
    const groups = screen.getAllByRole('group', { name: 'Theme' })
    expect(groups.length).toBeGreaterThan(1) // the rail's and the page's
    fireEvent.click(within(groups[0]).getByRole('button', { name: 'Dark theme' }))
    for (const group of groups) expect(within(group).getByRole('button', { name: 'Dark theme' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('a change reaches a page that is already on screen', () => {
  it('regroups a number rendered by a component with no subscription of its own', async () => {
    start('/sessions')
    // The Sessions head renders its count through format.ts, not through a hook:
    // it can only update because App consumes the settings and recreates the tree.
    expect(await screen.findByText('4,770 in scope')).toBeInTheDocument()
    const main = document.getElementById('main')!
    const heading = screen.getByRole('heading', { level: 1, name: 'Sessions' })

    act(() => setSettings({ numberLocale: 'de-DE' }))

    expect(screen.getByText('4.770 in scope')).toBeInTheDocument()
    // Same nodes: the page re-rendered, it was not remounted, so nothing on it was lost.
    expect(document.getElementById('main')).toBe(main)
    expect(screen.getByRole('heading', { level: 1, name: 'Sessions' })).toBe(heading)
  })
})
