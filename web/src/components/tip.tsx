import { useCallback, useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * A tooltip that escapes its scroll container.
 *
 * The shell's `.has-tip` rule positions its bubble absolutely inside the
 * control, which is right for the rail and the bar. Inside `.table-wrap`
 * (`overflow-x: auto`, which clips vertically as well) a bubble below the last
 * row is cut off — and these controls are the keyboard-visible path to an
 * exact timestamp or to the reason a value is unavailable, so losing it loses
 * the information. The bubble is therefore rendered into `document.body` with
 * `position: fixed`, and flipped above the control when there is no room
 * below.
 */

interface Box { top: number; left: number; flipped: boolean }

const MARGIN = 6
const ESTIMATED_HEIGHT = 26

export function useTip(text: string) {
  const id = useId()
  const [box, setBox] = useState<Box>()

  const show = useCallback((event: { currentTarget: HTMLElement }) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom
    const flipped = below < ESTIMATED_HEIGHT + MARGIN && rect.top > below
    setBox({
      top: flipped ? rect.top - MARGIN : rect.bottom + MARGIN,
      left: Math.min(Math.max(rect.left + rect.width / 2, 8), Math.max(window.innerWidth - 8, 8)),
      flipped,
    })
  }, [])
  const hide = useCallback(() => setBox(undefined), [])

  // A scroll or a resize moves the control out from under the bubble.
  useEffect(() => {
    if (!box) return
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [box, hide])

  const hostProps = {
    'data-tip': text,
    'aria-describedby': box ? id : undefined,
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
  }

  const tip = box && typeof document !== 'undefined'
    ? createPortal(
      <span id={id} role="tooltip" className={`tip${box.flipped ? ' flipped' : ''}`}
        style={{ top: box.top, left: box.left }}>{text}</span>,
      document.body,
    )
    : null

  return { hostProps, tip }
}
