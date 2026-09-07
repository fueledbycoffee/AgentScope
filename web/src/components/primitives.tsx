import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError } from '../api'
import { PAGE_SIZE, abbreviate } from '../format'
import { Icon, IconButton } from './icons'
import type { IconName } from './icons'

/* ------------------------------------------------------------------ status */

export type Status = 'committed' | 'duplicate' | 'failed' | 'running' | 'pending'
const PILL_ICONS: Record<string, IconName> = { committed: 'check', accepted: 'check', duplicate: 'copy', failed: 'alert', rejected: 'alert', running: 'clock', pending: 'clock', partial: 'info', ignored: 'filter' }
export function StatusPill({ status }: { status: string }) {
  const icon = PILL_ICONS[status]
  return <span className={`pill ${status}`}>{icon && <Icon name={icon} size={11} />}{status}</span>
}

export function Notice({ kind = 'info', title, children, role }: { kind?: 'info' | 'warn' | 'bad'; title?: string; children: ReactNode; role?: 'alert' | 'status' }) {
  return <div className={`notice ${kind}`} role={role ?? (kind === 'bad' ? 'alert' : undefined)}>
    <div>{title && <p className="title">{title}</p>}{children}</div>
  </div>
}

export function Skeleton({ lines = 3, width = '100%' }: { lines?: number; width?: string }) {
  return <div aria-hidden="true" className="stack" style={{ gap: 8 }}>
    {Array.from({ length: lines }, (_, index) => <div key={index} className="skeleton" style={{ width: index === lines - 1 ? '60%' : width }} />)}
  </div>
}

/** Loading, error (with retry) or the content. Errors from the API keep their code and details. */
export function StateBlock({ loading, error, retry, lines, children }: { loading: boolean; error?: unknown; retry?: () => void; lines?: number; children?: ReactNode }) {
  if (loading) return <div className="state-block"><p role="status" className="visually-hidden">Loading…</p><Skeleton lines={lines} /></div>
  if (error) {
    const message = error instanceof Error ? error.message : 'Something went wrong. Please try again.'
    return <div className="state-block error"><Notice kind="bad" title={message}>
      {error instanceof ApiError && <><p>Code: <code>{error.code}</code></p>
        {error.details.length > 0 && <details className="disclosure"><summary>Error details</summary><pre className="json">{JSON.stringify(error.details, null, 2)}</pre></details>}</>}
      {retry && <p style={{ marginTop: 8 }}><button className="btn small" onClick={retry}><Icon name="refresh" />Retry</button></p>}
    </Notice></div>
  }
  return <>{children}</>
}

export function Pagination({ offset, count, onChange }: { offset: number; count: number; onChange: (offset: number) => void }) {
  return <nav aria-label="Pagination" className="pagination">
    <IconButton name="arrowRight" label="Previous" className="btn small icon-only flip" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - PAGE_SIZE))} />
    <span>Page {Math.floor(offset / PAGE_SIZE) + 1}</span>
    <IconButton name="arrowRight" label="Next" className="btn small icon-only" disabled={count < PAGE_SIZE} onClick={() => onChange(offset + PAGE_SIZE)} />
  </nav>
}

/* ----------------------------------------------------------------- popover */

/** Anchored disclosure: button[aria-expanded] + role=dialog, Escape and outside click close, focus returns. */
export function Popover({ label, title, children, className = 'i-btn', buttonLabel = 'i' }: { label: string; title?: string; children: ReactNode; className?: string; buttonLabel?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const host = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const id = useId()
  const close = useCallback((refocus = true) => { setOpen(false); if (refocus) button.current?.focus() }, [])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close() } }
    const onClick = (event: MouseEvent) => { if (!host.current?.contains(event.target as Node)) close(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick) }
  }, [open, close])
  const panel = useRef<HTMLDivElement>(null)
  const [flip, setFlip] = useState(false)
  useLayoutEffect(() => {
    if (!open || !panel.current) return
    const rect = panel.current.getBoundingClientRect()
    setFlip(rect.right > window.innerWidth - 8) // keep the panel inside the viewport
  }, [open])
  return <span className="popover-host" ref={host}>
    <button ref={button} type="button" className={className} aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>{buttonLabel}</button>
    {open && <div ref={panel} className={`popover${flip ? ' flip' : ''}`} role="dialog" id={id} aria-label={title ?? label}>
      {title && <h3>{title}</h3>}{children}
    </div>}
  </span>
}

/* ------------------------------------------------------------------ drawer */

/** Native <dialog> opened modally: focus trapped, Escape closes, backdrop click closes, focus returns to the opener. */
export function Drawer({ title, onClose, children, closeLabel = 'Close' }: { title: string; onClose: () => void; children: ReactNode; closeLabel?: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const element = dialog.current!
    const opener = document.activeElement as HTMLElement | null
    element.showModal()
    return () => { element.close(); opener?.focus() }
  }, [])
  return <dialog ref={dialog} className="drawer" aria-labelledby={id} onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => { if (event.target === dialog.current) onClose() }}>
    <div className="drawer-head"><h2 id={id}>{title}</h2><IconButton name="x" label={closeLabel} className="btn small icon-only" onClick={onClose} /></div>
    <div className="drawer-body">{children}</div>
  </dialog>
}

/** payload_text rendered verbatim (never re-serialised), with an optional highlighted substring. */
export function JsonText({ text, highlight }: { text: string; highlight?: string }) {
  if (!highlight || !text.includes(highlight)) return <pre className="json">{text}</pre>
  const index = text.indexOf(highlight)
  return <pre className="json">{text.slice(0, index)}<mark>{highlight}</mark>{text.slice(index + highlight.length)}</pre>
}

/* --------------------------------------------------------------- data table */

export interface Column<Row> {
  key: string
  header: ReactNode
  render: (row: Row) => ReactNode
  align?: 'num'
  mono?: boolean
  wrap?: boolean
}

export function DataTable<Row>({ caption, count, columns, rows, rowKey, empty, hideCaption }: {
  caption: string; count?: number; columns: Column<Row>[]; rows: Row[]; rowKey: (row: Row) => string; empty: string; hideCaption?: boolean
}) {
  return <div className="table-wrap">
    <table className="data">
      <caption className={hideCaption ? 'visually-hidden' : undefined}>{caption}{count !== undefined && <span className="count">{count}</span>}</caption>
      <thead><tr>{columns.map(column => <th key={column.key} scope="col" className={column.align === 'num' ? 'num' : undefined}>{column.header}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={rowKey(row)}>{columns.map(column =>
        <td key={column.key} className={[column.align === 'num' ? 'num' : '', column.mono ? 'mono' : '', column.wrap ? 'wrap' : ''].filter(Boolean).join(' ') || undefined}>{column.render(row)}</td>)}</tr>)}</tbody>
    </table>
    {rows.length === 0 && <p className="state-block">{empty}</p>}
  </div>
}

/* ---------------------------------------------------------------- KPI tile */

export interface KpiProps {
  label: string
  value: number | null | undefined
  unit?: string
  coverage?: { known: number; total: number; unit?: string }
  definition?: string
  semantics?: Record<string, number | null>
  note?: string
}

/** Exact value beside any abbreviation; coverage in the same element; Unavailable is a designed state. */
export function KpiTile({ label, value, unit, coverage, definition, semantics, note }: KpiProps) {
  const unavailable = value == null || (coverage !== undefined && coverage.total > 0 && coverage.known === 0)
  const text = unavailable ? 'Unavailable' : abbreviate(value as number)
  const exact = !unavailable && text !== (value as number).toLocaleString('en-US') ? (value as number).toLocaleString('en-US') : undefined
  const tone = coverage === undefined ? undefined : coverage.known === 0 ? 'bad' : coverage.known < coverage.total ? 'warn' : 'ok'
  return <section className="kpi" aria-label={label}>
    <div className="label"><span>{label}</span>
      {definition && <Popover label={`Definition of ${label}`} title={label}>
        <dl className="facts">
          <dt>Definition</dt><dd>{definition}</dd>
          {unit && <><dt>Unit</dt><dd>{unit}</dd></>}
          {coverage && <><dt>Coverage</dt><dd>{coverage.known.toLocaleString('en-US')} / {coverage.total.toLocaleString('en-US')} {coverage.unit ?? ''}</dd></>}
          {!unavailable && <><dt>Exact</dt><dd className="mono">{(value as number).toLocaleString('en-US')}</dd></>}
          {semantics && Object.keys(semantics).length > 0 && <><dt>By semantics</dt><dd>{Object.entries(semantics).map(([name, count]) => <div key={name}>{name}: {count == null ? 'Unavailable' : count.toLocaleString('en-US')}</div>)}</dd></>}
        </dl>
      </Popover>}
    </div>
    <p className={`value${unavailable ? ' unavailable' : ''}`}>{text}</p>
    <div className="meta">
      {coverage && <><span className={`dot ${tone}`} aria-hidden="true" /><span>coverage {coverage.known.toLocaleString('en-US')} / {coverage.total.toLocaleString('en-US')} {coverage.unit ?? ''}</span></>}
      {exact && <span className="exact">exact {exact}</span>}
      {note && <span>{note}</span>}
    </div>
  </section>
}

/* ----------------------------------------------------------- quality strip */

export interface QualityItem { key: string; label: string; count: number | null; explanation: string; onList?: () => void }

export function QualityStrip({ items }: { items: QualityItem[] }) {
  const [open, setOpen] = useState<string>()
  const current = items.find(item => item.key === open)
  return <div className="quality" aria-label="Data quality">
    <span style={{ color: 'var(--ink-3)' }}>Quality</span>
    {items.map(item => <button key={item.key} type="button" className="item" aria-expanded={open === item.key} onClick={() => setOpen(open === item.key ? undefined : item.key)}>
      <span className={`dot ${item.count ? 'warn' : ''}`} aria-hidden="true" /><b>{item.count == null ? 'Unavailable' : item.count.toLocaleString('en-US')}</b> {item.label}
    </button>)}
    {current && <div className="detail"><span>{current.explanation}</span>{current.onList && current.count ? <button className="btn small" onClick={current.onList}><Icon name="sessions" />List these sessions</button> : null}</div>}
  </div>
}
