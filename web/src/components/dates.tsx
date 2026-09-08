import { useCallback, useEffect, useRef, useState } from 'react'
import { formatDate, formatDuration, formatSpan } from '../format'
import { useSettings } from '../settingsContext'
import type { FormattedDate, FormattedDuration } from '../format'

/**
 * One control for every instant and every interval on screen.
 *
 * A timestamp reads the way a person expects and keeps its exact value one
 * hover or one keypress away, in the same place every time: the tooltip shows
 * it, the accessible name says it, and activating the control copies it. There
 * is no dense-table exception, because an exception would hide the exact value
 * and any "why not" reason from keyboard users.
 */

type CopyState = 'idle' | 'copied' | 'unavailable'

function useCopy(): [CopyState, (text: string) => void] {
  const [state, setState] = useState<CopyState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = useCallback((text: string) => {
    const done = (next: CopyState) => {
      setState(next)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setState('idle'), 1500)
    }
    try {
      // No clipboard in jsdom, and none in an insecure context: say so rather
      // than doing nothing, because the tooltip still carries the value.
      const writer = navigator.clipboard?.writeText(text)
      if (!writer) return done('unavailable')
      writer.then(() => done('copied'), () => done('unavailable'))
    } catch { done('unavailable') }
  }, [])
  return [state, copy]
}

const UNAVAILABLE_COPY = 'Copy is unavailable — the exact value is in this tooltip'

/** The shared button: visible text, exact value in the tooltip, the name and the clipboard. */
function ExactValue({ text, exact, name, dateTime }: { text: string; exact: string; name: string; dateTime?: string }) {
  const [state, copy] = useCopy()
  const tip = state === 'copied' ? 'Copied' : state === 'unavailable' ? UNAVAILABLE_COPY : exact
  return <button type="button" className="time has-tip" data-tip={tip} title={exact}
    aria-label={`${name}. Activate to copy`} onClick={() => copy(exact)}>
    {dateTime ? <time dateTime={dateTime}>{text}</time> : text}
    <span className="visually-hidden" aria-live="polite">
      {state === 'copied' ? 'Copied' : state === 'unavailable' ? UNAVAILABLE_COPY : ''}
    </span>
  </button>
}

/** Unavailable is a designed value: no button, because there is nothing exact to reveal. */
function Unavailable({ reason }: { reason?: string }) {
  if (!reason) return <span className="unavailable">Unavailable</span>
  // The reason is reachable by hover and by focus, so a keyboard user is told why.
  return <span className="unavailable has-tip" tabIndex={0} role="note" data-tip={reason}
    title={reason} aria-label={`Unavailable: ${reason}`}>Unavailable</span>
}

export function DateText({ value, prefer, offset }: {
  value: string | null | undefined
  prefer?: 'absolute' | 'relative'
  offset?: boolean
}) {
  const settings = useSettings()
  const formatted: FormattedDate = formatDate(value, settings, { prefer, offset })
  if (formatted.unavailable) return <Unavailable />
  return <ExactValue text={formatted.text} exact={formatted.iso} dateTime={formatted.iso}
    name={`${formatted.text}, exactly ${formatted.iso}`} />
}

const Duration = ({ formatted }: { formatted: FormattedDuration }) =>
  formatted.unavailable
    ? <Unavailable reason={formatted.reason} />
    : <ExactValue text={formatted.text} exact={formatted.exact} name={`${formatted.text}, exactly ${formatted.exact}`} />

/** An interval between two API timestamps. Only this component knows both ends, so only it can call a reversal. */
export function SpanText({ start, end }: { start: string | null | undefined; end: string | null | undefined }) {
  return <Duration formatted={formatSpan(start, end, useSettings())} />
}

/** A duration the API already measured, in milliseconds. */
export function DurationText({ ms }: { ms: number | null | undefined }) {
  return <Duration formatted={formatDuration(ms, useSettings())} />
}
