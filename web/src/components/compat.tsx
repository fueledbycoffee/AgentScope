/**
 * Compatibility layer for the thin-slice pages: the same names they import,
 * implemented on the Console primitives. New screens import from
 * `./components/` directly.
 */
import type { ReactNode } from 'react'
import { display } from '../format'
import { Notice, StateBlock } from './primitives'
export { Pagination } from './primitives'

export function JsonView({ value }: { value: unknown }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>
}

export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null
  return <StateBlock loading={false} error={error} />
}

export function ResourceState({ loading, error, retry }: { loading: boolean; error?: unknown; retry: () => void }) {
  return <StateBlock loading={loading} error={error} retry={retry} />
}

export function Table({ caption, headers, children }: { caption: string; headers: string[]; children: ReactNode }) {
  return <div className="table-wrap"><table className="data"><caption>{caption}</caption>
    <thead><tr>{headers.map(header => <th key={header} scope="col">{header}</th>)}</tr></thead>
    <tbody>{children}</tbody></table></div>
}

export function Counts({ title, counts }: { title: string; counts: object }) {
  return <section><h3 style={{ marginBottom: 8 }}>{title}</h3><dl className="counts">{Object.entries(counts).map(([name, count]) =>
    <div key={name} className="count-item"><dt>{name.replaceAll('_', ' ')}</dt><dd className={count === 0 ? 'zero' : undefined}>{display(count)}</dd></div>)}</dl></section>
}

export { Notice }
