import { afterEach, describe, expect, it, vi } from 'vitest'
import { getMetricsSummary, getScopeFacets, listSessions, prepareContext, queryMetric, saveMappingText, validateMappingText } from './index'

afterEach(() => vi.unstubAllGlobals())

describe('documents travel as text, but only whole JSON objects', () => {
  it('refuses trailing content that would become an envelope property', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(validateMappingText('{"dsl_version": 1}, "notes": "kept?"')).rejects.toThrow(/not valid JSON/)
    await expect(saveMappingText('[1]')).rejects.toThrow(/single JSON object/)
    await expect(prepareContext({ kind: 'revise', upload_id: 'u', identity: { name: 'n', source: 's' }, current_mapping_text: '{} {}' })).rejects.toThrow(/not valid JSON/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('embeds the text verbatim when it is one object', async () => {
    const fetchMock = vi.fn(async () => new Response('{"issues":[],"executable":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await validateMappingText('{"literal": 1.0, "big": 9007199254740993}')
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(init.body).toBe('{"document":{"literal": 1.0, "big": 9007199254740993}}')
  })
})

describe('metric scope serialization', () => {
  it('allowlists every public field, repeats dimensions in order, and omits false/private values', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const unsafe = {
      source: 'trace & lab', model: 'm/1', tool: 'Read', started_from: '2026-01-01T00:00:00Z',
      model_is_unknown: false, tool_is_linked: true, witness_required: true,
      session_ids: ['private'], surprise: 'never',
    }
    await queryMetric('input_tokens', ['model', 'agent'], unsafe)
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost')
    expect(url.searchParams.getAll('group_by')).toEqual(['model', 'agent'])
    expect(url.searchParams.get('source')).toBe('trace & lab')
    expect(url.searchParams.get('tool_is_linked')).toBe('true')
    expect(url.searchParams.has('model_is_unknown')).toBe(false)
    expect(url.searchParams.has('session_ids')).toBe(false)
    expect(url.searchParams.has('surprise')).toBe(false)
  })

  it('uses the same serializer for summary, facets, and paginated sessions', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await getMetricsSummary({ agent: 'codex', usage_missing: true })
    await getScopeFacets({ agent: 'codex', usage_missing: true })
    await listSessions({ agent: 'codex', usage_missing: true, limit: 8, offset: 0 })
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/metrics/summary?agent=codex&usage_missing=true',
      '/api/metrics/facets?agent=codex&usage_missing=true',
      '/api/sessions?agent=codex&usage_missing=true&limit=8&offset=0',
    ])
  })
})
