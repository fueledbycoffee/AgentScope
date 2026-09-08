import { useCallback, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listSessions } from '../api'
import type { MetricDefinition, MetricQuery } from '../api'
import { DayBars, groupExactText, HBars, HeadlineTile, Icon, KpiTile, QualityStrip, StateBlock, TokenBars } from '../components'
import {
  activityPoints, displayFromResult, displayFromSummary, loadDashboard, scopeDimensions,
  tokenRows, toolPoints,
} from '../dashboard/dashboardData'
import type { TokenMeasure, TokenRow } from '../dashboard/dashboardData'
import { createDrillEnvelope, formatApiScopeBounds, scopeSearch, useScope } from '../scope'
import type { DrillEnvelopeV1 } from '../scope'
import { useScopeBar } from '../shellHooks'
import { useResource } from '../useResource'
import { SessionsTable } from './sessionsTable'

const PREVIEW_ROWS = 8

function definition(data: Record<string, MetricDefinition>, id: string, fallback: string) {
  return data[id] ?? fallback
}

function durationHeadline(valueText: string | null) {
  if (valueText === null) return undefined
  const milliseconds = Number(valueText)
  if (!Number.isFinite(milliseconds)) return undefined
  const hours = milliseconds / 3_600_000
  if (hours >= 1) return `${hours.toFixed(hours >= 10 ? 0 : 1)} h`
  const minutes = milliseconds / 60_000
  return `${minutes.toFixed(minutes >= 10 ? 0 : 1)} min`
}

function qualityEnvelope(query: MetricQuery, value: string) {
  return createDrillEnvelope('quality', value, query.scope)
}

/** Trustworthy Console overview: exact cards, charts, quality and one URL drill path. */
export default function OverviewPage() {
  const navigate = useNavigate()
  const { scope, apiScope, link } = useScope()
  const dashboard = useResource(useCallback(() => loadDashboard(apiScope), [apiScope]))
  const sessions = useResource(useCallback(() => listSessions({ ...apiScope, limit: PREVIEW_ROWS, offset: 0 }), [apiScope]))
  const data = dashboard.data
  const lastFacets = useRef(data?.facets)
  // oxlint-disable-next-line react/refs -- keep selector options usable while core values reload.
  if (data?.facets) lastFacets.current = data.facets
  useScopeBar(
    // oxlint-disable-next-line react/refs -- the ref is a display cache, never rendered metric data.
    scopeDimensions(lastFacets.current, scope),
    data ? {
      sessionsText: data.summary.sessions.value_text,
      modelCallsText: data.summary.model_calls.value_text,
      importsText: data.importsInScope.overall.value_text,
      resolvedPeriodText: formatApiScopeBounds(apiScope),
    } : dashboard.error ? {} : undefined,
    dashboard.loading,
  )

  const activateDrill = (drill: DrillEnvelopeV1) => {
    const destination = { ...scope, drill }
    navigate({ pathname: '/sessions', search: scopeSearch(destination) })
  }
  const activateToken = (_row: TokenRow, measure: TokenMeasure) => {
    if (measure.drill) activateDrill(measure.drill)
  }

  const unknownQuality = (() => {
    if (!data) return { countText: null, explanation: 'Unknown timestamps are loading.' }
    const bucket = data.activity.buckets.find(item => item.keys[0] === null)
    if (bucket?.result.value_text !== null && bucket?.result.value_text !== undefined) {
      return {
        countText: bucket.result.value_text,
        explanation: 'Model-call observations whose timestamp could not be placed on the activity chart.',
        drill: createDrillEnvelope('quality', 'unknown timestamps', bucket.drill_scope),
      }
    }
    const countText = String(data.activity.excluded_unknown_timestamps)
    const matches = data.unknownTimestamps.overall.value_text === countText
    return {
      countText,
      explanation: matches
        ? 'Undated observations cannot be placed inside the selected period.'
        : 'The undated population cannot be reconciled to a session list under the active drill.',
      drill: matches ? qualityEnvelope(data.unknownTimestamps, 'unknown timestamps') : undefined,
    }
  })()

  const missingDrill = data && qualityEnvelope(data.missingUsage, 'missing usage')
  const unlinkedDrill = data && qualityEnvelope(data.unlinkedTools, 'unlinked tools')
  const unknownDrill = unknownQuality.drill
  return <>
    <div className="page-head"><h1>Overview</h1><span className="sub">{scope.source ?? 'all sources'} · {scope.agent ?? 'all agents'} · {scope.model ?? 'all models'}</span></div>
    <StateBlock loading={dashboard.loading} error={dashboard.error} retry={dashboard.retry} lines={8}>
      {data && <div className="dashboard-stack">
        <div className="grid kpis">
          <KpiTile label="Sessions" display={displayFromSummary(data.summary.sessions)} definition={definition(data.definitions, 'sessions', data.summary.sessions.definition)} />
          <KpiTile label="Model-call observations" display={displayFromSummary(data.summary.model_calls)} definition={definition(data.definitions, 'model_calls', data.summary.model_calls.definition)} />
          <KpiTile label="Tool-call observations" display={displayFromSummary(data.summary.tool_calls)} definition={definition(data.definitions, 'tool_calls', data.summary.tool_calls.definition)} />
          <KpiTile label="Input usage by accounting group" display={displayFromSummary(data.summary.input_tokens)} definition={definition(data.definitions, 'input_tokens', data.summary.input_tokens.definition)} unit="tokens" coverageUnit="calls" related={[{ label: 'Cache-read tokens', display: displayFromResult(data.cacheReadTokens.overall) }]} />
        </div>
        <div className="headline-strip" aria-label="Supporting headline metrics">
          <HeadlineTile label="Scheduled cost" display={displayFromResult(data.scheduledCost.overall)} definition={data.scheduledCost.definition} unit="USD" coverageUnit="calls" note={data.scheduledCost.definition.caveat ?? undefined} />
          <HeadlineTile label="Observed span" display={displayFromResult(data.observedSpan.overall)} definition={data.observedSpan.definition} unit="ms" coverageUnit="sessions" headlineText={durationHeadline(data.observedSpan.overall.value_text)} note={data.observedSpan.definition.caveat ?? undefined} />
        </div>
        <div className="token-overall" aria-label="Token usage totals">
          <span><b>Input</b> {data.summary.input_tokens.value_text === null ? (data.summary.input_tokens.coverage.known ? 'Not comparable' : 'Unavailable') : groupExactText(data.summary.input_tokens.value_text)} · coverage {groupExactText(String(data.summary.input_tokens.coverage.known))} / {groupExactText(String(data.summary.input_tokens.coverage.total))}</span>
          <span><b>Output</b> <span className="exact">{data.summary.output_tokens.value_text === null ? (data.summary.output_tokens.coverage.known ? 'Not comparable' : 'Unavailable') : groupExactText(data.summary.output_tokens.value_text)}</span> · coverage {groupExactText(String(data.summary.output_tokens.coverage.known))} / {groupExactText(String(data.summary.output_tokens.coverage.total))}</span>
        </div>
        <div className="grid charts dashboard-charts">
          <DayBars title="Activity by day" unit="model calls" data={activityPoints(data.activity)} onSelect={point => { if (point.drill) activateDrill(point.drill) }} hint="Select a UTC day to list matching sessions." />
          <TokenBars title="Tokens by model" rows={tokenRows(data.inputByModel, data.outputByModel)} onSelect={activateToken} />
          <HBars title="Tool calls" unit="calls" data={toolPoints(data.tools)} onSelect={point => { if (point.drill) activateDrill(point.drill) }} hint="Select a recorded tool name to list matching sessions." />
        </div>
        <QualityStrip items={[
          { key: 'rejects', label: 'rejects', countText: data.rejectQuality.countText, explanation: data.rejectQuality.explanation, actionHref: data.rejectQuality.available ? '/imports' : undefined, actionLabel: 'View import attempts' },
          { key: 'missing', label: 'missing usage', countText: data.missingUsage.overall.value_text, explanation: data.missingUsage.definition.description, onList: missingDrill ? () => activateDrill(missingDrill) : undefined },
          { key: 'unknown', label: 'unknown timestamps', countText: unknownQuality.countText, explanation: unknownQuality.explanation, onList: unknownDrill ? () => activateDrill(unknownDrill) : undefined },
          { key: 'unlinked', label: 'unlinked tools', countText: data.unlinkedTools.overall.value_text, explanation: data.unlinkedTools.definition.description, onList: unlinkedDrill ? () => activateDrill(unlinkedDrill) : undefined },
        ]} />
      </div>}
    </StateBlock>
    <div data-scope-chips-slot="overview-sessions" />
    <section className="panel" aria-label="Sessions">
      <div className="panel-head"><h2>Sessions</h2><Link to={link('/sessions')} className="with-icon">All sessions in scope<Icon name="arrowRight" /></Link></div>
      <StateBlock loading={sessions.loading} error={sessions.error} retry={sessions.retry} lines={4}>
        {sessions.data && <SessionsTable rows={sessions.data} caption="Sessions in scope" hideCaption empty="No sessions match this scope. Clear the scope or import traces." />}
      </StateBlock>
    </section>
  </>
}
