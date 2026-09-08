import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DurationText } from './dates'

/**
 * `.table-wrap` sets `overflow-x: auto`, which clips vertically too, so a
 * bubble positioned inside the control is cut off on the last row — taking the
 * only keyboard-visible copy of an exact value, or of the reason a value is
 * unavailable, with it. The bubble therefore lives in the body.
 */

function inTable(node: React.ReactNode) {
  return render(
    <div className="table-wrap" data-testid="wrap">
      <table className="data"><tbody><tr><td>{node}</td></tr></tbody></table>
    </div>,
  )
}

/** jsdom has no layout, so the control's box is supplied. */
function withRect(rect: Partial<DOMRect>) {
  const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect')
  spy.mockReturnValue({ top: 0, bottom: 0, left: 0, right: 0, width: 60, height: 20, x: 0, y: 0, toJSON: () => ({}), ...rect } as DOMRect)
  return spy
}

afterEach(() => { vi.restoreAllMocks() })

describe('a tooltip escapes the table that would clip it', () => {
  it('renders the bubble in the body, not inside the scrolling container', () => {
    withRect({ top: 100, bottom: 120 })
    inTable(<DurationText ms={null} />)
    const note = screen.getByRole('note')
    fireEvent.focus(note)

    const tip = screen.getByRole('tooltip')
    expect(tip).toHaveTextContent('no duration recorded')
    expect(screen.getByTestId('wrap').contains(tip)).toBe(false)
    expect(tip.parentElement).toBe(document.body)
    expect(note).toHaveAttribute('aria-describedby', tip.id)
  })

  it('sits below the control when there is room', () => {
    withRect({ top: 100, bottom: 120, left: 40, width: 60 })
    inTable(<DurationText ms={null} />)
    fireEvent.focus(screen.getByRole('note'))
    const tip = screen.getByRole('tooltip')
    expect(tip.className).not.toContain('flipped')
    expect(tip.style.top).toBe('126px') // just under the control
  })

  it('flips above the control when the viewport bottom is close', () => {
    // A last-row control: 10 px of space below it.
    withRect({ top: window.innerHeight - 30, bottom: window.innerHeight - 10 })
    inTable(<DurationText ms={null} />)
    fireEvent.focus(screen.getByRole('note'))
    const tip = screen.getByRole('tooltip')
    expect(tip.className).toContain('flipped')
    expect(Number.parseFloat(tip.style.top)).toBeLessThan(window.innerHeight - 10)
  })

  it('appears on hover and on keyboard focus, and goes away again', () => {
    withRect({ top: 100, bottom: 120 })
    inTable(<DurationText ms={null} />)
    const note = screen.getByRole('note')
    fireEvent.mouseEnter(note)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.mouseLeave(note)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    fireEvent.focus(note)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.blur(note)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('goes away when the table scrolls out from under it', () => {
    withRect({ top: 100, bottom: 120 })
    inTable(<DurationText ms={null} />)
    fireEvent.focus(screen.getByRole('note'))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.scroll(screen.getByTestId('wrap'))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
