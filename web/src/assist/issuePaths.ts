/**
 * The parser's issue paths, resolved to the control that owns them.
 *
 * The paths are the domain parser's own (`rules[0].id`, `rules[0].fields.started_at.bounds`,
 * `rules[0].fields.x.transforms[2]`, `rules[0].where[1].value`, `unmapped[0].reason`,
 * `dsl_version`, `$`). They are built by concatenating unescaped keys, so a field literally named
 * `a.b` is indistinguishable from a nested path: such a path resolves to the document rather than
 * to a guessed control, and the issue opens the JSON view instead.
 */
import { pathSegments } from './jsonText'
import { FIELD_OPTIONS, type DocIndex, type FieldOption } from './documentIndex'

export type Control =
  | { kind: 'document' }
  | { kind: 'head'; key: string }
  | { kind: 'rule'; ruleIndex: number; part: 'id' | 'entity' | 'select' | 'parent' | 'native_key' | 'fields' | 'where' }
  | { kind: 'condition'; ruleIndex: number; index: number; part: 'path' | 'op' | 'value' }
  | { kind: 'field-source'; ruleIndex: number; field: string; part: 'path' | 'paths' | 'literal' }
  | { kind: 'field-option'; ruleIndex: number; field: string; option: FieldOption }
  | { kind: 'transform'; ruleIndex: number; field: string; index: number }
  | { kind: 'unmapped'; index: number; part: 'path' | 'reason' }

const OPTIONS = new Set<string>(FIELD_OPTIONS)
const RULE_PARTS = new Set(['id', 'entity', 'select', 'parent', 'native_key', 'fields', 'where'])

/**
 * The control an issue points at; `{kind: 'document'}` whenever the path cannot be trusted.
 *
 * Pass the indexed document whenever there is one: the parser builds these paths by joining
 * unescaped keys, so `rules[0].fields.wall_latency_ms.type` is either the `type` option of
 * `wall_latency_ms` or the field literally named `wall_latency_ms.type`, and only the document
 * knows which. The longest field name it really has wins; when it has neither, the issue stays on
 * the rule rather than marking a field that is not there.
 */
export function resolveIssue(path: string, index?: DocIndex): Control {
  const segments = pathSegments(path)
  if (segments.length === 0) return { kind: 'document' }
  const [head, ...rest] = segments

  if (head === 'unmapped' && typeof rest[0] === 'number') {
    const part = rest[1]
    if (rest.length === 2 && (part === 'path' || part === 'reason')) {
      return { kind: 'unmapped', index: rest[0], part }
    }
    return { kind: 'document' }
  }
  if (head !== 'rules') {
    return rest.length === 0 && typeof head === 'string' ? { kind: 'head', key: head } : { kind: 'document' }
  }

  const ruleIndex = rest[0]
  if (typeof ruleIndex !== 'number') return { kind: 'document' }
  const tail = rest.slice(1)
  if (tail.length === 0) return { kind: 'rule', ruleIndex, part: 'id' }

  const first = tail[0]
  if (typeof first !== 'string') return { kind: 'document' }
  if (first === 'where') {
    const index = tail[1]
    const part = tail[2]
    if (typeof index !== 'number') return { kind: 'rule', ruleIndex, part: 'where' }
    if (tail.length === 2) return { kind: 'condition', ruleIndex, index, part: 'path' }
    if (tail.length === 3 && (part === 'path' || part === 'op' || part === 'value')) {
      return { kind: 'condition', ruleIndex, index, part }
    }
    return { kind: 'document' }
  }
  if (first === 'fields') {
    const rest = tail.slice(1)
    if (rest.length === 0) return { kind: 'rule', ruleIndex, part: 'fields' }
    const known = index?.rules[ruleIndex]?.fields.map(field => field.name)
    // the parser joins unescaped keys, so one path can name more than one field this document has:
    // `a.type` is the type option of `a` *and* the field literally called `a.type`, and the parser
    // emits the same string for both. Where two readings are possible neither may be chosen.
    const readings: Control[] = []
    for (let take = rest.length; take >= 1; take -= 1) {
      const head = rest.slice(0, take)
      if (!head.every(segment => typeof segment === 'string')) continue
      const field = head.join('.')
      if (known !== undefined && !known.includes(field)) continue
      if (known === undefined && take > 1) continue // no document to ask: only the plain reading
      const resolved = insideField(ruleIndex, field, rest.slice(take))
      if (resolved !== null) readings.push(resolved)
    }
    if (readings.length === 1) return readings[0]
    if (readings.length > 1) return { kind: 'document' } // ambiguous: the JSON view is the honest answer
    // the document has no such field: the issue belongs to the rule, not to a guessed control
    return known === undefined ? { kind: 'document' } : { kind: 'rule', ruleIndex, part: 'fields' }
  }
  if (tail.length === 1 && RULE_PARTS.has(first)) {
    return { kind: 'rule', ruleIndex, part: first as 'id' }
  }
  return { kind: 'document' }
}

/** What follows a field name inside its path: a source member, an option, or a transform. */
function insideField(ruleIndex: number, field: string, rest: (string | number)[]): Control | null {
  if (rest.length === 0) return { kind: 'field-source', ruleIndex, field, part: 'path' }
  const option = rest[0]
  if (typeof option !== 'string') return null
  if (rest.length === 1) {
    if (option === 'path' || option === 'paths' || option === 'literal') {
      return { kind: 'field-source', ruleIndex, field, part: option }
    }
    if (OPTIONS.has(option)) return { kind: 'field-option', ruleIndex, field, option: option as FieldOption }
    return null
  }
  if (rest.length === 2 && option === 'transforms' && typeof rest[1] === 'number') {
    return { kind: 'transform', ruleIndex, field, index: rest[1] }
  }
  // deeper still (unit.from, an unknown key): the JSON view is the honest answer
  return null
}

/**
 * An injective encoding defined for every UTF-16 string, unpaired surrogates included.
 *
 * `encodeURIComponent` throws `URIError` on a lone surrogate — and a document really can carry
 * `"\ud800"` as a key — while replacing its `%` would map `a b` and `a_20b` onto one id. Every
 * character outside `[A-Za-z0-9_-]` becomes `$` plus its four-digit code unit, the escape marker
 * itself included, so two different names can never share an id and the common names stay legible.
 */
const part = (value: string | number) =>
  String(value).replace(/[^A-Za-z0-9_-]/g, character => `$${character.charCodeAt(0).toString(16).padStart(4, '0')}`)

/** A DOM id that survives keys containing dots, brackets and spaces. */
export function controlId(control: Control): string | null {
  switch (control.kind) {
    case 'document':
      return null
    case 'head':
      return `ctl-head-${part(control.key)}`
    case 'rule':
      return `ctl-r${control.ruleIndex}-${part(control.part)}`
    case 'condition':
      return `ctl-r${control.ruleIndex}-w${control.index}-${part(control.part)}`
    case 'field-source':
      return `ctl-r${control.ruleIndex}-f${part(control.field)}-src-${part(control.part)}`
    case 'field-option':
      return `ctl-r${control.ruleIndex}-f${part(control.field)}-opt-${part(control.option)}`
    case 'transform':
      return `ctl-r${control.ruleIndex}-f${part(control.field)}-tr${control.index}`
    case 'unmapped':
      return `ctl-u${control.index}-${part(control.part)}`
  }
}

/** The id of the control an issue path points at, or null when only the JSON view can show it. */
export const controlIdFor = (path: string, index?: DocIndex): string | null => controlId(resolveIssue(path, index))
