import { Link } from 'react-router-dom'
import type { Session } from '../api'
import { DataTable, groupExactText } from '../components'
import type { Column } from '../components'
import { display } from '../format'
import { useScope } from '../scope'
export { dimensionsFrom } from '../scopeDimensions'

function inputUsage(session: Session) {
  const metric = session.input_tokens
  if (metric.value_text !== null) return <span className="exact">{groupExactText(metric.value_text)}</span>
  if (metric.coverage.known === 0) return <span title={metric.reason}>Unavailable</span>
  return <span title={`${metric.reason} ${metric.semantics_partitions.map(part => `${part.semantics}: ${part.value_text ?? 'Unavailable'}`).join('; ')}`}>Not comparable</span>
}

/** The sessions table shared by Overview and Sessions; the id is a real anchor that keeps the scope. */
export function SessionsTable({ rows, caption, count, empty, hideCaption }: { rows: Session[]; caption: string; count?: number; empty: string; hideCaption?: boolean }) {
  const { link } = useScope()
  const columns: Column<Session>[] = [
    { key: 'id', header: 'Session', mono: true, render: session => <Link to={link(`/sessions/${encodeURIComponent(session.id)}`)}>{session.external_id}</Link> },
    { key: 'source', header: 'Source', render: session => session.source },
    { key: 'agent', header: 'Agent', render: session => display(session.agent) },
    { key: 'start', header: 'Observed start', mono: true, render: session => display(session.observed_start_at) },
    { key: 'end', header: 'Observed end', mono: true, render: session => display(session.observed_end_at) },
    { key: 'calls', header: 'Model calls', align: 'num', render: session => display(session.model_call_count) },
    { key: 'tools', header: 'Tool calls', align: 'num', render: session => display(session.tool_call_count) },
    { key: 'tokens', header: 'Input tokens', align: 'num', render: inputUsage },
    { key: 'coverage', header: 'Coverage', align: 'num', render: session => `${groupExactText(String(session.input_tokens.coverage.known))} / ${groupExactText(String(session.input_tokens.coverage.total))} calls` },
  ]
  return <DataTable caption={caption} count={count} columns={columns} rows={rows} rowKey={session => session.id} empty={empty} hideCaption={hideCaption} />
}
