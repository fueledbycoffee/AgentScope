import { useCallback, useRef } from 'react'
import { getMetricsSummary, getScopeFacets, listSessions, queryMetric } from '../api'
import { Pagination, StateBlock } from '../components'
import { scopeDimensions } from '../dashboard/dashboardData'
import { PAGE_SIZE } from '../format'
import { resolvePeriod, useScope } from '../scope'
import { useScopeBar } from '../shellHooks'
import { useResource } from '../useResource'
import { SessionsTable } from './sessionsTable'

/** Every session under the same resolved API scope as the dashboard, paginated in the URL. */
export default function SessionsPage() {
  const { scope, apiScope, offset, setOffset } = useScope()
  const metrics = useResource(useCallback(() => getMetricsSummary(apiScope), [apiScope]))
  const facets = useResource(useCallback(() => getScopeFacets(apiScope), [apiScope]))
  const imports = useResource(useCallback(() => queryMetric('imports_in_scope', [], apiScope), [apiScope]))
  const sessions = useResource(useCallback(() => listSessions({ ...apiScope, limit: PAGE_SIZE, offset }), [apiScope, offset]))
  const lastFacets = useRef(facets.data)
  // oxlint-disable-next-line react/refs -- keep selector options usable while scoped facets reload.
  if (facets.data) lastFacets.current = facets.data
  useScopeBar(
    // oxlint-disable-next-line react/refs -- the ref is a display cache, never rendered metric data.
    scopeDimensions(lastFacets.current, scope),
    metrics.data ? {
      sessionsText: metrics.data.sessions.value_text,
      modelCallsText: metrics.data.model_calls.value_text,
      importsText: imports.data?.overall.value_text,
      resolvedPeriodText: resolvePeriod(scope.period)?.text,
    } : metrics.error ? {} : undefined,
    metrics.loading || facets.loading || imports.loading,
  )
  const empty = offset > 0 ? 'No sessions on this page.' : 'No sessions match this scope. Clear the scope or import traces.'
  return <>
    <div className="page-head"><h1>Sessions</h1>{metrics.data && <span className="sub">{metrics.data.sessions.value_text ?? 'Unavailable'} in scope</span>}</div>
    <div data-scope-chips-slot="sessions-table" />
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
