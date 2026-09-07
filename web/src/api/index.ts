import type {
  AssistantOutcome, AssistantRequest, ErrorDetail, ImportPreview, ImportReject, ImportReport, ImportRequest,
  ImportSummary, Json, Mapping, MappingDetail, MetricsSummary, Page, PreparedContext, PreviewRequest,
  ProfileReport, RawRecord, RecordRow, RejectSummary, RawReference, SavedMapping, Scope, Session,
  SessionDetail, Upload, ValidationResult,
} from './types'
export type * from './types'

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
export const prepareContext = (body: AssistantRequest) => request<PreparedContext>('/assistant/prepare', post(body))
export const runAssistant = (body: AssistantRequest, contextSha256: string) =>
  request<AssistantOutcome>('/assistant/run', post({ ...body, context_sha256: contextSha256 }))
export const getMappingSchema = () => request<{ [key: string]: Json }>('/mappings/schema')
/**
 * The editor's text is embedded as-is inside the request envelope, so numbers travel exactly as the
 * user typed them (no browser parse/re-serialise between the editor and the server).
 */
const rawDocumentBody = (documentText: string): RequestInit => ({
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: `{"document":${documentText}}`,
})
export const validateMappingText = (documentText: string) =>
  request<ValidationResult>('/mappings/validate', rawDocumentBody(documentText))
export const saveMappingText = (documentText: string) => request<SavedMapping>('/mappings', rawDocumentBody(documentText))
