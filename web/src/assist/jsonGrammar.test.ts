import { describe, expect, it } from 'vitest'
import {
  decodeJsonString,
  isJsonObjectText,
  isOneJsonValue,
  parseJson,
  scan,
  validateJsonText,
} from './jsonGrammar'

const problem = (text: string) => {
  const result = validateJsonText(text)
  if (!('problem' in result)) throw new Error(`expected ${JSON.stringify(text)} to be refused`)
  return result
}

describe('the JSON grammar', () => {
  it('refuses what balanced brackets accept', () => {
    // every one of these is accepted by the old tokenizer in jsonText.ts
    for (const text of [
      '{"x":01}',
      '{"x":1.}',
      '{"x":+1}',
      '{"x":.5}',
      '{"x":1e}',
      '{"x":true false}',
      '{"x":1,}',
      '[1,]',
      '{"x":1} trailing',
      '{"x":/*c*/1}',
      '{"x":"\\q"}',
      '[1}}',
      '{x:1}',
      '{"x"1}',
      '{"x":Infinity}',
      '{"x":NaN}',
      '{"x":-}',
      '',
      '   ',
    ]) {
      expect(validateJsonText(text), text).toHaveProperty('problem')
    }
  })

  it('refuses a raw control character and an unterminated string', () => {
    expect(problem('{"x":"a\nb"}').problem).toMatch(/control character/)
    expect(problem('{"x":"a}').problem).toMatch(/never closed/)
    expect(problem('{"x":"\\u12"}').problem).toMatch(/hexadecimal/)
  })

  it('accepts the JSON the document really contains', () => {
    for (const text of [
      '{}',
      '[]',
      '{"a":{}}',
      '{"a":[]}',
      '  {"a": 1}  ',
      '{"a":\t1,\r\n"b":2}',
      '{"a":1e3,"b":-0,"c":1.0,"d":9007199254740993}',
      '{"a":"\\u0041\\n\\t\\\\\\/"}',
      '{"é😀":0,"b":1}',
      'true',
      'null',
      '-1.5e-9',
    ]) {
      expect(validateJsonText(text), text).toEqual({ ok: true })
    }
  })

  it('reports the offset in UTF-16 code units', () => {
    const text = '{"é😀":0,x}'
    // { " é 😀(2) " : 0 , -> the offending 'x' is at code unit 9, byte 12
    expect(problem(text).offset).toBe(9)
    expect(text.slice(9, 10)).toBe('x')
  })

  it('keeps every lexeme verbatim with its span', () => {
    const text = '{"a": 9007199254740993, "b": 1.0}'
    const scanned = scan(text)
    if ('problem' in scanned) throw new Error(scanned.problem)
    const numbers = scanned.lexemes.filter(lexeme => lexeme.kind === 'number')
    expect(numbers.map(lexeme => lexeme.text)).toEqual(['9007199254740993', '1.0'])
    for (const lexeme of scanned.lexemes) expect(text.slice(lexeme.start, lexeme.end)).toBe(lexeme.text)
  })

  it('decodes keys while keeping their spelling', () => {
    const parsed = parseJson('{"\\u0078": 1}')
    if ('problem' in parsed) throw new Error(parsed.problem)
    if (parsed.root.kind !== 'object') throw new Error('expected an object')
    expect(parsed.root.members[0].key).toBe('x')
    expect(parsed.root.members[0].keyRaw).toBe('"\\u0078"')
    expect(decodeJsonString('"\\u0078"')).toBe('x')
    expect(decodeJsonString('"a\\nb"')).toBe('a\nb')
  })

  it('marks duplicate decoded keys, escaped spellings included', () => {
    const parsed = parseJson('{"x": 1, "\\u0078": 2}')
    if ('problem' in parsed) throw new Error(parsed.problem)
    if (parsed.root.kind !== 'object') throw new Error('expected an object')
    expect(parsed.root.duplicateKeys).toEqual(['x'])
    // JSON.parse keeps the last one; we refuse to choose
    expect(JSON.parse('{"x": 1, "\\u0078": 2}')).toEqual({ x: 2 })
  })

  it('distinguishes one value from an object', () => {
    expect(isOneJsonValue('1.0')).toBe(true)
    expect(isOneJsonValue('{"a":1} ')).toBe(true)
    expect(isOneJsonValue('{"a":1} {"b":2}')).toBe(false)
    expect(isJsonObjectText('[1]')).toBe(false)
    expect(isJsonObjectText('{"a":1}')).toBe(true)
  })
})
