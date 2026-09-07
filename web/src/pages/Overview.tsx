import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getMetricsSummary, listSessions } from '../api'
import { Icon, KpiTile, StateBlock } from '../components'
import { useScope } from '../scope'
import { useScopeBar } from '../shellHooks'
import { useResource } from '../useResource'
import { SessionsTable, dimensionsFrom } from './sessionsTable'

const PREVIEW_ROWS = 8

/**
 * The overview: KPIs with definition and coverage, then the first sessions in
 * scope. Charts and the quality strip arrive with #10/#11 together with their
 * data; today's four tiles are the metrics the API returns (output tokens and
 * comparability are #10). If the metrics fail, the sessions stay usable and
 * the receipt says it is unavailable rather than showing stale numbers.
 */
export default function OverviewPage() {
  const { scope, link } = useScope()
  const metrics = useResource(useCallback(() => getMetricsSummary(scope), [scope]))
  const sessions = useResource(useCallback(() => listSessions({ ...scope, limit: PREVIEW_ROWS, offset: 0 }), [scope]))
  useScopeBar(
    dimensionsFrom(sessions.data),
    metrics.data ? { sessions: metrics.data.sessions.value, modelCalls: metrics.data.model_calls.value } : metrics.error ? {} : undefined,
    metrics.loading,
  )
  const data = metrics.data
  return <>
    <div className="page-head"><h1>Overview</h1><span className="sub">{scope.source ?? 'all sources'} · {scope.agent ?? 'all agents'}</span></div>
    <StateBlock loading={metrics.loading} error={metrics.error} retry={metrics.retry} lines={2}>
      {data && <div className="grid kpis">
        <KpiTile label="Sessions" value={data.sessions.value} definition={data.sessions.definition} />
        <KpiTile label="Model calls" value={data.model_calls.value} definition={data.model_calls.definition} />
        <KpiTile label="Tool calls" value={data.tool_calls.value} definition={data.tool_calls.definition} />
        <KpiTile label="Input tokens" value={data.input_tokens.value} unit={data.input_tokens.unit} definition={data.input_tokens.definition}
          coverage={{ known: data.input_tokens.coverage.known, total: data.input_tokens.coverage.total, unit: 'calls' }} semantics={data.input_tokens.by_semantics} />
      </div>}
    </StateBlock>
    <section className="panel" aria-label="Sessions">
      <div className="panel-head"><h2>Sessions</h2><Link to={link('/sessions')} className="with-icon">All sessions in scope<Icon name="arrowRight" /></Link></div>
      <StateBlock loading={sessions.loading} error={sessions.error} retry={sessions.retry} lines={4}>
        {sessions.data && <SessionsTable rows={sessions.data} caption="Sessions in scope" hideCaption empty="No sessions match this scope. Clear the scope or import traces." />}
      </StateBlock>
    </section>
  </>
}
