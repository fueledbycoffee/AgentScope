import type { ImportPreview, ImportReport, Mapping, MetricsSummary, RawRecord, SessionDetail, Upload } from '../api'

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
  records: { accepted: 2, partial: 0, rejected: 1, sampled: 3 },
  entities: { session: 1, model_call: 2, tool_call: 4 }, warnings: { absent: 2 },
  rejects: [reject], emissions: [{ entity: 'model_call', path: 'model_call', locator: 'line:1', fields: { model: 'claude', input_tokens: 17 } }],
}
export const report: ImportReport = {
  import_id: 'imp_1', status: 'committed', source: 'tracelab', mapping: { id: 'map_1', name: 'tracelab-v1', revision: 1 },
  started_at: '2026-09-07T10:00:00Z', finished_at: '2026-09-07T10:00:01Z',
  files: [{ filename: upload.filename, sha256: upload.sha256, size_bytes: 1024, format: 'jsonl', record_count: 3 }],
  records: { accepted: 2, partial: 0, duplicate: 0, rejected: 1, ignored: 0 },
  entities: preview.entities, warnings: preview.warnings, reject_count: 1, error: null,
}
export const metrics: MetricsSummary = {
  sessions: { value: 1, definition: 'Distinct sessions in scope' },
  model_calls: { value: 2, definition: 'Recorded model-call observations in scope' },
  tool_calls: { value: 0, definition: 'Recorded tool-call observations in scope' },
  input_tokens: { value: null, coverage: { known: 0, total: 2 }, unit: 'tokens',
    definition: 'Sum of known input tokens; semantics per token_semantics', by_semantics: {} },
}
export const session: SessionDetail = {
  id: 'ses_1', source: 'tracelab', external_id: 'claude:native_1', agent: 'claude-code',
  observed_start_at: '2026-09-07T09:00:00Z', observed_end_at: null,
  model_call_count: 1, tool_call_count: 1, input_tokens: { value: null, coverage: { known: 0, total: 1 } },
  declared_started_at: null, declared_ended_at: null, repo: 'project_1', user: null,
  model_calls: [{ id: 'mc_1', sequence: 0, model: 'claude', started_at: null, ended_at: null,
    input_tokens: null, output_tokens: 5, token_semantics: 'tracelab-claude', raw_record: { file_sha256: 'd044a766', locator: 'line:1' } }],
  tool_calls: [{ id: 'tc_1', model_call_id: 'mc_1', tool_name: 'Agent', started_at: null, ended_at: null,
    wall_latency_ms: 0, is_error: false, raw_record: { file_sha256: 'd044a766', locator: 'line:2' } }],
  diagnostics: [{ code: 'conflicting_value', field: 'agent', message: 'Conflicting agent values' }],
}
