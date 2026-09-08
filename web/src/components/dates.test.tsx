import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DateText, DurationText, SpanText } from './dates'
import { DEFAULTS, STORAGE_KEY, invalidateSettings, resetSettings } from '../settings'

const INSTANT = '2026-09-08T14:05:00.123456Z'

function inUtc(patch: Record<string, unknown> = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULTS, timeZone: 'UTC', ...patch }))
  invalidateSettings()
}

beforeEach(() => { resetSettings(); localStorage.clear(); invalidateSettings() })
afterEach(() => { resetSettings(); localStorage.clear(); invalidateSettings(); vi.restoreAllMocks() })

/** jsdom has no clipboard; the component must say so rather than doing nothing. */
function withClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
}

describe('DateText', () => {
  it('shows the reading, keeps the exact value in the tooltip, the title and the name', () => {
    inUtc()
    render(<DateText value={INSTANT} />)
    const button = screen.getByRole('button')
    expect(button).toHaveTextContent('2026-09-08 14:05')
    expect(button).toHaveAttribute('title', INSTANT)
    expect(button).toHaveAttribute('data-tip', INSTANT)
    expect(button).toHaveAccessibleName(`2026-09-08 14:05, exactly ${INSTANT}. Activate to copy`)
    expect(button.querySelector('time')).toHaveAttribute('datetime', INSTANT)
  })

  it('reads relatively where the column is "when"', () => {
    inUtc()
    const justNow = new Date(Date.now() - 3 * 3_600_000).toISOString().replace(/\.\d+Z$/, 'Z')
    render(<DateText value={justNow} prefer="relative" />)
    expect(screen.getByRole('button')).toHaveTextContent('3 h ago')
    expect(screen.getByRole('button')).toHaveAttribute('title', justNow) // still exact on hover
  })

  it('carries the offset when asked, so two instants that read alike stay distinct', () => {
    inUtc({ timeZone: 'Europe/Paris' })
    const { rerender } = render(<DateText value="2026-10-25T00:30:00Z" offset />)
    expect(screen.getByRole('button')).toHaveTextContent('2026-10-25 02:30 (UTC+02:00)')
    rerender(<DateText value="2026-10-25T01:30:00Z" offset />)
    expect(screen.getByRole('button')).toHaveTextContent('2026-10-25 02:30 (UTC+01:00)')
  })

  it('follows the chosen format without a reload', () => {
    inUtc({ dateFormat: 'dmy' })
    render(<DateText value={INSTANT} />)
    expect(screen.getByRole('button')).toHaveTextContent('08 Sep 2026 14:05')
  })

  it('renders Unavailable with no control when there is nothing exact to reveal', () => {
    render(<><DateText value={null} /><DateText value="not a date" /></>)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getAllByText('Unavailable')).toHaveLength(2)
  })

  it('copies the exact value and announces it', async () => {
    inUtc()
    const writeText = vi.fn().mockResolvedValue(undefined)
    withClipboard(writeText)
    render(<DateText value={INSTANT} />)
    fireEvent.click(screen.getByRole('button'))
    expect(writeText).toHaveBeenCalledWith(INSTANT)
    await waitFor(() => expect(screen.getByRole('button')).toHaveAttribute('data-tip', 'Copied'))
    expect(screen.getByRole('button')).toHaveTextContent('Copied')
  })

  it('says so when the clipboard refuses, instead of failing silently', async () => {
    inUtc()
    withClipboard(vi.fn().mockRejectedValue(new Error('denied')))
    render(<DateText value={INSTANT} />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByRole('button')).toHaveAttribute('data-tip', expect.stringContaining('Copy is unavailable')))
  })

  it('does not throw when the browser has no clipboard at all', () => {
    inUtc()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    render(<DateText value={INSTANT} />)
    expect(() => fireEvent.click(screen.getByRole('button'))).not.toThrow()
    expect(screen.getByRole('button')).toHaveAttribute('data-tip', expect.stringContaining('Copy is unavailable'))
  })
})

describe('DurationText and SpanText', () => {
  it('reads a duration and keeps the exact seconds', () => {
    render(<DurationText ms={4_320_000} />)
    expect(screen.getByRole('button')).toHaveTextContent('1 h 12 min')
    expect(screen.getByRole('button')).toHaveAttribute('title', '4,320 s')
  })

  it('reads a span between two API timestamps', () => {
    render(<SpanText start="2026-09-08T14:05:00Z" end="2026-09-08T15:17:00Z" />)
    expect(screen.getByRole('button')).toHaveTextContent('1 h 12 min')
  })

  it('gives the reason for an unavailable span by hover and by keyboard focus', () => {
    render(<SpanText start="2026-09-08T15:00:00Z" end="2026-09-08T14:00:00Z" />)
    const note = screen.getByRole('note')
    expect(note).toHaveTextContent('Unavailable')
    expect(note).toHaveAttribute('data-tip', 'the end precedes the start')
    expect(note).toHaveAttribute('tabindex', '0') // reachable without a mouse
    expect(note).toHaveAccessibleName('Unavailable: the end precedes the start')
  })

  it('distinguishes a missing endpoint from an unreadable one', () => {
    const { rerender } = render(<SpanText start={null} end="2026-09-08T14:00:00Z" />)
    expect(screen.getByRole('note')).toHaveAttribute('data-tip', 'no start timestamp')
    rerender(<SpanText start="2026-09-08T14:00:00Z" end={null} />)
    expect(screen.getByRole('note')).toHaveAttribute('data-tip', 'no end timestamp')
    rerender(<SpanText start="nonsense" end="2026-09-08T14:00:00Z" />)
    expect(screen.getByRole('note')).toHaveAttribute('data-tip', 'unreadable start timestamp')
  })

  it('says why a latency is missing rather than printing a zero', () => {
    render(<DurationText ms={null} />)
    expect(screen.getByRole('note')).toHaveAttribute('data-tip', 'no duration recorded')
  })
})
