/**
 * Lossless helpers over JSON *text*. The mapping document is edited and sent as text so numbers
 * keep the exact lexemes the user or the server wrote (`1.0` stays `1.0`, 2^53+1 stays itself);
 * nothing here parses numbers. A small tokenizer drives pretty-printing, extraction of the
 * proposal's mapping from a raw response, and locating the line of a validation-issue path.
 */

export type Token =
  | { kind: 'punct'; text: '{' | '}' | '[' | ']' | ':' | ','; offset: number }
  | { kind: 'string'; text: string; offset: number }
  | { kind: 'scalar'; text: string; offset: number } // number, true, false, null: copied verbatim

export function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === ' ' || c === '\n' || c === '\r' || c === '\t') { i += 1; continue }
    if (c === '{' || c === '}' || c === '[' || c === ']' || c === ':' || c === ',') {
      tokens.push({ kind: 'punct', text: c, offset: i })
      i += 1
      continue
    }
    if (c === '"') {
      let j = i + 1
      while (j < text.length) {
        if (text[j] === '\\') { j += 2; continue }
        if (text[j] === '"') break
        j += 1
      }
      if (j >= text.length) throw new SyntaxError(`Unterminated string at ${i}`)
      tokens.push({ kind: 'string', text: text.slice(i, j + 1), offset: i })
      i = j + 1
      continue
    }
    let j = i
    while (j < text.length && !' \n\r\t{}[]:,"'.includes(text[j])) j += 1
    if (j === i) throw new SyntaxError(`Unexpected character ${JSON.stringify(c)} at ${i}`)
    tokens.push({ kind: 'scalar', text: text.slice(i, j), offset: i })
    i = j
  }
  return tokens
}

/** Re-indent JSON text without parsing any value: every string and scalar lexeme is copied. */
export function prettyJson(text: string, indent = 2): string {
  const tokens = tokenize(text)
  const pad = (depth: number) => ' '.repeat(indent * depth)
  let out = ''
  let depth = 0
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    const next = tokens[i + 1]
    if (token.kind === 'punct') {
      if (token.text === '{' || token.text === '[') {
        const closing = token.text === '{' ? '}' : ']'
        if (next?.kind === 'punct' && next.text === closing) { out += token.text + closing; i += 1; continue }
        depth += 1
        out += `${token.text}\n${pad(depth)}`
      } else if (token.text === '}' || token.text === ']') {
        depth -= 1
        out += `\n${pad(depth)}${token.text}`
      } else if (token.text === ',') {
        out += `,\n${pad(depth)}`
      } else {
        out += ': '
      }
    } else {
      out += token.text
    }
  }
  return out
}

/** The text of the balanced value starting at `tokens[start]`, sliced from the original text. */
function valueSpan(text: string, tokens: Token[], start: number): { text: string; end: number } {
  const first = tokens[start]
  if (first.kind !== 'punct') return { text: first.text, end: start }
  let depth = 0
  for (let i = start; i < tokens.length; i += 1) {
    const t = tokens[i]
    if (t.kind !== 'punct') continue
    if (t.text === '{' || t.text === '[') depth += 1
    if (t.text === '}' || t.text === ']') {
      depth -= 1
      if (depth === 0) return { text: text.slice(first.offset, t.offset + 1), end: i }
    }
  }
  throw new SyntaxError('Unbalanced JSON')
}

/**
 * The raw text of `proposal.mapping` inside a run response, exactly as the server wrote it,
 * or null when the response has no proposal.
 */
export function extractMappingText(rawResponse: string): string | null {
  const tokens = tokenize(rawResponse)
  // walk the top-level object: find key "proposal", then inside it key "mapping"
  const findKey = (from: number, to: number, key: string): number | null => {
    let depth = 0
    for (let i = from; i <= to; i += 1) {
      const t = tokens[i]
      if (t.kind === 'punct') {
        if (t.text === '{' || t.text === '[') depth += 1
        else if (t.text === '}' || t.text === ']') depth -= 1
        continue
      }
      if (depth === 1 && t.kind === 'string' && t.text === JSON.stringify(key) && tokens[i + 1]?.kind === 'punct' && tokens[i + 1].text === ':') {
        return i + 2
      }
    }
    return null
  }
  const proposalAt = findKey(0, tokens.length - 1, 'proposal')
  if (proposalAt === null) return null
  const proposal = tokens[proposalAt]
  if (proposal.kind === 'scalar') return null // null
  const proposalEnd = valueSpan(rawResponse, tokens, proposalAt).end
  const mappingAt = findKey(proposalAt, proposalEnd, 'mapping')
  if (mappingAt === null) return null
  return valueSpan(rawResponse, tokens, mappingAt).text
}

/** Build a request envelope whose `document` (or another key) is the given text, verbatim. */
export function envelopeWithRawJson(fields: Record<string, unknown>, rawKey: string, rawJson: string): string {
  const head = JSON.stringify(fields)
  return head === '{}' ? `{${JSON.stringify(rawKey)}:${rawJson}}` : `${head.slice(0, -1)},${JSON.stringify(rawKey)}:${rawJson}}`
}

/** Segments of a validation-issue path such as `rules[1].fields.started_at.bounds`. */
export function pathSegments(path: string): (string | number)[] {
  const segments: (string | number)[] = []
  for (const match of path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) {
    if (match[1] !== undefined && match[1] !== '$') segments.push(match[1])
    else if (match[2] !== undefined) segments.push(Number(match[2]))
  }
  return segments
}

/** 1-based line of the value at `path` in the text, following objects and array indices; null if absent. */
export function lineFor(text: string, path: string): number | null {
  const wanted = pathSegments(path)
  let tokens: Token[]
  try { tokens = tokenize(text) } catch { return null }
  if (tokens.length === 0) return null
  const lineAt = (offset: number) => text.slice(0, offset).split('\n').length

  // descend token by token: at each level, find the segment then continue inside its value
  let start = 0
  for (const segment of wanted) {
    const container = tokens[start]
    if (container.kind !== 'punct') return null
    const end = valueSpan(text, tokens, start).end
    let found: number | null = null
    if (container.text === '{' && typeof segment === 'string') {
      let depth = 0
      for (let i = start; i <= end; i += 1) {
        const t = tokens[i]
        if (t.kind === 'punct') {
          if (t.text === '{' || t.text === '[') depth += 1
          else if (t.text === '}' || t.text === ']') depth -= 1
          continue
        }
        if (depth === 1 && t.kind === 'string' && t.text === JSON.stringify(segment) && tokens[i + 1]?.kind === 'punct' && tokens[i + 1].text === ':') { found = i + 2; break }
      }
    } else if (container.text === '[' && typeof segment === 'number') {
      let depth = 0
      let index = 0
      for (let i = start + 1; i <= end; i += 1) {
        const t = tokens[i]
        if (depth === 0 && (t.kind !== 'punct' || t.text === '{' || t.text === '[')) {
          if (index === segment) { found = i; break }
          if (t.kind === 'punct') { i = valueSpan(text, tokens, i).end }
          index += 1
          continue
        }
        if (t.kind === 'punct') {
          if (t.text === '{' || t.text === '[') depth += 1
          else if (t.text === '}' || t.text === ']') depth -= 1
        }
      }
    }
    if (found === null) return null
    start = found
  }
  return lineAt(tokens[start].offset)
}
