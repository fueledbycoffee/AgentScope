import type { ReactNode } from 'react'
import { Icon, IconButton } from '../components'
import type { ImportStep } from './importRuntime'
import { num } from '../format'

const STOPS: { number: ImportStep; label: string }[] = [
  { number: 1, label: 'File' },
  { number: 2, label: 'Mapping' },
  { number: 3, label: 'Preview' },
  { number: 4, label: 'Confirm' },
]

export function ImportRoute({ step, facts, onSelect, children }: {
  step: ImportStep
  facts: Partial<Record<ImportStep, string>>
  onSelect: (step: ImportStep) => void
  children: ReactNode
}) {
  return <div className="import-route-layout">
    <aside className="import-route-rail" aria-label="Progress">
      <ol>{STOPS.map(stop => {
        const state = stop.number < step ? 'complete' : stop.number === step ? 'current' : 'future'
        return <li key={stop.number} className={`import-route-stop ${state}`}>
          <span className="import-route-stop-marker" aria-hidden="true">{state === 'complete' ? <Icon name="check" size={13} /> : stop.number}</span>
          <div className="import-route-stop-copy">
            {state === 'complete'
              ? <button type="button" onClick={() => onSelect(stop.number)}>{stop.label}</button>
              : <span aria-current={state === 'current' ? 'step' : undefined}>{stop.label}</span>}
            {state === 'complete' && facts[stop.number] && <span className="import-route-stop-fact mono">{facts[stop.number]}</span>}
          </div>
        </li>
      })}</ol>
      <p>Nothing is written until the last stop.</p>
    </aside>
    <section className="import-route-stage">{children}</section>
  </div>
}

export function StageHeader({ title, children }: { title: string; children: ReactNode }) {
  return <header className="import-route-stage-head">
    <h1 data-import-step-heading tabIndex={-1} onBlur={event => event.currentTarget.removeAttribute('tabindex')}>{title}</h1>
    <p>{children}</p>
  </header>
}

export function StageBar({ onBack, backDisabled, status, primary }: {
  onBack?: () => void
  backDisabled?: boolean
  status?: ReactNode
  primary: ReactNode
}) {
  return <div className="import-route-stage-bar">
    <span>{onBack && <IconButton name="arrowLeft" label="Back" className="btn icon-only import-route-back" disabled={backDisabled} onClick={onBack} />}</span>
    <span className="import-route-stage-status" role={status ? 'status' : undefined}>{status}</span>
    <span className="import-route-stage-primary">{primary}</span>
  </div>
}

export interface ReceiptItem { label: string; value: ReactNode; mono?: boolean }

export function Receipt({ items }: { items: ReceiptItem[] }) {
  return <div className="import-route-receipt"><dl className="facts">
    {items.map(item => <div key={item.label} className="import-route-receipt-row">
      <dt>{item.label}</dt><dd className={item.mono ? 'mono' : undefined}>{item.value}</dd>
    </div>)}
  </dl></div>
}

export function StatGroup({ title, items, note }: {
  title?: string
  items: { label: string; value: number; detail?: string }[]
  note?: ReactNode
}) {
  return <section className="import-route-stat-section">
    {title && <div className="import-route-section-title"><h2>{title}</h2>{note && <span>{note}</span>}</div>}
    <dl className="import-route-stats">{items.map(item => <div key={item.label}>
      <dt>{item.label}</dt><dd>{num(item.value)}</dd>{item.detail && <span>{item.detail}</span>}
    </div>)}</dl>
  </section>
}
