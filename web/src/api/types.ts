// Hand-written DTOs for docs/api/v0.1.md. Dates remain ISO-8601 strings.
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type InputFormat = 'jsonl' | 'parquet'
export interface Page { limit?: number; offset?: number }
export interface Scope { source?: string; agent?: string }
export interface ErrorDetail { code: string; message: string; details: Json[] }
export interface ErrorResponse { error: ErrorDetail }
export interface FileInfo {
  filename: string
  sha256: string
  size_bytes: number
  format: InputFormat
  record_count: number
}
export type FileStatus = 'pending' | 'committed' | 'duplicate' | 'failed'
export interface ImportedFile extends FileInfo {
  mapping: { id: string; name: string; revision: number } | null
  status: FileStatus
  records: Partial<RecordCounts>
}
export type RecordCounts = { accepted: number; partial: number; duplicate: number; rejected: number; ignored: number }
export interface FileBinding { upload_id: string; mapping_id: string }
export interface Upload extends FileInfo {
  upload_id: string
  preview: { locator: string; payload: Json; error?: string | null }[]
  already_imported: { import_id: string; imported_at: string }[]
}
export interface Mapping {
  id: string
  name: string
  source: string
  revision: number
  created_by: string
  input_format: InputFormat
}
export interface MappingIssue {
  stage: string; path: string; code: string; message: string; severity: string
}
export interface MappingDetail extends Mapping { document: { [key: string]: Json }; issues: MappingIssue[] }
export interface PreviewRequest { upload_id: string; mapping_id: string; sample: number }
export type ImportRequest = { upload_id: string; mapping_id: string; source: string } | { source: string; files: FileBinding[] }
export interface Reject {
  locator: string; rule_id: string; path: string; code: string; field: string | null; message: string
  file_sha256?: string
}
export interface ImportReject extends Reject { payload: Json }
export type EntityCounts = Partial<Record<'session' | 'model_call' | 'tool_call', number>>
export interface ImportPreview {
  records: { accepted: number; partial: number; rejected: number; sampled: number }
  entities: EntityCounts
  rejects: Reject[]
  warnings: Record<string, number>
  emissions: { entity: string; path: string; locator: string; fields: { [key: string]: Json } }[]
}
export interface ImportSummary {
  import_id: string
  status: 'committed' | 'duplicate' | 'failed'
  source: string
  mapping: { id: string; name: string; revision: number }
  started_at: string
  finished_at: string
  files: ImportedFile[]
  records: RecordCounts
  entities: EntityCounts
  reject_count: number
  error: string | null
}
export interface ImportReport extends ImportSummary { warnings: Record<string, number> }
export interface Coverage { known: number; total: number }
export interface CoveredValue { value: number | null; coverage: Coverage }
export interface RawReference { file_sha256: string; locator: string }
export interface RawRecord extends RawReference { payload: Json; payload_text: string; derived?: 'parquet-row' | null }
export interface Session {
  id: string
  source: string
  external_id: string
  agent: string | null
  observed_start_at: string | null
  observed_end_at: string | null
  model_call_count: number
  tool_call_count: number
  input_tokens: CoveredValue
}
export interface ModelCall {
  id: string; sequence: number | null; model: string | null
  started_at: string | null; ended_at: string | null
  input_tokens: number | null; output_tokens: number | null; token_semantics: string | null
  raw_record: RawReference
}
export interface ToolCall {
  id: string; model_call_id: string | null; tool_name: string | null
  started_at: string | null; ended_at: string | null
  wall_latency_ms: number | null; is_error: boolean | null
  raw_record: RawReference
}
export interface SessionDetail extends Session {
  declared_started_at: string | null; declared_ended_at: string | null
  repo: string | null; user: string | null
  model_calls: ModelCall[]; tool_calls: ToolCall[]
  diagnostics: { code: string; field: string | null; message: string }[]
}
export interface Metric { value: number | null; definition: string }
export interface MetricsSummary {
  sessions: Metric; model_calls: Metric; tool_calls: Metric
  input_tokens: Metric & CoveredValue & { unit: string; by_semantics: Record<string, number | null> }
}
