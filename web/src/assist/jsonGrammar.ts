/**
 * JSON *text* read as JSON, not as balanced brackets.
 *
 * The mapping document is edited and sent as text so that numbers keep the exact lexemes the
 * user or the server wrote (`1.0` stays `1.0`, 2^53+1 stays itself). Editing text safely needs
 * more than the tokenizer in `jsonText.ts`, which accepts `{"x":01}`, `{"x":1,}` and
 * `{"x":1} trailing`: an edit is only sound when the input really is one JSON value, when a key
 * is matched by its *decoded* name (`"x"` is `x`), and when duplicate keys are refused
 * rather than silently resolved differently from `JSON.parse` (which keeps the last one).
 *
 * All offsets are **UTF-16 code units** — the units of `String.prototype.slice` and
 * `String.length` — not bytes: after `{"é😀":0,` the next lexeme starts at code unit 9.
 */

export interface Lexeme {
  kind: 'punct' | 'string' | 'number' | 'literal'
  text: string
  start: number
  /** Exclusive. */
  end: number
}

export interface Failure {
  problem: string
  offset: number
}

export interface JsonMember {
  /** The decoded key: `"x"` is `x`. */
  key: string
  /** The key as written, quotes included; only spans are ever spliced, so spelling survives. */
  keyRaw: string
  keyStart: number
  keyEnd: number
  value: JsonNode
  /** Member span: the first character of the key to the last character of the value. */
  start: number
  end: number
}

export type JsonNode =
  | { kind: 'object'; start: number; end: number; members: JsonMember[]; duplicateKeys: string[] }
  | { kind: 'array'; start: number; end: number; elements: JsonNode[] }
  | { kind: 'string' | 'number' | 'literal'; start: number; end: number }

const WHITESPACE = new Set([' ', '\t', '\n', '\r'])
const PUNCT = new Set(['{', '}', '[', ']', ':', ','])
const SHORT_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't'])
const HEX = /^[0-9a-fA-F]$/
// JSON numbers: no leading +, no leading zeros, no bare '.', no 'Infinity'.
const NUMBER = /-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/y
// A number may not be glued to another token: `01`, `1.`, `1e`, `1abc` are all errors.
const NUMBER_TAIL = /[0-9A-Za-z.+-]/

function scanString(text: string, from: number): { end: number } | Failure {
  let i = from + 1
  while (i < text.length) {
    const c = text[i]
    if (c === '"') return { end: i + 1 }
    if (c === '\\') {
      const next = text[i + 1]
      if (next === undefined) return { problem: 'The string ends inside an escape', offset: i }
      if (next === 'u') {
        for (let k = i + 2; k < i + 6; k += 1) {
          if (text[k] === undefined || !HEX.test(text[k])) {
            return { problem: 'A \\u escape needs four hexadecimal digits', offset: i }
          }
        }
        i += 6
        continue
      }
      if (!SHORT_ESCAPES.has(next)) {
        return { problem: `\\${next} is not a JSON escape`, offset: i }
      }
      i += 2
      continue
    }
    if (c.codePointAt(0)! < 0x20) {
      return { problem: 'A raw control character must be escaped inside a string', offset: i }
    }
    i += 1
  }
  return { problem: 'The string is never closed', offset: from }
}

/** Every lexeme of `text`, or the first place it stops being JSON. */
export function scan(text: string): { lexemes: Lexeme[] } | Failure {
  const lexemes: Lexeme[] = []
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (WHITESPACE.has(c)) {
      i += 1
      continue
    }
    if (PUNCT.has(c)) {
      lexemes.push({ kind: 'punct', text: c, start: i, end: i + 1 })
      i += 1
      continue
    }
    if (c === '"') {
      const scanned = scanString(text, i)
      if ('problem' in scanned) return scanned
      lexemes.push({ kind: 'string', text: text.slice(i, scanned.end), start: i, end: scanned.end })
      i = scanned.end
      continue
    }
    if (c === '-' || (c >= '0' && c <= '9')) {
      NUMBER.lastIndex = i
      const matched = NUMBER.exec(text)
      if (matched === null || matched.index !== i) {
        return { problem: 'A number needs at least one digit', offset: i }
      }
      const end = i + matched[0].length
      const tail = text[end]
      if (tail !== undefined && NUMBER_TAIL.test(tail)) {
        return { problem: `${JSON.stringify(text.slice(i, end + 1))} is not a JSON number`, offset: i }
      }
      lexemes.push({ kind: 'number', text: matched[0], start: i, end })
      i = end
      continue
    }
    const word = ['true', 'false', 'null'].find(candidate => text.startsWith(candidate, i))
    if (word !== undefined) {
      lexemes.push({ kind: 'literal', text: word, start: i, end: i + word.length })
      i += word.length
      continue
    }
    return { problem: `Unexpected character ${JSON.stringify(c)}`, offset: i }
  }
  return { lexemes }
}

/** The decoded value of a string lexeme (quotes included in `raw`). */
export function decodeJsonString(raw: string): string {
  return JSON.parse(raw) as string
}

/**
 * How deep a document may nest before it is a repair rather than a table.
 *
 * The recursive descent below would otherwise overflow the stack on input the browser's own
 * JSON.parse accepts, and that RangeError would escape a state update and take the draft with it.
 * 512 is far past anything the DSL produces (a rule's deepest option is four levels).
 */
export const MAX_DEPTH = 512

interface Cursor {
  at: number
  depth: number
}

function parseValue(text: string, lexemes: Lexeme[], cursor: Cursor): JsonNode | Failure {
  const lexeme = lexemes[cursor.at]
  if (lexeme === undefined) return { problem: 'A value is missing', offset: text.length }
  if (lexeme.kind !== 'punct') {
    cursor.at += 1
    const kind = lexeme.kind === 'string' ? 'string' : lexeme.kind === 'number' ? 'number' : 'literal'
    return { kind, start: lexeme.start, end: lexeme.end }
  }
  if (lexeme.text === '{' || lexeme.text === '[') {
    if (cursor.depth >= MAX_DEPTH) {
      return { problem: `values are nested more than ${MAX_DEPTH} deep here`, offset: lexeme.start }
    }
    cursor.depth += 1
    const node = lexeme.text === '{' ? parseObject(text, lexemes, cursor) : parseArray(text, lexemes, cursor)
    cursor.depth -= 1
    return node
  }
  return { problem: `${lexeme.text} cannot start a value`, offset: lexeme.start }
}

function parseObject(text: string, lexemes: Lexeme[], cursor: Cursor): JsonNode | Failure {
  const open = lexemes[cursor.at]
  cursor.at += 1
  const members: JsonMember[] = []
  const seen = new Set<string>()
  const duplicateKeys: string[] = []
  if (lexemes[cursor.at]?.kind === 'punct' && lexemes[cursor.at].text === '}') {
    const close = lexemes[cursor.at]
    cursor.at += 1
    return { kind: 'object', start: open.start, end: close.end, members, duplicateKeys }
  }
  for (;;) {
    const key = lexemes[cursor.at]
    if (key === undefined || key.kind !== 'string') {
      return { problem: 'An object member needs a quoted key', offset: key?.start ?? text.length }
    }
    const colon = lexemes[cursor.at + 1]
    if (colon === undefined || colon.kind !== 'punct' || colon.text !== ':') {
      return { problem: 'A key must be followed by ":"', offset: colon?.start ?? text.length }
    }
    cursor.at += 2
    const value = parseValue(text, lexemes, cursor)
    if ('problem' in value) return value
    const decoded = decodeJsonString(key.text)
    if (seen.has(decoded)) {
      if (!duplicateKeys.includes(decoded)) duplicateKeys.push(decoded)
    } else {
      seen.add(decoded)
    }
    members.push({
      key: decoded,
      keyRaw: key.text,
      keyStart: key.start,
      keyEnd: key.end,
      value,
      start: key.start,
      end: value.end,
    })
    const next = lexemes[cursor.at]
    if (next === undefined || next.kind !== 'punct') {
      return { problem: 'An object needs "," or "}" after a member', offset: next?.start ?? text.length }
    }
    if (next.text === ',') {
      cursor.at += 1
      const after = lexemes[cursor.at]
      if (after !== undefined && after.kind === 'punct' && after.text === '}') {
        return { problem: 'A trailing comma is not JSON', offset: next.start }
      }
      continue
    }
    if (next.text === '}') {
      cursor.at += 1
      return { kind: 'object', start: open.start, end: next.end, members, duplicateKeys }
    }
    return { problem: `Expected "," or "}", found ${next.text}`, offset: next.start }
  }
}

function parseArray(text: string, lexemes: Lexeme[], cursor: Cursor): JsonNode | Failure {
  const open = lexemes[cursor.at]
  cursor.at += 1
  const elements: JsonNode[] = []
  if (lexemes[cursor.at]?.kind === 'punct' && lexemes[cursor.at].text === ']') {
    const close = lexemes[cursor.at]
    cursor.at += 1
    return { kind: 'array', start: open.start, end: close.end, elements }
  }
  for (;;) {
    const value = parseValue(text, lexemes, cursor)
    if ('problem' in value) return value
    elements.push(value)
    const next = lexemes[cursor.at]
    if (next === undefined || next.kind !== 'punct') {
      return { problem: 'An array needs "," or "]" after a value', offset: next?.start ?? text.length }
    }
    if (next.text === ',') {
      cursor.at += 1
      const after = lexemes[cursor.at]
      if (after !== undefined && after.kind === 'punct' && after.text === ']') {
        return { problem: 'A trailing comma is not JSON', offset: next.start }
      }
      continue
    }
    if (next.text === ']') {
      cursor.at += 1
      return { kind: 'array', start: open.start, end: next.end, elements }
    }
    return { problem: `Expected "," or "]", found ${next.text}`, offset: next.start }
  }
}

/** The tree of one JSON value, with the span of every node; nothing is parsed into JS values. */
export function parseJson(text: string): { root: JsonNode } | Failure {
  const scanned = scan(text)
  if ('problem' in scanned) return scanned
  if (scanned.lexemes.length === 0) return { problem: 'There is no JSON value here', offset: 0 }
  const cursor: Cursor = { at: 0, depth: 0 }
  const root = parseValue(text, scanned.lexemes, cursor)
  if ('problem' in root) return root
  const extra = scanned.lexemes[cursor.at]
  if (extra !== undefined) {
    return { problem: 'There is more than one JSON value here', offset: extra.start }
  }
  return { root }
}

/** True when `text` is exactly one JSON value, with only JSON whitespace around it. */
export function isOneJsonValue(text: string): boolean {
  return !('problem' in parseJson(text))
}

/** True when `text` is exactly one JSON *object*. */
export function isJsonObjectText(text: string): boolean {
  const parsed = parseJson(text)
  return !('problem' in parsed) && parsed.root.kind === 'object'
}

/** `{ ok: true }`, or the first place the text stops being one JSON value. */
export function validateJsonText(text: string): { ok: true } | Failure {
  const parsed = parseJson(text)
  return 'problem' in parsed ? parsed : { ok: true }
}
