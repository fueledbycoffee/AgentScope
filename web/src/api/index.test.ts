import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError, commitImport, getImport, getMapping, getMetricsSummary, getRawRecord,
  getSession, listImports, listMappings, listRejects, listSessions, previewImport, uploadFile,
} from './index'
import { mapping, metrics, preview, rawRecord, reject, report, session, upload } from '../test/fixtures'

const fetchMock = vi.fn<typeof fetch>()
function respond(body: unknown, status = 200) {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }))
}
afterEach(() => { vi.unstubAllGlobals(); fetchMock.mockReset() })

describe('API contract', () => {
  it('uses same-origin API paths, encoded identifiers, filters, and pagination for every read endpoint', async () => {
    const mappingDetail = { ...mapping, document: { dsl_version: 1 }, issues: [] }
    const raw = { ...rawRecord, file_sha256: 'hash&bytes', locator: 'line:1+2' }
    const cases: [() => Promise<unknown>, string, unknown][] = [
      [() => listMappings({ limit: 50, offset: 0 }), '/api/mappings?limit=50&offset=0', [mapping]],
      [() => getMapping('map/1'), '/api/mappings/map%2F1', mappingDetail],
      [() => listImports({ limit: 50, offset: 50 }), '/api/imports?limit=50&offset=50', [{ ...report, warnings: undefined }]],
      [() => getImport('imp/1'), '/api/imports/imp%2F1', report],
      [() => listRejects('imp/1', { code: 'invalid value', limit: 50, offset: 0 }), '/api/imports/imp%2F1/rejects?code=invalid+value&limit=50&offset=0', [{ ...reject, payload: {} }]],
      [() => listSessions({ source: 'a&b', agent: '', limit: 50, offset: 0 }), '/api/sessions?source=a%26b&limit=50&offset=0', [session]],
      [() => getSession('ses/1'), '/api/sessions/ses%2F1', session],
      [() => getRawRecord({ file_sha256: raw.file_sha256, locator: raw.locator }), '/api/raw-records?file_sha256=hash%26bytes&locator=line%3A1%2B2', raw],
      [() => getMetricsSummary({ agent: 'claude code' }), '/api/metrics/summary?agent=claude+code', metrics],
    ]
    for (const [call, url, body] of cases) {
      respond(body)
      expect(await call()).toEqual(JSON.parse(JSON.stringify(body)))
      expect(fetchMock).toHaveBeenLastCalledWith(url, undefined)
    }
  })

  it('sends the exact upload, preview, and commit request bodies', async () => {
    const file = new File(['{}'], 'trace.jsonl')
    respond(upload)
    expect(await uploadFile(file)).toEqual(upload)
    const uploadRequest = fetchMock.mock.lastCall![1]!
    expect(fetchMock.mock.lastCall![0]).toBe('/api/uploads')
    expect(uploadRequest.method).toBe('POST')
    expect(Array.from((uploadRequest.body as FormData).keys())).toEqual(['file'])
    expect((uploadRequest.body as FormData).get('file')).toBe(file)
    expect(uploadRequest.headers).toBeUndefined()
    const previewRequest = { upload_id: 'upl_1', mapping_id: 'map_1', sample: 200 }
    respond(preview)
    expect(await previewImport(previewRequest)).toEqual(preview)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/imports/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(previewRequest) })
    const importRequest = { upload_id: 'upl_1', mapping_id: 'map_1', source: 'tracelab' }
    respond(report)
    expect(await commitImport(importRequest)).toEqual(report)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/imports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(importRequest) })
  })

  it.each([400, 404, 409, 413])('preserves status, code, message, and details in ApiError for HTTP %i', async status => {
    const error = { code: 'contract_error', message: 'Cannot complete request', details: [{ stage: 'semantic', path: 'rules[0]', code: 'missing_field', message: 'Identity required', severity: 'error' }] }
    respond({ error }, status)
    const result = await getImport('imp_1').catch(cause => cause)
    expect(result).toBeInstanceOf(ApiError)
    expect(result).toMatchObject({ status, ...error })
  })

  it('returns a typed fallback error when a proxy sends HTML instead of JSON', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502 }))
    await expect(getMetricsSummary()).rejects.toMatchObject({ name: 'ApiError', status: 502, code: 'http_error', details: [] })
  })
})
