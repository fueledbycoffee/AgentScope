import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { SCOPE_KEYS } from '../../scope'
import type { ScopeKey } from '../../scope'
import { Icon } from '../icons'
import { useTip } from '../tip'
import { scopeLabel, useScopeUrl } from './scopeUrl'

/**
 * Tables act as filters: a source or an agent cell is an anchor into the same
 * URL scope the bar writes, and the chips above the table say what the rows
 * are narrowed by, with one click back. There is one filtering mechanism —
 * the URL — so a chart drill in #11 produces these chips without a second
 * component and without any state of its own.
 */

export function ScopeCell({ dimension, value, target }: {
  dimension: ScopeKey | string
  value: string | null | undefined
  target?: string
}) {
  const { valueOf, scopeHref } = useScopeUrl()
  const key = dimension as ScopeKey
  const label = scopeLabel(key)
  const active = value != null && valueOf(key) === value
  // The active-value name wins over the target-route name: a matching source in
  // the ledger announces clearing, not "show sessions from".
  const name = value == null ? '' : active
    ? `Clear the ${label.toLowerCase()} filter ${value}`
    : target
      ? `Show sessions from ${label.toLowerCase()} ${value}`
      : `Filter by ${label.toLowerCase()} ${value}`
  // Rendered outside the table's scroll container, which clips vertically.
  const { hostProps, tip } = useTip(name)
  // An unknown value cannot be filtered on, and a dimension the API does not
  // accept yet must not pretend to: `model` becomes a link the moment #11 adds
  // the key, and stays plain text until then, with no edit here.
  if (value == null || value === '') return <span className="unavailable">Unavailable</span>
  if (!(SCOPE_KEYS as readonly string[]).includes(dimension)) return <>{value}</>

  return <>
    <Link className={`scope-cell${active ? ' active' : ''}`} to={scopeHref(key, value, target)}
      aria-current={active ? 'true' : undefined} aria-label={name} {...hostProps}>{value}</Link>
    {tip}
  </>
}

/**
 * The chips above a table. They appear only when something is active, so the
 * default view is unchanged; removing the last one leaves a live region that
 * takes focus and says so, rather than dropping focus on the body.
 */
export function ScopeChips({ keys = SCOPE_KEYS, label = 'Active filters' }: {
  keys?: readonly ScopeKey[]
  label?: string
}) {
  const { valueOf, remove, clearAll } = useScopeUrl()
  const group = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLParagraphElement>(null)
  const [cleared, setCleared] = useState(false)
  const [pending, setPending] = useState<{ index: number; from: number }>()
  const active = keys.filter(key => valueOf(key))

  /**
   * Move focus once the removal has actually landed — waiting for the chip
   * count to fall, not for the next frame, which can run before the URL change
   * has been committed. Then: the next chip's remove control, else Clear all,
   * else the sentinel. Focus is never left on the body.
   */
  useLayoutEffect(() => {
    if (!pending || active.length >= pending.from) return
    const buttons = group.current?.querySelectorAll<HTMLButtonElement>('button')
    const next = buttons?.length ? buttons[Math.min(pending.index, buttons.length - 1)] : undefined
    ;(next ?? sentinel.current)?.focus()
    setPending(undefined)
  }, [pending, active.length])

  const moveFocus = (index: number, last: boolean) => {
    if (last) setCleared(true)
    setPending({ index, from: active.length })
  }

  if (active.length === 0 && !cleared) return null
  return <>
    {active.length > 0 && <div className="chips" role="group" aria-label={label} ref={group}>
      {active.map((key, index) => {
        const value = valueOf(key)
        const name = `Remove ${scopeLabel(key)} ${value}`
        return <span key={key} className="chip">{scopeLabel(key)} {value}
          <button type="button" className="has-tip" aria-label={name} data-tip={name} title={name}
            onClick={() => { setCleared(false); remove(key); moveFocus(index, active.length === 1) }}>
            <Icon name="x" size={12} />
          </button>
        </span>
      })}
      {active.length > 1 && <button type="button" className="btn quiet small"
        onClick={() => { clearAll(); moveFocus(0, true) }}>Clear all</button>}
    </div>}
    <p ref={sentinel} tabIndex={-1} role="status" aria-live="polite" className="visually-hidden">
      {active.length === 0 ? 'Filters cleared' : ''}
    </p>
  </>
}
