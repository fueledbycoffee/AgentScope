import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../api'
import type { Coverage, MetricDefinition, TokenCoverage } from '../api'
import { PAGE_SIZE } from '../format'
import { accountingGroupLabel } from './accounting'
import { groupExactText } from './exactText'
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
  value?: number | null
  display?: MetricDisplay
  unit?: string
  coverage?: { known: number; total: number; unit?: string }
  definition?: string | MetricDefinition
  semantics?: Record<string, number | null>
  note?: string
  headlineText?: string
  related?: readonly { label: string; display: MetricDisplay }[]
  coverageUnit?: string
  accountingGroups?: boolean
  coverageText?: string
  showHeadlineExact?: boolean
}

export interface MetricDisplay {
  valueText: string | null
  recordedSumText: string | null
  coverage: Coverage
  comparability: 'comparable' | 'mixed' | 'unknown' | 'not_applicable'
  reason: string
  partitions: readonly { semantics: string; valueText: string | null; coverage: Coverage }[]
  pricedCoverage?: TokenCoverage | null
  scheduleVersion?: string | null
}

export function abbreviateDecimalText(valueText: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(valueText)
  if (!match) return valueText
  const [, sign, whole, fraction = ''] = match
  if (whole.length <= 5) return groupExactText(valueText)
  const groups = [
    { size: 13, divisor: 1_000_000_000_000n, suffix: 'T' },
    { size: 10, divisor: 1_000_000_000n, suffix: 'B' },
    { size: 7, divisor: 1_000_000n, suffix: 'M' },
    { size: 4, divisor: 1_000n, suffix: 'k' },
  ]
  const group = groups.find(item => whole.length >= item.size) ?? groups.at(-1)!
  const scale = 10n ** BigInt(fraction.length)
  const magnitude = BigInt(`${whole}${fraction}`)
  const scaledDivisor = group.divisor * scale
  const tenths = (magnitude * 10n + scaledDivisor / 2n) / scaledDivisor
  const major = tenths / 10n
  const minor = tenths % 10n
  return `${sign}${major}${minor ? `.${minor}` : ''}${group.suffix}`
}

function legacyDisplay(value: number | null | undefined, coverage?: KpiProps['coverage'], semantics?: KpiProps['semantics']): MetricDisplay {
  const text = value == null ? null : String(value)
  return {
    valueText: coverage && coverage.total > 0 && coverage.known === 0 ? null : text,
    recordedSumText: text,
    coverage: coverage ?? { known: value == null ? 0 : 1, total: value == null ? 0 : 1 },
    comparability: 'not_applicable',
    reason: value == null ? 'No recorded value in scope.' : 'Recorded observations in scope.',
    partitions: Object.entries(semantics ?? {}).map(([name, count]) => ({
      semantics: name,
      valueText: count == null ? null : String(count),
      coverage: { known: count == null ? 0 : 1, total: 1 },
    })),
  }
}

function MetricFacts({ label, metric, definition, unit, related = [], coverageUnit, note }: {
  label: string
  metric: MetricDisplay
  definition?: KpiProps['definition']
  unit?: string
  related?: KpiProps['related']
  coverageUnit?: string
  note?: string
}) {
  const metadata = typeof definition === 'object' ? definition : undefined
  const caveat = note ?? metadata?.caveat
  return <dl className="facts">
    <dt>Definition</dt><dd>{metadata?.description ?? (typeof definition === 'string' ? definition : 'Not applicable')}</dd>
    <dt>Formula</dt><dd>{metadata?.formula ?? 'Not applicable'}</dd>
    <dt>Unit</dt><dd>{metadata?.unit ?? unit ?? 'Not applicable'}</dd>
    <dt>Scope</dt><dd>{metadata?.scope ?? 'Not applicable'}</dd>
    <dt>Null handling</dt><dd>{metadata?.null_handling ?? 'Not applicable'}</dd>
    <dt>Comparability</dt><dd>{metric.comparability}: {metric.reason}</dd>
    <dt>Coverage</dt><dd>{groupExactText(String(metric.coverage.known))} / {groupExactText(String(metric.coverage.total))}{coverageUnit ? ` ${coverageUnit}` : ''}</dd>
    {metric.pricedCoverage && <><dt>Priced token coverage</dt><dd>{groupExactText(metric.pricedCoverage.known_text)} / {groupExactText(metric.pricedCoverage.total_text)}</dd></>}
    {metric.scheduleVersion && <><dt>Schedule version</dt><dd><code>{metric.scheduleVersion}</code></dd></>}
    {metric.valueText !== null && <><dt>Exact</dt><dd className="metric-number">{groupExactText(metric.valueText)}</dd></>}
    {metric.partitions.length > 0 && <><dt>Accounting groups</dt><dd className="metric-breakdown">{metric.partitions.map(partition => <div key={partition.semantics}><code>{partition.semantics}</code>: <span className="metric-number">{partition.valueText === null ? 'Unavailable' : groupExactText(partition.valueText)}</span> · coverage {groupExactText(String(partition.coverage.known))} / {groupExactText(String(partition.coverage.total))}</div>)}</dd></>}
    {caveat && <><dt>Caveat</dt><dd>{caveat}</dd></>}
    {related.map(item => <div key={item.label} className="related-metric">
      <dt>{item.label}</dt>
      <dd>{item.display.valueText === null ? 'Unavailable' : groupExactText(item.display.valueText)} · coverage {groupExactText(String(item.display.coverage.known))} / {groupExactText(String(item.display.coverage.total))}{coverageUnit ? ` ${coverageUnit}` : ''}<br />{item.display.reason}</dd>
    </div>)}
    {metadata && <><dt>Registry</dt><dd><Link to={`/definitions#${metadata.id}`}>Open complete definition for {label}</Link></dd></>}
  </dl>
}

function AccountingGroupsValue({ metric }: { metric: MetricDisplay }) {
  if (metric.partitions.length === 0) return <p className="value unavailable">Unavailable</p>
  return <div className="value accounting-groups">
    {metric.partitions.map(partition => {
      const unavailable = partition.semantics.toLowerCase() === 'unknown' || partition.valueText === null
      const grouped = unavailable ? undefined : groupExactText(partition.valueText!)
      const value = unavailable ? 'Unavailable' : abbreviateDecimalText(partition.valueText!)
      const exact = grouped !== value ? grouped : undefined
      return <div className="accounting-group" key={partition.semantics}>
        <span className="accounting-label">{accountingGroupLabel(partition.semantics)}</span>
        <span className={`accounting-value${unavailable ? ' unavailable' : ''}`}>{value}</span>
        {exact && <span className="accounting-exact">exact {exact}</span>}
      </div>
    })}
  </div>
}

/** Exact transport text remains one element; abbreviations are never authoritative. */
export function KpiTile({ label, value, display, unit, coverage, definition, semantics, note, headlineText, related, coverageUnit, accountingGroups = false, coverageText, showHeadlineExact = false }: KpiProps) {
  const metric = display ?? legacyDisplay(value, coverage, semantics)
  const unavailable = metric.valueText === null
  const text = unavailable ? 'Unavailable' : headlineText ?? abbreviateDecimalText(metric.valueText!)
  const groupedValue = metric.valueText === null ? undefined : groupExactText(metric.valueText)
  const abbreviated = metric.valueText === null ? undefined : abbreviateDecimalText(metric.valueText)
  const exact = groupedValue !== undefined && (
    headlineText ? showHeadlineExact : abbreviated !== groupedValue
  ) ? groupedValue : undefined
  const tone = metric.coverage.known === 0 ? 'bad' : metric.coverage.known < metric.coverage.total ? 'warn' : 'ok'
  return <section className="kpi" aria-label={label}>
    <div className="label"><span>{label}</span>
      {definition && <Popover label={`Definition of ${label}`} title={label}>
        <MetricFacts label={label} metric={metric} definition={definition} unit={unit} related={related} coverageUnit={coverageUnit ?? coverage?.unit} note={note} />
      </Popover>}
    </div>
    {accountingGroups ? <AccountingGroupsValue metric={metric} /> : <p className={`value${unavailable ? ' unavailable' : ''}`}>{text}</p>}
    {exact && <p className="exact-line">exact {exact}</p>}
    <div className="coverage-line">
      <span className={`dot ${tone}`} aria-hidden="true" /><span>{coverageText ?? `coverage ${groupExactText(String(metric.coverage.known))} / ${groupExactText(String(metric.coverage.total))}${coverageUnit ?? coverage?.unit ? ` ${coverageUnit ?? coverage?.unit}` : ''}`}</span>
    </div>
  </section>
}

export function HeadlineTile(props: Omit<KpiProps, 'value' | 'coverage' | 'semantics'> & { display: MetricDisplay }) {
  return <div className="headline-tile"><KpiTile {...props} /></div>
}

/* ----------------------------------------------------------- quality strip */

export interface QualityItem {
  key: string
  label: string
  count?: number | null
  countText?: string | null
  explanation: string
  onList?: () => void
  actionHref?: string
  actionLabel?: string
}

export function QualityStrip({ items }: { items: QualityItem[] }) {
  const [open, setOpen] = useState<string>()
  const current = items.find(item => item.key === open)
  return <div className="quality" aria-label="Data quality">
    <span style={{ color: 'var(--ink-3)' }}>Quality</span>
    {items.map(item => { const text = item.countText ?? (item.count == null ? null : String(item.count)); return <button key={item.key} type="button" className="item" aria-expanded={open === item.key} onClick={() => setOpen(open === item.key ? undefined : item.key)}>
      <span className={`dot ${text !== null && text !== '0' ? 'warn' : ''}`} aria-hidden="true" /><b>{text === null ? 'Unavailable' : groupExactText(text)}</b> {item.label}
    </button> })}
    {current && <div className="detail"><span>{current.explanation}</span>
      {current.actionHref && <Link className="btn small" to={current.actionHref}>{current.actionLabel ?? 'Open details'}</Link>}
      {current.onList && (() => { const value = current.countText ?? (current.count == null ? null : String(current.count)); return value !== null && value !== '0' })() ? <button className="btn small" onClick={current.onList}><Icon name="sessions" />List these sessions</button> : null}
    </div>}
  </div>
}
