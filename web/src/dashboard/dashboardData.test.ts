import { beforeEach, describe, expect, it, vi } from 'vitest'
import { metricDefinitions, metricQueries, metrics } from '../test/fixtures'
import {
  activityPoints, displayFromResult, displayFromSummary, loadDashboard, tokenRows,
  toolPoints,
} from './dashboardData'

const api = vi.hoisted(() => ({
  getMetricsSummary: vi.fn(),
  getMetricDefinitions: vi.fn(),
  getScopeFacets: vi.fn(),
  listImports: vi.fn(),
  queryMetric: vi.fn(),
}))

vi.mock('../api', () => api)

beforeEach(() => {
  vi.clearAllMocks()
  api.getMetricsSummary.mockResolvedValue(metrics)
  api.getMetricDefinitions.mockResolvedValue(metricDefinitions)
  api.getScopeFacets.mockResolvedValue({ sources: ['tracelab'], agents: ['codex'], models: ['claude'] })
  api.listImports.mockResolvedValue([])
  api.queryMetric.mockImplementation((id: string) => Promise.resolve(metricQueries[id]))
})

describe('dashboard query recipe', () => {
  it('uses every documented metric recipe and the full public scope', async () => {
    const scope = {
      source: 'tracelab', agent: 'codex', model: 'claude', tool: 'Read',
      started_from: '2026-09-02T00:00:00.000Z', started_before: '2026-09-09T00:00:00.000Z',
      token_semantics: 'tracelab-codex', witness_required: true,
    } as const
    await loadDashboard(scope)

    expect(api.getMetricsSummary).toHaveBeenCalledWith(scope)
    expect(api.getScopeFacets).toHaveBeenCalledWith(scope)
    expect(api.queryMetric.mock.calls.map(([id, group]) => [id, group])).toEqual([
      ['model_calls', ['started_day']], ['input_tokens', ['model']], ['output_tokens', ['model']],
      ['tool_calls', ['tool_name']], ['missing_usage', []], ['unknown_timestamps', []],
      ['unlinked_tools', []], ['imports_in_scope', []], ['observed_span_ms', []],
      ['scheduled_cost_usd', []], ['cache_read_tokens', []],
    ])
    for (const [id, , passed] of api.queryMetric.mock.calls) {
      if (id === 'unknown_timestamps') {
        expect(passed).toEqual(expect.objectContaining({ source: 'tracelab', tool: 'Read', witness_required: true }))
        expect(passed).not.toHaveProperty('started_from')
        expect(passed).not.toHaveProperty('started_before')
      } else {
        expect(passed).toEqual(scope)
      }
    }
  })

  it('does not ask the import ledger to attribute rejects to a canonical child scope', async () => {
    const data = await loadDashboard({ agent: 'codex' })
    expect(data.rejectQuality).toEqual({
      countText: null,
      available: false,
      explanation: 'Rejects cannot be attributed to this canonical scope.',
    })
    expect(api.listImports).not.toHaveBeenCalled()
  })

  it('pages the source-level import ledger and sums exact matching rejects', async () => {
    api.listImports
      .mockResolvedValueOnce(Array.from({ length: 500 }, (_, index) => ({ source: index % 2 ? 'other' : 'tracelab', reject_count: 1 })))
      .mockResolvedValueOnce([{ source: 'tracelab', reject_count: 3 }])
    const data = await loadDashboard({ source: 'tracelab' })
    expect(data.rejectQuality.countText).toBe('253')
    expect(api.listImports).toHaveBeenNthCalledWith(1, { limit: 500, offset: 0 })
    expect(api.listImports).toHaveBeenNthCalledWith(2, { limit: 500, offset: 500 })
  })
})

describe('lossless dashboard adapters', () => {
  it('keeps mixed partitions exact without exposing the pooled recorded sum', () => {
    const display = displayFromSummary(metrics.input_tokens)
    expect(display.valueText).toBeNull()
    expect(display.recordedSumText).toBe('553447877')
    expect(display.partitions.map(item => item.valueText)).toEqual(['186454781', '366993096'])
  })

  it('keeps a null measure unavailable rather than turning it into zero', () => {
    const display = displayFromResult(metricQueries.cache_read_tokens.overall)
    expect(display.valueText).toBeNull()
    expect(display.recordedSumText).toBeNull()
    expect(display.coverage).toEqual({ known: 0, total: 2 })
  })

  it('uses Number only for geometry while exact text remains unchanged', () => {
    const query = {
      ...metricQueries.model_calls,
      buckets: [{
        ...metricQueries.model_calls.buckets[0],
        result: { ...metricQueries.model_calls.buckets[0].result, value_text: '9007199254740993', recorded_sum_text: '9007199254740993' },
      }],
    }
    const [point] = activityPoints(query)
    expect(point.valueText).toBe('9007199254740993')
    expect(point.plotValue).toBe(Number('9007199254740993'))
  })

  it('uses ordered bucket keys and partition scopes to drive labels and drills', () => {
    const [activity] = activityPoints(metricQueries.model_calls)
    expect(activity.key).toBe(metricQueries.model_calls.buckets[0].keys[0])
    expect(activity.drill?.scope.started_from).toBe('2026-09-07T00:00:00Z')
    const [tokens] = tokenRows(metricQueries.input_tokens, metricQueries.output_tokens)
    expect(tokens.label).toBe('claude · tracelab-claude')
    expect(tokens.input?.drill?.scope.token_semantics).toBe('tracelab-claude')
    expect(tokens.output?.valueText).toBe('5')
  })

  it('keeps a bucket visible when its 241-character label cannot form a drill envelope', () => {
    const label = 'x'.repeat(241)
    const query = {
      ...metricQueries.tool_calls,
      buckets: [{
        ...metricQueries.tool_calls.buckets[0],
        keys: [label],
        drill_scope: { ...metricQueries.tool_calls.buckets[0].drill_scope, tool: label },
      }],
    }

    expect(toolPoints(query)).toEqual([expect.objectContaining({ key: label, label, drill: undefined })])
  })
})
