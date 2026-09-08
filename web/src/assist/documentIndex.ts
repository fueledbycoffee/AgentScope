/**
 * The mapping document read as rows: an *indexed view* over the canonical text.
 *
 * Nothing here rebuilds a document. Structure comes from the span tree, and every value a cell
 * shows is the exact source text at its path, so `9007199254740993` and `1.0` are displayed as
 * they were written. Four states are distinguished everywhere and never collapsed: absent
 * (`raw === null`), `null`, `false` and empty. Keys the DSL does not name are kept as `extras`
 * with their paths — the parser only warns about them and saved documents keep them — and a
 * section the table cannot represent carries a `malformed` reason instead of being rewritten.
 */
import { nodeAt, rawAt, scanDocument, type DocPath, type DocTree } from './document'

export const FIELD_OPTIONS = [
  'type',
  'timestamp_format',
  'unit',
  'bounds',
  'empty_as_missing',
  'on_missing',
  'default',
  'on_invalid',
] as const
export type FieldOption = (typeof FIELD_OPTIONS)[number]

const SOURCE_KINDS = ['path', 'paths', 'literal'] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

const HEAD_KEYS = ['dsl_version', 'target_schema_version', 'name', 'source', 'input_format'] as const
export type HeadKey = (typeof HEAD_KEYS)[number]

const DOC_KEYS = new Set<string>([...HEAD_KEYS, 'rules', 'unmapped', 'notes'])
const RULE_KEYS = new Set(['id', 'entity', 'select', 'where', 'parent', 'native_key', 'fields'])
const FIELD_KEYS = new Set<string>([...SOURCE_KINDS, 'transforms', ...FIELD_OPTIONS])

/** One addressable member: `raw` is its source text, or null when the member is absent. */
export interface Member {
  path: DocPath
  raw: string | null
}

export interface TransformView {
  index: number
  path: DocPath
  raw: string
  /** `"trim"` and `{"trim": {}}` are both legal and neither is converted into the other. */
  form: 'short' | 'object' | 'malformed'
  name: string | null
  /** `enum_map`'s policy member, addressed so the UI never parses the entry itself. */
  enumMapUnmapped: Member | null
}

export interface ConditionView {
  index: number
  path: DocPath
  pathMember: Member
  op: Member
  value: Member
}

export interface FieldView {
  name: string
  path: DocPath
  /** Several present kinds is a conflict the parser refuses; it is shown, never silently fixed. */
  source: { present: SourceKind[]; members: Record<SourceKind, Member>; paths: Member[] | null }
  transforms: TransformView[] | null
  /** Present but not a JSON array: the section is repaired in the JSON view, never overwritten. */
  transformsProblem: string | null
  /** The same, for an ordered `paths` that is not a list. */
  pathsProblem: string | null
  options: Record<FieldOption, Member>
  /** `unit` addressed as the ordered pair it is, with whatever else the object holds. */
  unit: { from: Member; to: Member; keys: string[] | null }
  /** `unit` present but not an object: repaired in the JSON view, never rebuilt. */
  unitProblem: string | null
  extras: Member[]
  malformed: string | null
}

export interface RuleView {
  index: number
  path: DocPath
  id: Member
  entity: Member
  select: Member
  parent: Member
  where: ConditionView[] | null
  whereProblem: string | null
  nativeKeyProblem: string | null
  /** `native_key` absent and `native_key: []` are different declarations. */
  nativeKey: { present: boolean; items: Member[] }
  fields: FieldView[]
  extras: Member[]
  malformed: string | null
}

export interface UnmappedView {
  index: number
  path: DocPath
  pathMember: Member
  reason: Member
}

export interface DocIndex {
  ok: boolean
  /** Why the document cannot be indexed at all; the repair view is then the only view. */
  problem: string | null
  offset: number | null
  duplicates: DocPath[]
  head: Record<HeadKey, Member>
  rules: RuleView[]
  unmapped: UnmappedView[]
  notes: Member
  extras: Member[]
  /** Present but not a JSON array: creation controls stay away, the repair route stays open. */
  rulesProblem: string | null
  unmappedProblem: string | null
  malformed: { path: DocPath; reason: string }[]
}

const member = (tree: DocTree, path: DocPath): Member => ({ path, raw: rawAt(tree, path) })

function keysOf(tree: DocTree, path: DocPath): string[] | null {
  const node = nodeAt(tree, path)
  return node !== null && node.kind === 'object' ? node.members.map(m => m.key) : null
}

function lengthOf(tree: DocTree, path: DocPath): number | null {
  const node = nodeAt(tree, path)
  return node !== null && node.kind === 'array' ? node.elements.length : null
}

const extrasOf = (tree: DocTree, path: DocPath, known: Set<string>): Member[] =>
  (keysOf(tree, path) ?? []).filter(key => !known.has(key)).map(key => member(tree, [...path, key]))

function indexTransforms(tree: DocTree, path: DocPath): TransformView[] | null {
  const count = lengthOf(tree, path)
  if (count === null) return null
  return Array.from({ length: count }, (_unused, index) => {
    const at: DocPath = [...path, index]
    const node = nodeAt(tree, at)
    const raw = rawAt(tree, at) ?? ''
    if (node?.kind === 'string') {
      return { index, path: at, raw, form: 'short' as const, name: JSON.parse(raw) as string, enumMapUnmapped: null }
    }
    if (node?.kind === 'object') {
      const keys = keysOf(tree, at) ?? []
      const name = keys.length === 1 ? keys[0] : null
      return {
        index,
        path: at,
        raw,
        form: 'object' as const,
        name,
        enumMapUnmapped: name === 'enum_map' ? member(tree, [...at, 'enum_map', 'unmapped']) : null,
      }
    }
    return { index, path: at, raw, form: 'malformed' as const, name: null, enumMapUnmapped: null }
  })
}

/** Present, but not the JSON type the DSL declares: a repair, not a missing member. */
function wrongType(tree: DocTree, path: DocPath, kind: 'array' | 'object', malformed: { path: DocPath; reason: string }[]): string | null {
  if (rawAt(tree, path) === null) return null
  const node = nodeAt(tree, path)
  if (node !== null && node.kind === kind) return null
  const reason = `${String(path.at(-1))} must be a JSON ${kind}`
  malformed.push({ path, reason })
  return reason
}

function indexField(tree: DocTree, path: DocPath, name: string, malformed: { path: DocPath; reason: string }[]): FieldView {
  const node = nodeAt(tree, path)
  const empty = {
    name,
    path,
    source: {
      present: [] as SourceKind[],
      members: Object.fromEntries(SOURCE_KINDS.map(kind => [kind, { path: [...path, kind], raw: null }])) as Record<SourceKind, Member>,
      paths: null,
    },
    transforms: null,
    transformsProblem: null,
    pathsProblem: null,
    options: Object.fromEntries(FIELD_OPTIONS.map(option => [option, { path: [...path, option], raw: null }])) as Record<FieldOption, Member>,
    unit: { from: { path: [...path, 'unit', 'from'], raw: null }, to: { path: [...path, 'unit', 'to'], raw: null }, keys: null },
    unitProblem: null,
    extras: [],
  }
  if (node === null) return { ...empty, malformed: 'this field is inside a section with duplicate keys' }
  if (node.kind !== 'object') return { ...empty, malformed: 'a field must be a JSON object' }
  const members = Object.fromEntries(SOURCE_KINDS.map(kind => [kind, member(tree, [...path, kind])])) as Record<SourceKind, Member>
  const pathsLength = lengthOf(tree, [...path, 'paths'])
  const pathsProblem = wrongType(tree, [...path, 'paths'], 'array', malformed)
  const transformsProblem = wrongType(tree, [...path, 'transforms'], 'array', malformed)
  return {
    name,
    path,
    source: {
      present: SOURCE_KINDS.filter(kind => members[kind].raw !== null),
      members,
      paths: pathsLength === null ? null : Array.from({ length: pathsLength }, (_unused, i) => member(tree, [...path, 'paths', i])),
    },
    transforms: indexTransforms(tree, [...path, 'transforms']),
    transformsProblem,
    pathsProblem,
    options: Object.fromEntries(FIELD_OPTIONS.map(option => [option, member(tree, [...path, option])])) as Record<FieldOption, Member>,
    unit: {
      from: member(tree, [...path, 'unit', 'from']),
      to: member(tree, [...path, 'unit', 'to']),
      keys: keysOf(tree, [...path, 'unit']),
    },
    unitProblem: wrongType(tree, [...path, 'unit'], 'object', malformed),
    extras: extrasOf(tree, path, FIELD_KEYS),
    malformed: null,
  }
}

function indexRule(tree: DocTree, index: number, malformed: { path: DocPath; reason: string }[]): RuleView {
  const path: DocPath = ['rules', index]
  const node = nodeAt(tree, path)
  const base = {
    index,
    path,
    id: member(tree, [...path, 'id']),
    entity: member(tree, [...path, 'entity']),
    select: member(tree, [...path, 'select']),
    parent: member(tree, [...path, 'parent']),
    where: null,
    whereProblem: null,
    nativeKeyProblem: null,
    nativeKey: { present: false, items: [] },
    fields: [],
    extras: [],
  }
  if (node === null || node.kind !== 'object') {
    const reason = node === null ? 'this rule is inside a section with duplicate keys' : 'a rule must be a JSON object'
    malformed.push({ path, reason })
    return { ...base, malformed: reason }
  }
  const fieldsPath: DocPath = [...path, 'fields']
  const fieldNames = keysOf(tree, fieldsPath)
  let ruleProblem: string | null = null
  if (rawAt(tree, fieldsPath) !== null && fieldNames === null) {
    ruleProblem = 'fields must be a JSON object'
    malformed.push({ path: fieldsPath, reason: ruleProblem })
  }
  const whereLength = lengthOf(tree, [...path, 'where'])
  const nativeLength = lengthOf(tree, [...path, 'native_key'])
  const whereProblem = wrongType(tree, [...path, 'where'], 'array', malformed)
  const nativeKeyProblem = wrongType(tree, [...path, 'native_key'], 'array', malformed)
  return {
    ...base,
    where:
      rawAt(tree, [...path, 'where']) === null || whereLength === null
        ? null
        : Array.from({ length: whereLength }, (_unused, i) => ({
            index: i,
            path: [...path, 'where', i],
            pathMember: member(tree, [...path, 'where', i, 'path']),
            op: member(tree, [...path, 'where', i, 'op']),
            value: member(tree, [...path, 'where', i, 'value']),
          })),
    whereProblem,
    nativeKeyProblem,
    nativeKey: {
      present: rawAt(tree, [...path, 'native_key']) !== null,
      items: Array.from({ length: nativeLength ?? 0 }, (_unused, i) => member(tree, [...path, 'native_key', i])),
    },
    fields: (fieldNames ?? []).map(name => indexField(tree, [...fieldsPath, name], name, malformed)),
    extras: extrasOf(tree, path, RULE_KEYS),
    malformed: ruleProblem,
  }
}

/** Index a document; never throws, and says why when a section cannot be shown as rows. */
export function indexDocument(text: string): DocIndex {
  try {
    return index(text)
  } catch (error) {
    // the grammar's depth guard covers the known case; this is the promise itself, so that no
    // document, however strange, can throw out of a state update and take the draft with it
    return { ...emptyIndex(), problem: `This document could not be read: ${(error as Error).message}` }
  }
}

function emptyIndex(): DocIndex {
  return {
    ok: false,
    problem: null,
    offset: null,
    duplicates: [],
    head: Object.fromEntries(HEAD_KEYS.map(key => [key, { path: [key], raw: null }])) as Record<HeadKey, Member>,
    rules: [],
    unmapped: [],
    notes: { path: ['notes'], raw: null },
    extras: [],
    rulesProblem: null,
    unmappedProblem: null,
    malformed: [],
  }
}

function index(text: string): DocIndex {
  const empty = emptyIndex()
  if (text.trim() === '') return { ...empty, problem: 'The mapping document is empty' }
  const tree = scanDocument(text)
  if ('problem' in tree) return { ...empty, problem: tree.problem, offset: tree.offset }
  if (tree.root.kind !== 'object') return { ...empty, problem: 'The mapping document must be a JSON object' }

  const malformed: { path: DocPath; reason: string }[] = []
  const ruleCount = lengthOf(tree, ['rules'])
  const rulesProblem = wrongType(tree, ['rules'], 'array', malformed)
  const unmappedCount = lengthOf(tree, ['unmapped'])
  const unmappedProblem = wrongType(tree, ['unmapped'], 'array', malformed)
  return {
    ok: true,
    problem: null,
    offset: null,
    duplicates: tree.duplicates,
    head: Object.fromEntries(HEAD_KEYS.map(key => [key, member(tree, [key])])) as Record<HeadKey, Member>,
    rules: Array.from({ length: ruleCount ?? 0 }, (_unused, index) => indexRule(tree, index, malformed)),
    unmapped: Array.from({ length: unmappedCount ?? 0 }, (_unused, index) => ({
      index,
      path: ['unmapped', index],
      pathMember: member(tree, ['unmapped', index, 'path']),
      reason: member(tree, ['unmapped', index, 'reason']),
    })),
    notes: member(tree, ['notes']),
    extras: extrasOf(tree, [], DOC_KEYS),
    rulesProblem,
    unmappedProblem,
    malformed,
  }
}

/** The unquoted text of a JSON string member, for a label; null for anything else. */
export function asString(value: Member): string | null {
  if (value.raw === null || !value.raw.startsWith('"')) return null
  try {
    return JSON.parse(value.raw) as string
  } catch {
    return null
  }
}
