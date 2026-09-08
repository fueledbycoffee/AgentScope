import { useCallback } from 'react'
import { getMetricsSummary, listSessions } from '../api'
import { Pagination, ScopeChips, StateBlock } from '../components'
import { PAGE_SIZE, num } from '../format'
import { useScope } from '../scope'
import { useScopeBar } from '../shellHooks'
import { useResource } from '../useResource'
import { SessionsTable, dimensionsFrom } from './sessionsTable'

/** Every session under scope, paginated; the offset is in the URL so Back works. */
export default function SessionsPage() {
  const { scope, offset, setOffset } = useScope()
  const metrics = useResource(useCallback(() => getMetricsSummary(scope), [scope]))
  const sessions = useResource(useCallback(() => listSessions({ ...scope, limit: PAGE_SIZE, offset }), [scope, offset]))
  useScopeBar(
    dimensionsFrom(sessions.data),
    metrics.data ? { sessions: metrics.data.sessions.value, modelCalls: metrics.data.model_calls.value } : metrics.error ? {} : undefined,
    metrics.loading,
  )
  const empty = offset > 0 ? 'No sessions on this page.' : 'No sessions match this scope. Clear the scope or import traces.'
  return <>
    <div className="page-head"><h1>Sessions</h1>{metrics.data && <span className="sub">{num(metrics.data.sessions.value)} in scope</span>}</div>
    <ScopeChips />
    <section className="panel">
      <StateBlock loading={sessions.loading} error={sessions.error} retry={sessions.retry} lines={6}>
        {sessions.data && <>
          <SessionsTable rows={sessions.data} caption="Sessions in scope" hideCaption empty={empty} />
          <Pagination offset={offset} count={sessions.data.length} onChange={setOffset} />
        </>}
      </StateBlock>
    </section>
  </>
}
