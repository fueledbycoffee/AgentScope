import { describe, expect, it } from 'vitest'
import { envelopeWithRawJson, extractMappingText, lineFor, prettyJson, tokenize } from './jsonText'

const DOC = '{"dsl_version":1,"rules":[{"id":"session","fields":{"external_id":{"path":"$.s"}}},{"id":"model_call","fields":{"started_at":{"path":"$.ts","timestamp_format":"epoch_ms"},"n":9007199254740993,"f":1.0}}],"unmapped":[{"path":"$.x","reason":"r"}]}'

describe('lossless JSON text helpers', () => {
  it('pretty-prints without touching a single lexeme', () => {
    const pretty = prettyJson(DOC)
    expect(pretty).toContain('"n": 9007199254740993')
    expect(pretty).toContain('"f": 1.0')
    expect(pretty.split('\n').length).toBeGreaterThan(10)
    expect(tokenize(pretty).map(t => t.text)).toEqual(tokenize(DOC).map(t => t.text))
    expect(prettyJson('{"a":[],"b":{}}')).toBe('{\n  "a": [],\n  "b": {}\n}')
    expect(prettyJson('"a \\"quoted\\" string"')).toBe('"a \\"quoted\\" string"')
  })

  it('extracts the proposal mapping verbatim from a raw run response', () => {
    const raw = `{"proposal":{"mapping":${DOC},"explanations":[{"target":"a","path":"$.mapping","why":"x","confidence":1}],"model":"m"},"issues":[],"attempts":2,"diagnostics":{"raw_text":"{\\"mapping\\": {}}"}}`
    expect(extractMappingText(raw)).toBe(DOC)
    expect(extractMappingText('{"proposal":null,"issues":[]}')).toBeNull()
    expect(extractMappingText('{"issues":[]}')).toBeNull()
  })

  it('builds an envelope around raw JSON text', () => {
    expect(envelopeWithRawJson({ kind: 'revise', n: 1 }, 'current_mapping', '{"f":1.0}')).toBe('{"kind":"revise","n":1,"current_mapping":{"f":1.0}}')
    expect(envelopeWithRawJson({}, 'document', '[1.0]')).toBe('{"document":[1.0]}')
  })

  it('finds the line of a path through objects and array indices', () => {
    const pretty = prettyJson(DOC)
    const lines = pretty.split('\n')
    const at = (path: string) => { const n = lineFor(pretty, path); return n === null ? null : lines[n - 1].trim() }
    expect(at('rules[0].id')).toBe('"id": "session",')
    expect(at('rules[1].id')).toBe('"id": "model_call",')
    expect(at('rules[1].fields.started_at.timestamp_format')).toBe('"timestamp_format": "epoch_ms"')
    expect(at('unmapped[0].reason')).toBe('"reason": "r"')
    expect(at('$')).toBe('{')
    expect(at('rules[7].id')).toBeNull()
    expect(at('nope')).toBeNull()
    expect(lineFor('not json', 'a')).toBeNull()
  })
})
