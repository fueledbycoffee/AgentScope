import type { ReactNode } from 'react'
import { SCOPE_LABELS, formatScopeValue, useScope } from '../scope'
import type { ScopeKey } from '../scope'
import { Icon, IconButton } from './icons'

export interface Dimension { key: ScopeKey; label: string; options: readonly string[] }

function ScopeSelect({ dimension, value, onChange }: { dimension: Dimension; value: string; onChange: (value: string) => void }) {
  const options = value && !dimension.options.includes(value)
    ? [value, ...dimension.options]
    : dimension.options
  return <label className="dim">
    <span>{dimension.label}</span>
    <select value={value} onChange={event => onChange(event.target.value)}>
      <option value="">All</option>
      {options.map(option => <option key={option} value={option}>{formatScopeValue(dimension.key, option)}</option>)}
    </select>
  </label>
}

/** The sticky URL scope: four base dimensions, one derived drill, one receipt. */
export function ScopeBar({ dimensions, receipt, loading }: { dimensions: Dimension[]; receipt?: ReactNode; loading?: boolean }) {
  const { scope, drill, set, clear, removeDrill } = useScope()
  const active = dimensions.some(dimension => scope[dimension.key]) || Boolean(drill)
  return <div className="bar" role="group" aria-label="Scope">
    <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>Scope</span>
    {dimensions.map(dimension => <ScopeSelect key={dimension.key} dimension={dimension} value={scope[dimension.key] ?? ''} onChange={value => set({ [dimension.key]: value })} />)}
    {drill && <ScopeChip label={drill.label} value={drill.value} onRemove={removeDrill} />}
    {active && <IconButton name="x" label="Clear all" className="btn quiet small icon-only" onClick={clear} />}
    <div className="receipt" aria-live="polite">{loading ? <span className="skeleton" style={{ display: 'inline-block', width: 180, height: 12 }} /> : receipt}</div>
  </div>
}

/** Public leaf props stay stable for #46's ScopeChips composition. */
export function ScopeChip({ label, value, onRemove }: { label: string; value: string; onRemove: () => void }) {
  const removal = `Remove ${label} ${value}`
  return <span className="chip">{label} {value}<button type="button" className="has-tip" aria-label={removal} title={removal} data-tip={removal} onClick={onRemove}><Icon name="x" size={12} /></button></span>
}

export interface ScopeReceiptProps {
  sessionsText?: string | null
  modelCallsText?: string | null
  importsText?: string | null
  resolvedPeriodText?: string | null
}

export function ScopeReceipt({ sessionsText, modelCallsText, importsText, resolvedPeriodText }: ScopeReceiptProps) {
  const parts: ReactNode[] = []
  if (sessionsText != null) parts.push(<><b>{sessionsText}</b> sessions</>)
  if (modelCallsText != null) parts.push(<><b>{modelCallsText}</b> model calls</>)
  if (importsText != null) parts.push(<>from <b>{importsText}</b> imports</>)
  if (resolvedPeriodText) parts.push(<>{resolvedPeriodText}</>)
  if (parts.length === 0) return <span>Scope receipt unavailable</span>
  return <>{parts.map((node, index) => <span key={index}>{index > 0 && ' · '}{node}</span>)}</>
}

export interface FileItem { label: string; value: ReactNode; mono?: boolean }

/** Replaces the scope bar on routes where scope has no meaning; same height, so the frame never jumps. */
export function FileBar({ items, title }: { items: FileItem[]; title?: string }) {
  return <div className="bar" role="group" aria-label={title ?? 'Context'}>
    {title && <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>{title}</span>}
    {items.length === 0 && <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-4)' }}>Scope does not apply here.</span>}
    {items.map(item => <span key={item.label} className="file-item"><span>{item.label}</span><b className={item.mono ? 'mono' : undefined}>{item.value}</b></span>)}
  </div>
}

export { SCOPE_LABELS }
