import type {
  ImportPreview, ImportReport, Mapping, Metric, MetricDefinition, MetricDrillScope, MetricQuery,
  MetricResult, MetricsSummary, RawRecord, SessionDetail, Upload,
} from '../api'

export const rawRecord: RawRecord = {
  file_sha256: 'd044a766', locator: 'line:1',
  payload_text: `{
  "message": "<script>untrusted trace</script>",
  "native_id": 9007199254740993,
  "nested": {
    "value": 42
  }
}`,
  // The parsed payload models the precision loss in response.json().
  payload: { message: '<script>untrusted trace</script>', native_id: 9007199254740992, nested: { value: 42 } },
}

export const mapping: Mapping = {
  id: 'map_1', name: 'tracelab-v1', source: 'tracelab', revision: 1, created_by: 'bundled', input_format: 'jsonl',
}
export const upload: Upload = {
  upload_id: 'upl_1', filename: 'sample.jsonl.gz', sha256: 'd044a766', size_bytes: 1024,
  format: 'jsonl', record_count: 3,
  preview: [{ locator: 'line:1', payload: { provider: 'claude', session_id: 'native_1' } }],
  already_imported: [{ import_id: 'imp_old', imported_at: '2026-09-07T10:00:00Z' }],
}
export const reject = {
  locator: 'line:3', rule_id: 'tool_call', path: 'tool_call[2]', code: 'invalid_value',
  field: 'wall_latency_ms', message: 'Expected an integer',
}
export const preview: ImportPreview = {
  records: { accepted: 2, partial: 0, rejected: 1, ignored: 0, sampled: 3 },
  entities: { session: 1, model_call: 2, tool_call: 4 }, warnings: { absent: 2 },
  rejects: [reject], emissions: [{ entity: 'model_call', path: 'model_call', locator: 'line:1', fields: { model: 'claude', input_tokens: 17 } }],
}
export const report: ImportReport = {
  import_id: 'imp_1', status: 'committed', source: 'tracelab', mapping: { id: 'map_1', name: 'tracelab-v1', revision: 1 },
  started_at: '2026-09-07T10:00:00Z', finished_at: '2026-09-07T10:00:01Z',
  files: [{ filename: upload.filename, sha256: upload.sha256, size_bytes: 1024, format: 'jsonl', record_count: 3, mapping: { id: 'map_1', name: 'tracelab-v1', revision: 1 }, status: 'committed', records: { accepted: 2, partial: 0, duplicate: 0, rejected: 1, ignored: 0 } }],
  records: { accepted: 2, partial: 0, duplicate: 0, rejected: 1, ignored: 0 },
  entities: preview.entities, warnings: preview.warnings, reject_count: 1, error: null,
}
const metric = (metric_id: string, value_text: string | null, known: number, total: number, unit = 'count'): Metric => ({
  metric_id, version: 1, value: value_text == null ? null : Number(value_text), value_text,
  recorded_sum_text: value_text, definition: `Definition of ${metric_id}`, unit,
  coverage: { known, total }, by_semantics: {}, comparability: unit === 'tokens' ? (known ? 'comparable' : 'unknown') : 'not_applicable',
  reason: known || unit === 'count' ? 'Recorded observations in scope; no equivalent-workload claim.' : 'No known usage in scope.',
  semantics_partitions: [],
})

export const metrics: MetricsSummary = {
  sessions: metric('sessions', '1', 1, 1),
  model_calls: metric('model_calls', '4770', 4770, 4770),
  tool_calls: metric('tool_calls', '0', 0, 0),
  input_tokens: {
    ...metric('input_tokens', null, 2, 2, 'tokens'), value: 553447877,
    recorded_sum_text: '553447877', comparability: 'mixed',
    reason: 'not comparable: 2 token semantics in selection',
    semantics_partitions: [
      { semantics: 'tracelab-claude', value_text: '186454781', coverage: { known: 1, total: 1 } },
      { semantics: 'tracelab-codex', value_text: '366993096', coverage: { known: 1, total: 1 } },
    ],
  },
  output_tokens: metric('output_tokens', '5', 1, 2, 'tokens'),
}

export const metricScope: MetricDrillScope = {
  source: null, agent: null, model: null, tool: null, started_from: null, started_before: null,
  started_through: null, import_id: null, session_ids: null, activity_grain: null,
  token_semantics: null, model_is_unknown: false, agent_is_unknown: false,
  timestamp_missing: false, tool_is_unlinked: false, usage_missing: false,
  tool_is_linked: false, witness_time_override: false, witness_required: false,
  witness_started_from: null, witness_started_before: null, witness_started_through: null,
  witness_timestamp_missing: false,
}

const labels: Record<string, string> = {
  sessions: 'Sessions', model_calls: 'Model-call observations', tool_calls: 'Tool-call observations',
  input_tokens: 'Input usage by accounting group', output_tokens: 'Output tokens',
  missing_usage: 'Missing usage', unknown_timestamps: 'Unknown timestamps',
  unlinked_tools: 'Unlinked tools', imports_in_scope: 'Imports in scope',
  observed_span_ms: 'Observed span in imported data', scheduled_cost_usd: 'Scheduled cost',
  cache_read_tokens: 'Cache-read tokens',
}
export const metricDefinitions: MetricDefinition[] = Object.entries(labels).map(([id, label]) => ({
  id, version: 1, label, description: `Definition of ${id}`,
  grain: id === 'sessions' || id === 'observed_span_ms' ? 'session' : id === 'tool_calls' || id === 'unlinked_tools' ? 'tool_call' : id === 'imports_in_scope' ? 'import' : 'model_call',
  operation: id === 'sessions' || id.includes('calls') || id.includes('usage') || id.includes('timestamps') || id.includes('tools') || id === 'imports_in_scope' ? 'count' : id === 'observed_span_ms' ? 'observed_span' : id === 'scheduled_cost_usd' ? 'cost' : 'sum',
  field: id.endsWith('_tokens') ? id : null, unit: id.endsWith('_tokens') ? 'tokens' : id === 'observed_span_ms' ? 'ms' : id === 'scheduled_cost_usd' ? 'USD' : 'count',
  formula: `Formula for ${id}`, scope: `Population for ${id}`, null_handling: 'Nulls do not become zero.',
  coverage_field: id.endsWith('_tokens') ? id : null,
  semantics_field: id.endsWith('_tokens') || id === 'scheduled_cost_usd' ? 'token_semantics' : null,
  comparability_rule: id.endsWith('_tokens') || id === 'scheduled_cost_usd' ? 'token_semantics' : 'observations',
  population: id === 'missing_usage' ? 'usage_missing' : id === 'unknown_timestamps' ? 'timestamp_missing' : id === 'unlinked_tools' ? 'tool_is_unlinked' : null,
  supported_dimensions: [], headline_kpi: ['sessions', 'model_calls', 'tool_calls', 'input_tokens'].includes(id),
  caveat: id === 'scheduled_cost_usd' ? 'Estimate, not an invoice.' : null,
  quantile_rule: 'nearest-rank', median_rule: 'middle value', display_decimal_places: 0,
  display_rounding: 'half_even', diagnostic: false, model_group_required: false,
})) as MetricDefinition[]

const result = (value_text: string | null, known: number, total: number, reason = 'Recorded observations in scope.'): MetricResult => ({
  value_text, recorded_sum_text: value_text, coverage: { known, total }, comparability: value_text === null ? 'unknown' : 'not_applicable',
  reason, semantics_partitions: [], distribution: null, priced_coverage: null, schedule_version: null,
})
const definitionById = Object.fromEntries(metricDefinitions.map(item => [item.id, item]))
const query = (id: string, overall: MetricResult, buckets: MetricQuery['buckets'] = [], excluded = 0): MetricQuery => ({
  metric_id: id, definition: definitionById[id], supported_dimensions: definitionById[id].supported_dimensions,
  scope: { ...metricScope }, group_by: [], overall, excluded_unknown_timestamps: excluded, buckets,
})

const inputPartition = (semantics: string, value_text: string, model: string) => ({
  semantics, value_text, coverage: { known: 1, total: 1 },
  drill_scope: { ...metricScope, model, token_semantics: semantics, activity_grain: 'model_call' as const },
  distribution: null, priced_coverage: null, schedule_version: null,
})
export const metricQueries: Record<string, MetricQuery> = {
  model_calls: {
    ...query('model_calls', result('2', 2, 2), [
      { keys: ['2026-09-07'], result: result('2', 2, 2), drill_scope: { ...metricScope, started_from: '2026-09-07T00:00:00Z', started_before: '2026-09-08T00:00:00Z', activity_grain: 'model_call' } },
    ]), group_by: ['started_day'],
  },
  input_tokens: {
    ...query('input_tokens', result(null, 2, 2, metrics.input_tokens.reason), [
      { keys: ['claude'], result: { ...result('10', 1, 1), comparability: 'comparable', semantics_partitions: [inputPartition('tracelab-claude', '10', 'claude')] }, drill_scope: { ...metricScope, model: 'claude', activity_grain: 'model_call' } },
    ]), group_by: ['model'],
  },
  output_tokens: {
    ...query('output_tokens', result('5', 1, 2), [
      { keys: ['claude'], result: { ...result('5', 1, 1), comparability: 'comparable', semantics_partitions: [inputPartition('tracelab-claude', '5', 'claude')] }, drill_scope: { ...metricScope, model: 'claude', activity_grain: 'model_call' } },
    ]), group_by: ['model'],
  },
  tool_calls: { ...query('tool_calls', result('1', 1, 1), [
    { keys: ['Agent'], result: result('1', 1, 1), drill_scope: { ...metricScope, tool: 'Agent', activity_grain: 'tool_call' } },
  ]), group_by: ['tool_name'] },
  missing_usage: { ...query('missing_usage', result('1', 1, 1)), scope: { ...metricScope, usage_missing: true, activity_grain: 'model_call' } },
  unknown_timestamps: { ...query('unknown_timestamps', result('0', 0, 0)), scope: { ...metricScope, timestamp_missing: true, activity_grain: 'model_call' } },
  unlinked_tools: { ...query('unlinked_tools', result('0', 0, 0)), scope: { ...metricScope, tool_is_unlinked: true, activity_grain: 'tool_call' } },
  imports_in_scope: query('imports_in_scope', result('1', 1, 1)),
  observed_span_ms: query('observed_span_ms', result('60000', 1, 1)),
  scheduled_cost_usd: query('scheduled_cost_usd', {
    ...result(null, 0, 2, 'No recorded tokens have both a rate and validated billing semantics.'),
    priced_coverage: { known: 0, total: 15, known_text: '0', total_text: '15' }, schedule_version: 'openrouter-v1',
  }),
  cache_read_tokens: query('cache_read_tokens', result(null, 0, 2, 'No known cache-read tokens in scope.')),
}
export const session: SessionDetail = {
  id: 'ses_1', source: 'tracelab', external_id: 'claude:native_1', agent: 'claude-code',
  observed_start_at: '2026-09-07T09:00:00Z', observed_end_at: null,
  model_call_count: 1, tool_call_count: 1, input_tokens: metric('input_tokens', null, 0, 1, 'tokens'),
  declared_started_at: null, declared_ended_at: null, repo: 'project_1', user: null,
  model_calls: [{ id: 'mc_1', sequence: 0, model: 'claude', started_at: null, ended_at: null,
    input_tokens: null, output_tokens: 5, token_semantics: 'tracelab-claude', raw_record: { file_sha256: 'd044a766', locator: 'line:1' } }],
  tool_calls: [{ id: 'tc_1', model_call_id: 'mc_1', tool_name: 'Agent', started_at: null, ended_at: null,
    wall_latency_ms: 0, is_error: false, raw_record: { file_sha256: 'd044a766', locator: 'line:2' } }],
  diagnostics: [{ code: 'conflicting_value', field: 'agent', message: 'Conflicting agent values' }],
}
