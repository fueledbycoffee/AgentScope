import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { useScope } from '../scope'
import type { ScopeKey } from '../scope'

export interface Dimension { key: ScopeKey; label: string; options: string[] }

/**
 * One scope dimension. Until a facets endpoint exists (#11) the control is a
 * text input with the values seen so far as suggestions, so any value the
 * API accepts can be typed and an unknown URL value is shown as is. It is
 * controlled by the URL: Back and Clear update what it displays.
 */
function ScopeInput({ dimension, value, onChange }: { dimension: Dimension; value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  const listId = useId()
  const commit = () => { if (draft.trim() !== value) onChange(draft) }
  return <label className="dim">
    <span>{dimension.label}</span>
    <input list={listId} value={draft} placeholder="All" size={14} onChange={event => setDraft(event.target.value)} onBlur={commit}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit() } }} />
    <datalist id={listId}>{dimension.options.map(option => <option key={option} value={option} />)}</datalist>
  </label>
}

/** The scope bar: dimensions, Clear, and the receipt. State is the URL. */
export function ScopeBar({ dimensions, receipt, loading }: { dimensions: Dimension[]; receipt?: ReactNode; loading?: boolean }) {
  const { scope, set, clear } = useScope()
  const active = dimensions.some(dimension => scope[dimension.key])
  return <div className="bar" role="group" aria-label="Scope">
    <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>Scope</span>
    {dimensions.map(dimension => <ScopeInput key={`${dimension.key}:${scope[dimension.key] ?? ''}`} dimension={dimension} value={scope[dimension.key] ?? ''} onChange={value => set({ [dimension.key]: value })} />)}
    {active && <button type="button" className="btn quiet small" onClick={clear}>Clear</button>}
    <div className="receipt" aria-live="polite">{loading ? <span className="skeleton" style={{ display: 'inline-block', width: 180, height: 12 }} /> : receipt}</div>
  </div>
}

/** A removable drill chip; #11 wires chart clicks to it. Gallery-only until then. */
export function ScopeChip({ label, value, onRemove }: { label: string; value: string; onRemove: () => void }) {
  return <span className="chip">{label} {value}<button type="button" aria-label={`Remove ${label} ${value}`} onClick={onRemove}>×</button></span>
}

export function ScopeReceipt({ sessions, modelCalls, imports }: { sessions?: number | null; modelCalls?: number | null; imports?: number | null }) {
  const part = (value: number | null | undefined, noun: string) => value == null ? null : <><b>{value.toLocaleString('en-US')}</b> {noun}</>
  const parts = [part(sessions, 'sessions'), part(modelCalls, 'model calls'), imports == null ? null : <>from <b>{imports}</b> {imports === 1 ? 'import' : 'imports'}</>].filter(Boolean)
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
