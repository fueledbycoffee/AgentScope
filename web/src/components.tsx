import type { ReactNode } from 'react'
import { ApiError } from './api'

import { display, PAGE_SIZE } from './format'
export function JsonView({ value }: { value: unknown }) {
  return <pre>{JSON.stringify(value, null, 2)}</pre>
}
export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null
  return <div role="alert" className="error">
    <p>{error instanceof Error ? error.message : 'Something went wrong. Please try again.'}</p>
    {error instanceof ApiError && <><p>Code: {error.code}</p>
      {error.details.length > 0 && <details><summary>Error details</summary><JsonView value={error.details} /></details>}
    </>}
  </div>
}
export function ResourceState({ loading, error, retry }: { loading: boolean; error?: unknown; retry: () => void }) {
  return <>{loading && <p role="status">Loading…</p>}<ErrorNotice error={error} />
    {!!error && <button onClick={retry}>Retry</button>}</>
}
export function Table({ caption, headers, children }: { caption: string; headers: string[]; children: ReactNode }) {
  return <div className="table-scroll"><table><caption>{caption}</caption>
    <thead><tr>{headers.map(header => <th key={header} scope="col">{header}</th>)}</tr></thead>
    <tbody>{children}</tbody></table></div>
}
export function Counts({ title, counts }: { title: string; counts: object }) {
  return <section><h3>{title}</h3><dl className="counts">{Object.entries(counts).map(([name, count]) =>
    <div key={name}><dt>{name.replaceAll('_', ' ')}</dt><dd>{display(count)}</dd></div>)}</dl></section>
}
export function Pagination({ offset, count, onChange }: { offset: number; count: number; onChange: (offset: number) => void }) {
  return <nav aria-label="Pagination" className="actions">
    <button disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
    <span>Page {Math.floor(offset / PAGE_SIZE) + 1}</span>
    <button disabled={count < PAGE_SIZE} onClick={() => onChange(offset + PAGE_SIZE)}>Next</button>
  </nav>
}
