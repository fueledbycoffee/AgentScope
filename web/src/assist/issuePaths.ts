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
import { FIELD_OPTIONS, type FieldOption } from './documentIndex'

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

/** The control an issue points at; `{kind: 'document'}` whenever the path cannot be trusted. */
export function resolveIssue(path: string): Control {
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
    const field = tail[1]
    if (field === undefined) return { kind: 'rule', ruleIndex, part: 'fields' }
    if (typeof field !== 'string') return { kind: 'document' }
    const option = tail[2]
    if (tail.length === 2) return { kind: 'field-source', ruleIndex, field, part: 'path' }
    if (tail.length === 3 && typeof option === 'string') {
      if (option === 'path' || option === 'paths' || option === 'literal') {
        return { kind: 'field-source', ruleIndex, field, part: option }
      }
      if (OPTIONS.has(option)) return { kind: 'field-option', ruleIndex, field, option: option as FieldOption }
    }
    if (tail.length === 4 && option === 'transforms' && typeof tail[3] === 'number') {
      return { kind: 'transform', ruleIndex, field, index: tail[3] }
    }
    // deeper (unit.from, an unknown key, a dotted field name): the JSON view is the honest answer
    return { kind: 'document' }
  }
  if (tail.length === 1 && RULE_PARTS.has(first)) {
    return { kind: 'rule', ruleIndex, part: first as 'id' }
  }
  return { kind: 'document' }
}

const part = (value: string | number) => encodeURIComponent(String(value)).replaceAll('%', '_')

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
export const controlIdFor = (path: string): string | null => controlId(resolveIssue(path))
