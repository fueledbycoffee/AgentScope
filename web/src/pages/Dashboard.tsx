import { display, PAGE_SIZE } from '../format'
import { useResource } from '../useResource'
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { getMetricsSummary, listSessions } from '../api'
import type { Scope } from '../api'
import { Pagination, ResourceState, Table } from '../components'

export default function DashboardPage() {
  const [scope, setScope] = useState<Scope>({})
  const [offset, setOffset] = useState(0)
  const metrics = useResource(useCallback(() => getMetricsSummary(scope), [scope]))
  const sessions = useResource(useCallback(() => listSessions({ ...scope, limit: PAGE_SIZE, offset }), [scope, offset]))
  const labels = { sessions: 'Sessions', model_calls: 'Model calls', tool_calls: 'Tool calls', input_tokens: 'Input tokens' }

  return <><h1>Dashboard</h1>
    <form className="filters" onSubmit={event => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      setScope({ source: String(data.get('source')).trim(), agent: String(data.get('agent')).trim() })
      setOffset(0)
    }}>
      <label>Source<input name="source" placeholder="All sources" /></label>
      <label>Agent<input name="agent" placeholder="All agents" /></label>
      <button type="submit">Apply filters</button>
      <button type="reset" onClick={() => { setScope({}); setOffset(0) }}>Clear filters</button>
    </form>
    <p>Scope: {scope.source || 'all sources'} · {scope.agent || 'all agents'}</p>
    <ResourceState {...metrics} />
    {metrics.data && <div className="kpis">{(Object.keys(labels) as (keyof typeof labels)[]).map(key => {
      const metric = metrics.data![key]
      return <section className="kpi" key={key} aria-label={labels[key]}>
        <h2>{labels[key]}</h2><p className="metric">{display(metric.value)}</p>
        {key === 'input_tokens' && <>
          <p>Coverage: {metrics.data!.input_tokens.coverage.known} / {metrics.data!.input_tokens.coverage.total} calls</p>
          <p>Unit: {metrics.data!.input_tokens.unit}</p>
          <details><summary>Token semantics</summary><dl>{Object.entries(metrics.data!.input_tokens.by_semantics).map(([name, value]) =>
            <div key={name}><dt>{name}</dt><dd>{display(value)}</dd></div>)}</dl></details>
        </>}
        <details><summary title={metric.definition}>Definition</summary><p>{metric.definition}</p></details>
      </section>
    })}</div>}
    <h2>Sessions</h2><ResourceState {...sessions} />
    {sessions.data && <>
      <Table caption="Sessions in scope" headers={['Session', 'Source', 'Agent', 'Observed start', 'Observed end', 'Model calls', 'Tool calls', 'Input tokens', 'Coverage']}>
        {sessions.data.map(session => <tr key={session.id}>
          <td><Link to={`/sessions/${encodeURIComponent(session.id)}`}>{session.external_id}</Link></td>
          <td>{session.source}</td><td>{display(session.agent)}</td>
          <td>{display(session.observed_start_at)}</td><td>{display(session.observed_end_at)}</td>
          <td>{display(session.model_call_count)}</td><td>{display(session.tool_call_count)}</td>
          <td>{display(session.input_tokens.value)}</td><td>{session.input_tokens.coverage.known} / {session.input_tokens.coverage.total} calls</td>
        </tr>)}
      </Table>
      {sessions.data.length === 0 && <p>No sessions on this page. Adjust the filters or <Link to="/import">import traces</Link>.</p>}
      <Pagination offset={offset} count={sessions.data.length} onChange={setOffset} />
    </>}
  </>
}
