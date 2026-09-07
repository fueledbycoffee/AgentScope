import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareContext, saveMappingText, validateMappingText } from './index'

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
