import { Link } from 'react-router-dom'
import type { Session } from '../api'
import { DataTable, DateText, ScopeCell } from '../components'
import type { Column } from '../components'
import { display, num } from '../format'
import { useScope } from '../scope'
export { dimensionsFrom } from '../scopeDimensions'

/** The sessions table shared by Overview and Sessions; the id is a real anchor that keeps the scope. */
export function SessionsTable({ rows, caption, count, empty, hideCaption }: { rows: Session[]; caption: string; count?: number; empty: string; hideCaption?: boolean }) {
  const { link } = useScope()
  const columns: Column<Session>[] = [
    { key: 'id', header: 'Session', mono: true, render: session => <Link to={link(`/sessions/${encodeURIComponent(session.id)}`)}>{session.external_id}</Link> },
    { key: 'source', header: 'Source', render: session => <ScopeCell dimension="source" value={session.source} /> },
    { key: 'agent', header: 'Agent', render: session => <ScopeCell dimension="agent" value={session.agent} /> },
    { key: 'start', header: 'Observed start', mono: true, render: session => <DateText value={session.observed_start_at} /> },
    { key: 'end', header: 'Observed end', mono: true, render: session => <DateText value={session.observed_end_at} /> },
    { key: 'calls', header: 'Model calls', align: 'num', render: session => display(session.model_call_count) },
    { key: 'tools', header: 'Tool calls', align: 'num', render: session => display(session.tool_call_count) },
    { key: 'tokens', header: 'Input tokens', align: 'num', render: session => display(session.input_tokens.value) },
    { key: 'coverage', header: 'Coverage', align: 'num', render: session => `${num(session.input_tokens.coverage.known)} / ${num(session.input_tokens.coverage.total)} calls` },
  ]
  return <DataTable caption={caption} count={count} columns={columns} rows={rows} rowKey={session => session.id} empty={empty} hideCaption={hideCaption} />
}
