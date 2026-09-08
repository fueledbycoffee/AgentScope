import { rawValueOf, scanDocument, valueSpanAt } from './document'

/**
 * Lossless helpers over JSON *text*. The mapping document is edited and sent as text so numbers
 * keep the exact lexemes the user or the server wrote (`1.0` stays `1.0`, 2^53+1 stays itself);
 * nothing here parses numbers. The permissive tokenizer below now drives only pretty-printing,
 * which never sees text the grammar in `jsonGrammar.ts` has not accepted first; addressing (the
 * proposal's mapping, the line of a validation-issue path) goes through that grammar.
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

/**
 * The raw text of `proposal.mapping` inside a run response, exactly as the server wrote it, or
 * null when the response has no proposal, is not valid JSON, or resolves its keys ambiguously.
 *
 * Addressing goes through the grammar in `document.ts`, so an escaped envelope key
 * (`{"proposal": …}`) is found and a response with two `proposal` members is refused
 * instead of being resolved differently from the server.
 */
export function extractMappingText(rawResponse: string): string | null {
  return rawValueOf(rawResponse, ['proposal', 'mapping'])
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

/**
 * 1-based line of the value at `path`, or null when the path is absent — or when the document is
 * not valid JSON, since the grammar refuses to guess a location inside text it cannot read. The
 * caller says so rather than doing nothing: a missing member has no line either way.
 */
export function lineFor(text: string, path: string): number | null {
  const tree = scanDocument(text)
  if ('problem' in tree) return null
  const span = valueSpanAt(tree, pathSegments(path))
  return span === null ? null : text.slice(0, span.start).split('\n').length
}
