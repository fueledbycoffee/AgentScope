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
  duplicate_of?: string | null
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
export type RecordOutcome = 'accepted' | 'partial' | 'duplicate' | 'rejected' | 'ignored'
export interface RecordRow { file_sha256: string; locator: string; outcome: RecordOutcome; entity_counts: EntityCounts; warning_counts: Record<string, number> }
export interface RejectSummary { codes: Record<string, number>; rules: Record<string, number>; files: Record<string, number>; outcomes: Partial<Record<RecordOutcome, number>> }
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
// Token counts can exceed Number.MAX_SAFE_INTEGER. Use the text fields for display
// and exact arithmetic; known/total are potentially rounded compatibility aliases.
export interface TokenCoverage extends Coverage { known_text: string; total_text: string }
export interface MetricDrillScope {
  source: string | null
  agent: string | null
  model: string | null
  tool: string | null
  started_from: string | null
  started_before: string | null
  import_id: string | null
  session_ids: string[] | null
  activity_grain: 'model_call' | 'tool_call' | null
  token_semantics: string | null
  model_is_unknown: boolean
  agent_is_unknown: boolean
  timestamp_missing: boolean
  tool_is_unlinked: boolean
  usage_missing: boolean
  tool_is_linked: boolean
  witness_time_override: boolean
  witness_required: boolean
  witness_started_from: string | null
  witness_started_before: string | null
  witness_timestamp_missing: boolean
}
export interface MetricDistribution {
  count: number
  min_text: string
  median_text: string
  p90_text: string
  max_text: string
}
export interface MetricPartition {
  semantics: string
  value_text: string | null
  coverage: Coverage
  drill_scope: MetricDrillScope
  distribution: MetricDistribution | null
  priced_coverage: TokenCoverage | null
  schedule_version: string | null
}
export interface MetricResult {
  value_text: string | null
  recorded_sum_text: string | null
  coverage: Coverage
  comparability: 'comparable' | 'mixed' | 'unknown' | 'not_applicable'
  reason: string
  semantics_partitions: MetricPartition[]
  distribution: MetricDistribution | null
  priced_coverage: TokenCoverage | null
  schedule_version: string | null
}
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

// --- mapping assistant (docs/api/v0.1.md, ADR-005) -------------------------------------------
export interface FieldStat {
  path: string
  selector: string
  relative: string
  depth: number
  records: number
  missing: number
  values: number
  nulls: number
  types: { [kind: string]: number }
  distinct: number
  distinct_capped: boolean
  examples: Json[]
  min: Json
  max: Json
  min_length: number | null
  max_length: number | null
  hints: string[]
  wrapper: { kind: string; units: { [u: string]: number }; tz: { [z: string]: number }; accessors: string[] } | null
}
export interface FieldProfile {
  version: number
  inspected: number
  total_records: number
  nodes_visited: number
  truncated: { [limit: string]: number }
  redactions: { [reason: string]: number }
  coverage_sample: number[]
  fields: FieldStat[]
  unaddressable: { parent: string; key: string; reason: string }[]
  withheld: { parent: string; reason: string }[]
}
export interface ProfileReport { upload_id: string; profile: FieldProfile; cached: boolean }
export interface ChatHistoryTurn { role: 'user' | 'assistant'; content: string }
export interface AssistantRequest {
  kind: 'propose' | 'revise'
  upload_id: string
  identity: { name: string; source: string }
  include_sample?: boolean
  current_mapping?: { [key: string]: Json } | null
  message?: string | null
  history?: ChatHistoryTurn[]
}
export interface PreparedContext {
  kind: 'propose' | 'revise'
  context_sha256: string
  bytes: number
  payload_text: string
  payload: { [key: string]: Json }
  redactions: { [reason: string]: number }
  truncated: { [step: string]: number }
  sample_included: boolean
  sample_count: number
}
export interface FieldExplanation { target: string; path: string; why: string; confidence: number }
export interface Ambiguity { target: string; options: string[]; what_settles_it: string }
export interface MappingProposal {
  mapping: { [key: string]: Json }
  explanations: FieldExplanation[]
  ambiguities: Ambiguity[]
  questions: string[]
  model: string
  executable: boolean
}
export interface AssistantOutcome {
  proposal: MappingProposal | null
  issues: MappingIssue[]
  attempts: number
  diagnostics: {
    finish: string
    model: string
    raw_text: string
    failure: string | null
    adapter_notes?: string[]
    context_sha256: string
    sample_included: boolean
  }
}
export interface ValidationResult { issues: MappingIssue[]; executable: boolean }
export interface SavedMapping extends Mapping { created: boolean }
