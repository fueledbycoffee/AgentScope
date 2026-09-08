import {
  getMetricDefinitions, getMetricsSummary, getScopeFacets, listImports, queryMetric,
} from '../api'
import type {
  ApiTraceScope, Coverage, MetricBucket, MetricDefinition, MetricPartition, MetricQuery,
  MetricResult, MetricsSummary, ScopeFacets,
} from '../api'
import { createDrillEnvelope } from '../scope'
import type { DrillEnvelopeV1 } from '../scope'
import type { UrlScope } from '../scope'
import type { Dimension } from '../components/bars'
import { accountingGroupLabel } from '../components/accounting'

export interface RejectQuality {
  countText: string | null
  explanation: string
  available: boolean
}

export interface DashboardData {
  summary: MetricsSummary
  definitions: Record<string, MetricDefinition>
  facets: ScopeFacets
  activity: MetricQuery
  inputByModel: MetricQuery
  outputByModel: MetricQuery
  tools: MetricQuery
  missingUsage: MetricQuery
  unknownTimestamps: MetricQuery
  unlinkedTools: MetricQuery
  importsInScope: MetricQuery
  observedSpan: MetricQuery
  scheduledCost: MetricQuery
  cacheReadTokens: MetricQuery
  rejectQuality: RejectQuality
}

export interface ChartPoint {
  key: string
  label: string
  valueText: string
  plotValue: number
  coverage: Coverage
  drill?: DrillEnvelopeV1
}

export interface TokenMeasure {
  valueText: string | null
  plotValue: number | null
  coverage: Coverage
  drill?: DrillEnvelopeV1
}

export interface TokenRow {
  key: string
  label: string
  model: string | null
  semantics: string
  input?: TokenMeasure
  output?: TokenMeasure
}

export function scopeDimensions(facets: ScopeFacets | undefined, scope: UrlScope): Dimension[] {
  const options = (values: readonly string[] | undefined, current: string | undefined) => (
    current && !values?.includes(current) ? [current, ...(values ?? [])] : [...(values ?? [])]
  )
  return [
    { key: 'source', label: 'Source', options: options(facets?.sources, scope.source) },
    { key: 'agent', label: 'Agent', options: options(facets?.agents, scope.agent) },
    { key: 'model', label: 'Model', options: options(facets?.models, scope.model) },
    { key: 'period', label: 'Period (UTC)', options: ['7d', '30d', '90d'] },
  ]
}

function exactPoint(bucket: MetricBucket, label: 'day' | 'tool'): ChartPoint[] {
  const key = bucket.keys[0]
  const valueText = bucket.result.value_text
  if (typeof key !== 'string' || valueText === null) return []
  const drill = createDrillEnvelope(label, key, bucket.drill_scope)
  return [{ key, label: key, valueText, plotValue: Number(valueText), coverage: bucket.result.coverage, drill }]
}

export const activityPoints = (query: MetricQuery) => query.buckets.flatMap(bucket => exactPoint(bucket, 'day'))
export const toolPoints = (query: MetricQuery) => query.buckets.flatMap(bucket => exactPoint(bucket, 'tool'))

function tokenMeasure(partition: MetricPartition, model: string | null): TokenMeasure {
  const modelLabel = model ?? 'Unknown model'
  return {
    valueText: partition.value_text,
    plotValue: partition.value_text === null ? null : Number(partition.value_text),
    coverage: partition.coverage,
    drill: createDrillEnvelope('accounting', `${modelLabel} · ${accountingGroupLabel(partition.semantics)}`, partition.drill_scope),
  }
}

export function tokenRows(input: MetricQuery, output: MetricQuery): TokenRow[] {
  const rows = new Map<string, TokenRow>()
  const collect = (query: MetricQuery, series: 'input' | 'output') => {
    for (const bucket of query.buckets) {
      const model = typeof bucket.keys[0] === 'string' ? bucket.keys[0] : null
      for (const partition of bucket.result.semantics_partitions) {
        const key = `${model ?? '\u0000'}\u0000${partition.semantics}`
        const row = rows.get(key) ?? {
          key,
          label: `${model ?? 'Unknown model'} · ${accountingGroupLabel(partition.semantics)}`,
          model,
          semantics: partition.semantics,
        }
        row[series] = tokenMeasure(partition, model)
        rows.set(key, row)
      }
    }
  }
  collect(input, 'input')
  collect(output, 'output')
  return [...rows.values()]
}

function withoutDirectDates(scope: ApiTraceScope): ApiTraceScope {
  const result = { ...scope }
  delete result.started_from
  delete result.started_before
  delete result.started_through
  return result
}

async function rejectQuality(scope: ApiTraceScope): Promise<RejectQuality> {
  if (Object.keys(scope).some(key => key !== 'source')) {
    return {
      countText: null,
      available: false,
      explanation: 'Rejects cannot be attributed to this canonical scope.',
    }
  }
  try {
    let offset = 0
    let total = 0
    while (true) {
      const page = await listImports({ limit: 500, offset })
      total += page.filter(item => !scope.source || item.source === scope.source)
        .reduce((sum, item) => sum + item.reject_count, 0)
      if (page.length < 500) break
      offset += 500
    }
    return {
      countText: String(total),
      available: true,
      explanation: 'Rejected source records in matching import attempts; rejects are pre-canonical.',
    }
  } catch {
    return {
      countText: null,
      available: false,
      explanation: 'Reject accounting is temporarily unavailable; canonical metrics remain valid.',
    }
  }
}

export async function loadDashboard(scope: ApiTraceScope): Promise<DashboardData> {
  const [
    summary, definitionRows, facets, activity, inputByModel, outputByModel, tools,
    missingUsage, unknownTimestamps, unlinkedTools, importsInScope, observedSpan,
    scheduledCost, cacheReadTokens, rejects,
  ] = await Promise.all([
    getMetricsSummary(scope),
    getMetricDefinitions(),
    getScopeFacets(scope),
    queryMetric('model_calls', ['started_day'], scope),
    queryMetric('input_tokens', ['model'], scope),
    queryMetric('output_tokens', ['model'], scope),
    queryMetric('tool_calls', ['tool_name'], scope),
    queryMetric('missing_usage', [], scope),
    queryMetric('unknown_timestamps', [], withoutDirectDates(scope)),
    queryMetric('unlinked_tools', [], scope),
    queryMetric('imports_in_scope', [], scope),
    queryMetric('observed_span_ms', [], scope),
    queryMetric('scheduled_cost_usd', [], scope),
    queryMetric('cache_read_tokens', [], scope),
    rejectQuality(scope),
  ])
  return {
    summary,
    definitions: Object.fromEntries(definitionRows.map(definition => [definition.id, definition])),
    facets,
    activity,
    inputByModel,
    outputByModel,
    tools,
    missingUsage,
    unknownTimestamps,
    unlinkedTools,
    importsInScope,
    observedSpan,
    scheduledCost,
    cacheReadTokens,
    rejectQuality: rejects,
  }
}

export function displayFromSummary(metric: MetricsSummary[keyof MetricsSummary]) {
  return {
    valueText: metric.value_text,
    recordedSumText: metric.recorded_sum_text,
    coverage: metric.coverage,
    comparability: metric.comparability,
    reason: metric.reason,
    partitions: metric.semantics_partitions.map(partition => ({
      semantics: partition.semantics,
      valueText: partition.value_text,
      coverage: partition.coverage,
    })),
  }
}

export function displayFromResult(metric: MetricResult) {
  return {
    valueText: metric.value_text,
    recordedSumText: metric.recorded_sum_text,
    coverage: metric.coverage,
    comparability: metric.comparability,
    reason: metric.reason,
    partitions: metric.semantics_partitions.map(partition => ({
      semantics: partition.semantics,
      valueText: partition.value_text,
      coverage: partition.coverage,
    })),
    pricedCoverage: metric.priced_coverage,
    scheduleVersion: metric.schedule_version,
  }
}
