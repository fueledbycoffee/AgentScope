import type {
  AssistantOutcome, AssistantRequest, ErrorDetail, ImportPreview, ImportReject, ImportReport, ImportRequest,
  ImportSummary, Json, Mapping, MappingDetail, MetricsSummary, Page, PreparedContext, PreviewRequest,
  ProfileReport, RawRecord, RecordRow, RejectSummary, RawReference, SavedMapping, Scope, Session,
  SessionDetail, Upload, ValidationResult,
} from './types'
export type * from './types'
import { envelopeWithRawJson, prettyJson } from '../assist/jsonText'
import { rawValueOf } from '../assist/document'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: ErrorDetail['details']
  constructor(status: number, error: ErrorDetail) {
    super(error.message)
    this.name = 'ApiError'
    this.status = status
    this.code = error.code
    this.details = error.details
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, options)
  if (!response.ok) {
    let error: ErrorDetail = { code: 'http_error', message: `Request failed (${response.status})`, details: [] }
    try {
      const body = await response.json()
      if (typeof body?.error?.code === 'string' && typeof body.error.message === 'string') {
        error = { ...body.error, details: Array.isArray(body.error.details) ? body.error.details : [] }
      }
    } catch { /* Proxies may return a non-JSON error page. */ }
    throw new ApiError(response.status, error)
  }
  return response.json() as Promise<T>
}

function query(params: Page & Scope & { code?: string; rule_id?: string; outcome?: string; file_sha256?: string; locator?: string } = {}) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  return search.size ? `?${search}` : ''
}
const post = (body: unknown): RequestInit => ({
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
export function uploadFile(file: File) {
  const body = new FormData()
  body.append('file', file)
  return request<Upload>('/uploads', { method: 'POST', body })
}
export const listMappings = (page?: Page) => request<Mapping[]>(`/mappings${query(page)}`)
export const getMapping = (id: string) => request<MappingDetail>(`/mappings/${encodeURIComponent(id)}`)
export const previewImport = (body: PreviewRequest) => request<ImportPreview>('/imports/preview', post(body))
export const commitImport = (body: ImportRequest) => request<ImportReport>('/imports', post(body))
export const listImports = (page?: Page) => request<ImportSummary[]>(`/imports${query(page)}`)
export const getImport = (id: string) => request<ImportReport>(`/imports/${encodeURIComponent(id)}`)
export const listRejects = (id: string, params?: Page & { code?: string; rule_id?: string; file_sha256?: string }) =>
  request<ImportReject[]>(`/imports/${encodeURIComponent(id)}/rejects${query(params)}`)
export const getRejectSummary = (id: string) => request<RejectSummary>(`/imports/${encodeURIComponent(id)}/rejects/summary`)
export const listRecords = (id: string, params?: Page & { outcome?: string; file_sha256?: string }) =>
  request<RecordRow[]>(`/imports/${encodeURIComponent(id)}/records${query(params)}`)
export const listSessions = (params?: Page & Scope) => request<Session[]>(`/sessions${query(params)}`)
export const getSession = (id: string) => request<SessionDetail>(`/sessions/${encodeURIComponent(id)}`)
export const getRawRecord = (reference: RawReference) => request<RawRecord>(`/raw-records${query(reference)}`)
export const getMetricsSummary = (scope?: Scope) => request<MetricsSummary>(`/metrics/summary${query(scope)}`)

// --- mapping assistant -----------------------------------------------------------------------
export const profileUpload = (uploadId: string) =>
  request<ProfileReport>(`/uploads/${encodeURIComponent(uploadId)}/profile`, { method: 'POST' })
/**
 * Assistant requests: `current_mapping` is the editor's text embedded verbatim (never parsed and
 * re-serialised by the browser), so the server sees exactly the numbers the user wrote.
 */
export interface AssistantRequestText extends Omit<AssistantRequest, 'current_mapping'> { current_mapping_text?: string | null }
function assistantBody(body: AssistantRequestText, extra: Record<string, unknown> = {}): RequestInit {
  const { current_mapping_text, ...fields } = body
  if (current_mapping_text) assertOneJsonObject(current_mapping_text)
  const json = current_mapping_text
    ? envelopeWithRawJson({ ...fields, ...extra }, 'current_mapping', current_mapping_text)
    : JSON.stringify({ ...fields, ...extra })
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json }
}
export const prepareContext = async (body: AssistantRequestText) => request<PreparedContext>('/assistant/prepare', assistantBody(body))
/** The parsed outcome plus the raw response text, from which the proposal's mapping is taken verbatim. */
export async function runAssistant(body: AssistantRequestText, contextSha256: string): Promise<{ outcome: AssistantOutcome; rawText: string }> {
  const response = await fetch('/api/assistant/run', assistantBody(body, { context_sha256: contextSha256 }))
  const rawText = await response.text()
  if (!response.ok) {
    let error: ErrorDetail = { code: 'http_error', message: `Request failed (${response.status})`, details: [] }
    try {
      const parsed = JSON.parse(rawText)
      if (typeof parsed?.error?.code === 'string' && typeof parsed.error.message === 'string') {
        error = { ...parsed.error, details: Array.isArray(parsed.error.details) ? parsed.error.details : [] }
      }
    } catch { /* non-JSON error page */ }
    throw new ApiError(response.status, error)
  }
  return { outcome: JSON.parse(rawText) as AssistantOutcome, rawText }
}
/**
 * A saved mapping with its document as *text*, taken from the response bytes.
 *
 * `getMapping` parses the body, which rounds every large integer and rewrites `1.0` as `1` before
 * the editor ever sees it. Reopening a saved revision to correct it has to start from what the
 * server actually sent.
 */
export async function getMappingText(id: string): Promise<{ record: MappingDetail; documentText: string }> {
  const response = await fetch(`/api/mappings/${encodeURIComponent(id)}`)
  const rawText = await response.text()
  if (!response.ok) {
    let error: ErrorDetail = { code: 'http_error', message: `Request failed (${response.status})`, details: [] }
    try {
      const parsed = JSON.parse(rawText)
      if (typeof parsed?.error?.code === 'string' && typeof parsed.error.message === 'string') {
        error = { ...parsed.error, details: Array.isArray(parsed.error.details) ? parsed.error.details : [] }
      }
    } catch { /* non-JSON error page */ }
    throw new ApiError(response.status, error)
  }
  const documentText = rawValueOf(rawText, ['document'])
  if (documentText === null) throw new Error('The saved mapping could not be read as text from the response')
  return { record: JSON.parse(rawText) as MappingDetail, documentText: prettyJson(documentText) }
}
export const getMappingSchema = () => request<{ [key: string]: Json }>('/mappings/schema')
/**
 * The editor's text is embedded as-is inside the request envelope, so numbers travel exactly as the
 * user typed them (no browser parse/re-serialise between the editor and the server).
 */
function assertOneJsonObject(text: string): void {
  // JSON.parse rejects trailing content, so `}, "notes": …` after a document cannot leak into the
  // envelope as a sibling property; the parsed value is discarded (the text is what travels)
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch (error) { throw new Error(`The document is not valid JSON: ${(error as Error).message}`) }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The document must be a single JSON object')
}
const rawDocumentBody = (documentText: string): RequestInit => {
  assertOneJsonObject(documentText)
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: `{"document":${documentText}}` }
}
// async so a malformed document rejects instead of throwing synchronously
export const validateMappingText = async (documentText: string) =>
  request<ValidationResult>('/mappings/validate', rawDocumentBody(documentText))
export const saveMappingText = async (documentText: string) => request<SavedMapping>('/mappings', rawDocumentBody(documentText))
